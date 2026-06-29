# API input + error-boundary contract (Test Plan Phase 2, Risk #4) — Implementation Plan

## Overview

Phase 2 of the test rollout (`context/foundation/test-plan.md` §3). Prove **Risk #4 — untrusted input + error disclosure at the API boundary** on the `src/pages/api/expenses.ts` JSON API: that server-side validation is enforced regardless of the client, and that 5xx error bodies carry no Postgres/schema/internal text. The phase pairs a **minimal production sanitization fix** (so the clean-error-body contract ships green) with a **contract-test suite** that drives the route handlers directly with a mocked external edge.

## Current State Analysis

- `src/pages/api/expenses.ts` validates every POST field server-side with inline `typeof`/regex checks (no zod), independent of the React form: amount type + bounds (`:97-102`), sub-cent rounding (`:105`), category allow-list vs `EXPENSE_CATEGORIES` (`:107-109`), strict `YYYY-MM-DD` + real-date check (`:111-116`), JSON-parse guard (`:88-93`). **This half is already correct** — tests pin it, they don't fix it.
- **Three raw `error.message` → 500 leak sites:** GET `:58-60`, POST `:130-132`, DELETE `:157-159`. Each returns `Response.json({ error: error.message }, { status: 500 })`. PostgREST embeds constraint/column/schema text in `.message`, so this is a real disclosure path. This is the half Phase 1 of _this_ plan fixes.
- DELETE: missing `id` → 400 (`:151-153`); not-found and RLS-forbidden both → 404 via `count === 0` (`:161-163`, intentional RLS-by-design); `id` passed to `.eq("id", id)` with no UUID validation → malformed id surfaces as a DB error → 500 leak.
- **No existing pattern for invoking an Astro route handler** in `tests/` (research §4 — zero matches for `APIRoute`/mock context). The blocker is `src/lib/supabase.ts:3` importing `astro:env/server`, unresolvable in the Node Vitest project.
- Harness is fixed: two-project Vitest (`vitest.config.ts`), integration tests under `tests/integration/**`, serial, `Promise.allSettled` teardown, timestamp-unique IDs (research §2-3).

### Key Findings

- `createClient` contract (`src/lib/supabase.ts:6-25`): `(Headers, AstroCookies) => SupabaseClient | null` — returns `null` when env is absent. The handler treats `null` as 401 (`expenses.ts:20,67,139`).
- Handler client surface to fake (`expenses.ts`): `client.auth.getUser()` → `{ data: { user } }`; `client.from(t).select().eq().maybeSingle()` → `{ data }`; `client.from(t).select().gte().lte().order().order()` → `{ data, error }` (awaited builder); `client.from(t).insert().select().single()` → `{ data, error }`; `client.from(t).delete({count}).eq()` → `{ count, error }`.
- `expenses.ts` imports only `@/lib/supabase` (to be mocked) and `@/types` (a side-effect-free const array) — so mocking `@/lib/supabase` means the real module, and its `astro:env/server` import, is never evaluated.
- Sanitization precedent: `src/pages/api/budgets/join.ts:6-10,36-39` maps error codes to safe messages with a generic fallback — the "what good looks like" reference.
- `EXPENSE_CATEGORIES` (`src/types.ts:7-17`) is the independent validation oracle — assert _category membership from the PRD rule_, never by importing the handler's own check.

## Desired End State

`npm test` runs green (both projects). A new `tests/integration/expenses-api-contract.test.ts` drives `GET`/`POST`/`DELETE` from `expenses.ts` through a mocked Supabase edge and asserts: bad input is rejected with 400 regardless of client; a forced DB error yields a 500 whose body contains **no** schema/internal text (only a generic message); DELETE handles missing/garbage `id` and not-found cleanly. `expenses.ts` 500 bodies are sanitized. test-plan §6.3 documents the contract-test recipe; §3 Phase 2 is `complete`.

Verify: `npm test` green; `npm run lint`, `npx tsc --noEmit`, `npm run build` clean; flipping a validation rule or re-introducing `error.message` into a 500 body makes a test fail (bite check).

## What We Are NOT Doing

- **Not** asserting the form-route redirect leaks (`budgets.ts:25`, `signin.ts:18`, `signup.ts:18`) — recorded as a documented follow-up in §6.5, not covered this phase (leak-scope decision).
- **Not** testing auth-route input validation — Supabase Auth internals are out of scope per test-plan §7.
- **Not** changing DELETE to distinguish 403 from 404 — the conflation is intentional RLS-by-design; we document it, not change it.
- **Not** introducing zod or refactoring validation — we pin current validation behavior from the rule, not rewrite it.
- **Not** re-covering RLS / cross-couple isolation — that is Phase 1's ground; mocking the edge here is deliberate because the thing-under-test is handler-local logic.
- **Not** adding a real network/live-Supabase path for these tests.

## Implementation Approach

Two moves. First, a small production fix: sanitize the three 500 bodies so the client receives a generic message while the detail is logged server-side (reusing the `join.ts` sanitize-and-generalize precedent). Second, a contract-test suite that imports the route handlers and replaces `@/lib/supabase` with a controllable fake via `vi.mock`, driving each handler with a hand-built `APIContext` (a real `Request`, a stub `cookies`, a `URL`). Mocking the edge both reaches handler-local validation/error paths and sidesteps the `astro:env` blocker. Tests assert behavior from the PRD/business rule (the oracle), never by importing the handler's own checks.

## Critical Implementation Details

- **The mock must replace `@/lib/supabase` before `expenses.ts` is imported.** `vi.mock` is hoisted above imports, so a static `import { POST } from "@/pages/api/expenses"` is safe. The factory must NOT import the real module (no `importActual`) — that would re-trigger the `astro:env/server` import and reinstate the blocker.
- **The Supabase query builder is a thenable chain.** The fake `from()` must return an object whose chain methods (`select`/`eq`/`gte`/`lte`/`order`/`insert`/`delete`/`single`/`maybeSingle`) return the same chainable object, and which is itself awaitable to a configured `{ data, error, count }`. `maybeSingle()`/`single()` resolve to `{ data, error }`. A per-test "script" sets what the terminal await resolves to, so a test can force `error` to exercise the 500 path.
- **`getUser()` default = authed.** Most tests need an authed user + membership so execution reaches validation; provide a happy default and let individual tests override (no user → 401, no membership → 403/empty).

## Phase 1: Sanitize 500 error bodies

### Overview

Stop leaking raw `error.message` in the three 500 responses; return a generic client message and log the real detail server-side. This makes Phase 2's clean-body assertions pass green and closes the actual disclosure path.

### Changes Required:

#### 1. expenses.ts — generic 500 bodies + server-side logging

**File**: `src/pages/api/expenses.ts`

**Purpose**: The client should never receive Postgres/schema text. On an unexpected DB `error`, return a fixed generic message and log the detail server-side for debugging, mirroring the sanitize-and-generalize approach already used in `budgets/join.ts`.

**Contract**: At the three sites (`:58-60`, `:130-132`, `:157-159`), the response body becomes a constant generic message (e.g. `{ error: "Internal server error" }`) with status 500 unchanged; the raw `error.message` is passed to a server-side log (`console.error`) instead of the response. No response body anywhere in the file may interpolate `error.message`/`error.details`/`error.hint`/`error.code`. Validation 400s and auth 401/403/404 bodies are unchanged (those are intentional, schema-free user messages).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx tsc --noEmit`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing suites still green: `npm test`

#### Manual Verification:

- Dashboard add/list/delete still works end-to-end (a real DB error, if forced, shows a generic message, not Postgres text).
- No occurrence of `error.message` in any `Response.json` body in `expenses.ts`.

**Implementation Note**: After all automated checks pass, stop for human confirmation of the manual checks before Phase 2.

---

## Phase 2: Contract-test suite (mock the edge)

### Overview

Add the route-handler test mechanism and the Risk #4 assertions. This is the bulk of the phase and fills the cookbook gap (no prior route-handler test pattern).

### Changes Required:

#### 1. Fake Supabase client + APIContext helper

**File**: `tests/integration/helpers/api-context.ts` (new)

**Purpose**: Provide reusable test scaffolding: a chainable thenable fake Supabase client whose results are scriptable per test, and a builder for a minimal `APIContext` (request + cookies stub + url) to pass to a route handler. Keeps each test focused on inputs/outputs.

**Contract**: Exports (names illustrative) `makeFakeSupabase(script)` returning an object matching the handler's used surface (`auth.getUser`, `from().select/eq/gte/lte/order/insert/delete/single/maybeSingle`), where `script` configures `user`, `membership`, and the terminal `{ data, error, count }` for `expenses` reads/inserts/deletes; and `makeContext({ method, body, cookies, searchParams })` returning `{ request: Request, cookies: AstroCookies-stub, url: URL }`. The fake is the value the `@/lib/supabase` mock's `createClient` returns. A `script` may set `createClientReturnsNull: true` to exercise the 401 path.

#### 2. The contract test file

**File**: `tests/integration/expenses-api-contract.test.ts` (new)

**Purpose**: Assert Risk #4 on `expenses.ts`. `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => currentFake) }))` (hoisted; no `importActual`). Import `GET`/`POST`/`DELETE` from `@/pages/api/expenses`. Each test scripts the fake, builds a context, invokes the handler, asserts status + parsed JSON body.

**Contract**: Assertions, each derived from the PRD/business rule (the oracle), not from the handler's own checks:

- **Validation (POST), authed + member:** amount non-number → 400; amount `<= 0` → 400; amount `> 1_000_000` → 400; a valid sub-cent amount is accepted and rounded to 2 dp in the inserted payload (assert the value passed to the fake `insert`); category not in the PRD's 9-value list → 400 (use a literal bad value, e.g. `"NotACategory"`, never `EXPENSE_CATEGORIES`); malformed date (`"2026-13-40"`, `"not-a-date"`, missing) → 400; non-JSON body → 400.
- **Error disclosure:** force the `expenses` terminal await to return `{ error: { message: "duplicate key value violates unique constraint \"expenses_pkey\"" } }`; assert status 500 AND the body does **not** contain `"constraint"`, `"violates"`, or the raw message — only the generic string. Cover GET, POST, DELETE.
- **Auth/authorization gates:** `createClient` → null ⇒ 401; `getUser()` → no user ⇒ 401; no membership ⇒ POST 403, GET `{ expenses: [] }`.
- **DELETE id edges:** missing `id` ⇒ 400; not-found (`count === 0`) ⇒ 404 with a clean body; a forced DB error on a garbage id ⇒ 500 with no leak.
- A clear comment marks the suite as asserting-from-rule and names the oracle (PRD §FR-005 categories, §Business Logic amount) to guard against the oracle-problem anti-pattern.

### Success Criteria:

#### Automated Verification:

- `npm test` runs both projects green (unit + integration)
- The new suite runs green in isolation: `npx vitest run tests/integration/expenses-api-contract.test.ts`
- Lint passes: `npm run lint`
- Type-check passes: `npx tsc --noEmit`
- Bite check (validation): flipping `amount <= 0` to `amount < 0` (or `>` to `>=` on the upper bound) makes a boundary test fail
- Bite check (disclosure): re-introducing `error.message` into a 500 body makes a disclosure test fail

#### Manual Verification:

- The fake-client + context helper reads as reusable scaffolding for future route-contract tests, not a one-off.
- No test imports `EXPENSE_CATEGORIES` or the handler's regex to build its expectations (oracle independence).

**Implementation Note**: After all automated checks pass, stop for human confirmation before Phase 3.

---

## Phase 3: Cookbook + wiring

### Overview

Document the new pattern so the next contributor can reuse it, and reconcile rollout state.

### Changes Required:

#### 1. Fill the reserved cookbook slot

**File**: `context/foundation/test-plan.md`

**Purpose**: §6.3 currently reads "TBD — see §3 Phase 2." Replace it with the contract-test recipe: where contract tests live (`tests/integration/**`), the mock-the-edge mechanism (`vi.mock("@/lib/supabase")` + fake client + `makeContext`), the assert-from-rule discipline, and how to force an error to test the 500 body. Append a 2-3 line §6.5 per-phase note recording the `astro:env` workaround. Record the **documented follow-up**: form-route redirect leaks (`budgets.ts`, `signin.ts`, `signup.ts`) remain unsanitized/untested.

**Contract**: §6.3 is no longer a TBD placeholder; §6.5 gains a Phase 2 note; the form-route follow-up is recorded (in §6.5 or §7 negative-space as appropriate). §3 Phase 2 Status set to `complete`. No `file:line` anchors invented in §1/§2.

#### 2. Format docs

**File**: (repo docs)

**Purpose**: Keep markdown formatting clean.

**Contract**: `npm run format` leaves the tree clean.

### Success Criteria:

#### Automated Verification:

- Docs format clean: `npm run format`
- `npm test` still green

#### Manual Verification:

- §6.3 reads as a usable contract-test recipe for the next contributor.
- §3 Phase 2 row shows `complete`; §6.5 note + form-route follow-up are present.

**Implementation Note**: Final phase — on completion, the rollout returns to `/10x-test-plan` for Phase 4 (or stop).

---

## Testing Strategy

### Unit tests:

- None added — Risk #4 is boundary logic, not pure functions. (Pure-function correctness is Phase 3 of the rollout, already complete.)

### Integration / contract tests:

- `tests/integration/expenses-api-contract.test.ts` — the validation matrix, clean-error-body, auth gates, and DELETE id edges described in Phase 2, via the mocked edge.

### Manual testing steps:

1. Run `npm test`; confirm the new suite passes alongside the existing unit + RLS integration suites.
2. Temporarily re-add `error.message` to one 500 body; confirm the matching disclosure test fails (bite check); revert.
3. In the running app, trigger a server error path if feasible and confirm the client sees a generic message.

## Performance Considerations

None. The contract suite is fully mocked (no DB, no network), so it runs in the fast lane; it shares the `integration` project's serial setting but performs no Supabase round-trips.

## Migration Notes

None — additive tests plus a behavior-preserving error-body change (clients already only displayed an error string; the string becomes generic).

## References

- Research: `context/changes/testing-api-contract/research.md`
- Risk #4 + Risk Response Guidance: `context/foundation/test-plan.md` §2 (`:46`, `:68`)
- Integration recipe to follow: `context/foundation/test-plan.md` §6.2 (`:157-191`)
- Cookbook slot to fill: `context/foundation/test-plan.md` §6.3 (`:193-198`)
- Leak sites: `src/pages/api/expenses.ts:58-60,130-132,157-159`
- Sanitization precedent: `src/pages/api/budgets/join.ts:6-10,36-39`
- Validation oracle: `src/types.ts:7-17` (`EXPENSE_CATEGORIES`)
- Client factory / blocker: `src/lib/supabase.ts:3,6-25`
- Harness conventions: `tests/integration/helpers/supabase.ts`, `vitest.config.ts:24-38`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step is realized. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Sanitize 500 error bodies

#### Automated

- [x] 1.1 Type-check passes: `npx astro sync && npx tsc --noEmit` — ffc1e58
- [x] 1.2 Lint passes: `npm run lint` — ffc1e58
- [x] 1.3 Production build succeeds: `npm run build` — ffc1e58
- [ ] 1.4 Existing suites still green: `npm test` (skipped — local Supabase unavailable; change cannot affect rls-\* tests)

#### Manual

- [x] 1.5 Dashboard add/list/delete still works; forced DB error shows generic message — ffc1e58
- [x] 1.6 No `error.message` in any `Response.json` body in `expenses.ts` — ffc1e58

### Phase 2: Contract-test suite (mock the edge)

#### Automated

- [ ] 2.1 `npm test` runs both projects green (unit + integration) (skipped — rls-\* need local Supabase; unit + new contract suite = 36 passed, no regression)
- [x] 2.2 New suite green in isolation: `npx vitest run tests/integration/expenses-api-contract.test.ts` — 0afdbdb
- [x] 2.3 Lint passes: `npm run lint` — 0afdbdb
- [x] 2.4 Type-check passes: `npx tsc --noEmit` — 0afdbdb
- [x] 2.5 Bite check (validation): flipping a boundary operator makes a test fail — 0afdbdb
- [x] 2.6 Bite check (disclosure): re-introducing `error.message` into a 500 body makes a test fail — 0afdbdb

#### Manual

- [x] 2.7 Fake-client + context helper reads as reusable scaffolding — 0afdbdb
- [x] 2.8 No test imports `EXPENSE_CATEGORIES` or the handler regex (oracle independence) — 0afdbdb

### Phase 3: Cookbook + wiring

#### Automated

- [x] 3.1 Docs format clean: `npm run format` (this change's files prettier-clean; repo-wide pre-existing markdown churn reverted as out-of-scope) — 263b59b
- [ ] 3.2 `npm test` still green (unit + contract = 36 passed; rls-* env-blocked, no regression)

#### Manual

- [x] 3.3 §6.3 reads as a usable contract-test recipe — 263b59b
- [x] 3.4 §3 Phase 2 row shows `complete`; §6.5 note + form-route follow-up present — 263b59b
