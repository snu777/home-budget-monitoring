---
date: 2026-06-29T12:50:43+02:00
researcher: snu777
git_commit: 13dd9dcdeafc211b76c5efd32f113fe1ae3cd4d0
branch: main
repository: home-budget-monitoring
topic: "API input + error-boundary contract (Test Plan Phase 2, Risk #4)"
tags: [research, codebase, api, validation, error-disclosure, contract-testing]
status: complete
last_updated: 2026-06-29
last_updated_by: snu777
---

# Research: API input + error-boundary contract (Test Plan Phase 2, Risk #4)

**Date**: 2026-06-29T12:50:43+02:00
**Researcher**: snu777
**Git Commit**: 13dd9dcdeafc211b76c5efd32f113fe1ae3cd4d0
**Branch**: main
**Repository**: home-budget-monitoring

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` — **Risk #4: untrusted
input + error disclosure at the API boundary** (the server trusts client-side
validation, or a 5xx response leaks raw Postgres/schema text). Verify, don't
blindly accept, the §2 Risk Response Guidance: prove the server rejects bad
input regardless of client and that error bodies carry no schema/internal text;
challenge "the client validated so the server can trust it" and "returning
`error.message` is harmless"; ground where validation and `error.message`-return
actually live; pick the cheapest useful test layer; flag the oracle-problem
anti-pattern.

## Summary

The risk is **real and confirmed**, but it splits cleanly into two halves that
live in two different route *shapes*:

1. **Input validation (the "untrusted input" half) — already strong, JSON API.**
   `src/pages/api/expenses.ts` validates every field server-side with inline
   `typeof`/regex checks (no zod, despite the CLAUDE.md guideline), independent
   of the React form: amount type + bounds (`≤ 0`, `> 1_000_000`), sub-cent
   rounding, category allow-list (`EXPENSE_CATEGORIES`), strict `YYYY-MM-DD` +
   real-date check, and a JSON-parse guard. This is the testable, behavior-rich
   surface. The **auth routes have essentially no input validation** — but that
   maps to Supabase Auth internals, which §7 puts out of scope.

2. **Error disclosure (the "info leak" half) — confirmed, two shapes.**
   Raw Supabase/Postgres `error.message` is echoed to the client in **5 sites
   across 4 routes**. The JSON API leaks it in a `500` body
   (`expenses.ts:59`, `:131`, `:158`); the form routes leak it into a `302`
   redirect query string (`budgets.ts:25`, `signin.ts:18`, `signup.ts:18`).
   `budgets/join.ts` is the **lone sanitized counter-example** — it maps RPC
   error codes through an `ERROR_MESSAGES` allow-list with a generic fallback,
   leaking nothing.

**Cheapest useful layer & the central constraint.** Risk #4's behavior
(validation + error-body shape) is **app-layer logic in the handler**, not RLS,
so — unlike Phase 1 — mocking the external edge is *defensible here*. There is
**no existing pattern in `tests/` for invoking an Astro route handler**, and the
established blocker is that `src/lib/supabase.ts` imports `astro:env/server`,
which Vitest cannot resolve in the node project. The cookbook slot reserved for
this phase (test-plan §6.3) already prescribes the resolution: *"mock only the
external edge."* That is the key planning decision (see Open Questions).

## Detailed Findings

### Area 1 — `expenses.ts`: the JSON API boundary (primary target)

`src/pages/api/expenses.ts` is the only route that speaks JSON with real HTTP
status codes — the natural contract-test surface. Imports are minimal; no zod,
no shared validation helper (`expenses.ts:1-6`). The category allow-list comes
from `EXPENSE_CATEGORIES` in `src/types.ts:7-17` (9 Polish enum values mirroring
the Postgres `expense_category` enum).

**POST validation (server-side, independent of client):**
- JSON-parse guard → `400 "Invalid JSON"` (`expenses.ts:88-95`).
- amount: `typeof !== "number" || amount <= 0` → `400 "Invalid amount"`
  (`:97-99`); `amount > 1_000_000` → `400 "Amount too large"` (`:100-102`);
  sub-cent **silently rounded** via `Math.round(amount*100)/100` (`:105`), not
  rejected. A string `"50"` is rejected (no coercion).
- category: `!EXPENSE_CATEGORIES.includes(...)` → `400 "Invalid category"`
  (`:107-109`). Arbitrary strings rejected.
- date: strict `/^\d{4}-\d{2}-\d{2}$/` then `isNaN(new Date(...).getTime())` →
  `400 "Invalid date"` (`:111-116`). Catches `2026-13-40`. **No default-to-today
  in POST** — date is required (default-to-today is GET-only, `toLocalISODate`
  `:11-16`).

**Edge case (low severity):** `NaN` passes both amount guards
(`typeof NaN === "number"`, and `NaN <= 0` / `NaN > 1e6` are both false), so it
would round to `NaN` and insert — but JSON cannot carry `NaN`, so this is only
reachable by a non-JSON caller. Worth a note, not a priority assertion.

**Error disclosure (the core of the risk):** raw `error.message` returned with
`500` in all three handlers:
- GET `expenses.ts:58-60`
- POST `expenses.ts:130-132`
- DELETE `expenses.ts:157-159`

Each is `return Response.json({ error: error.message }, { status: 500 })`.
PostgREST frequently embeds constraint/column/schema text inside `.message`, so
this is a genuine disclosure path. `error.details`/`.hint`/`.code` are **not**
separately returned — the vector is exclusively `.message`.

**Status-code map:** validation → `400`; unauthenticated → `401` (`:21,28,68,75,140,147`);
authorization/no-budget → `403` (`:85`); not-found → `404` (`:162`); DB error → `500`.

**DELETE specifics:** missing `id` → `400` (`:152`); DB error → `500` raw leak
(`:158`); **not-found and RLS-forbidden are conflated** as `404 "Expense not
found"` via `count === 0` (`:161-163`) — there is no distinct `403`. The `id` is
passed straight into `.eq("id", id)` with **no UUID-format validation**, so a
malformed id surfaces as a DB error → `500` leak.

**Silent error-swallow (note, not disclosure):** GET's `auth.getUser()` and the
`budget_members` query ignore their `error` field (`:31-35`, `:78-82`); a query
error becomes "no membership" → GET returns `200 { expenses: [] }`, POST returns
`403`. Not a leak, but a correctness footnote.

### Area 2 — Form routes: a different leak shape (302 + `?error=`)

The auth and budget-create routes are **form-post → `context.redirect()` (302)**,
not JSON APIs. None set explicit status codes; all communicate via
`/...?error=<msg>` query strings. All carry `export const prerender = false`.

- **Raw `error.message` leak (3 sites):**
  - `budgets.ts:24-26` — `redirect("/dashboard?error=" + encodeURIComponent(error.message))` after the `create_budget` RPC; `name` taken raw with only `.trim()` (`budgets.ts:20`), no validation.
  - `signin.ts:17-19` — raw Supabase auth `error.message` into `/auth/signin?error=`; email/password read via unchecked `as string` cast, no presence/shape check (`signin.ts:7-9`).
  - `signup.ts:17-19` — same pattern (`signup.ts:7-9`).
- **Sanitized counter-example:** `budgets/join.ts` maps `error.message` (used only
  as a lookup *key*) through `ERROR_MESSAGES` (`join.ts:6-10`) with a generic
  fallback (`join.ts:36-39`), leaking nothing. Invite code is presence-checked
  (`join.ts:26-30`) but has no format/length validation.
- `signout.ts` consumes no input and inspects no error (`signout.ts:8-11`).

**No try/catch anywhere** in the five routes — an `await` rejection (e.g.
malformed `formData()`) surfaces as a framework-level 500, not a hand-built body.

### Area 3 — Test harness & how to attach Phase 2

**Two-project Vitest** (`vitest.config.ts`), one `npm test` (`package.json:13`):
- `unit` (`:16-23`): node env, `tests/unit/**/*.test.ts`, no setup, parallel.
- `integration` (`:24-38`): node env, `tests/integration/**/*.test.ts`,
  `setupFiles: ["./tests/setup/load-env.ts"]`, `fileParallelism: false` (serial),
  `testTimeout`/`hookTimeout` 30000. Run alone with `--project integration`.

**Integration helpers** (`tests/integration/helpers/supabase.ts`): env via
`requireEnv()` from `.env.test` (loaded `tests/setup/load-env.ts:7`); `SUPABASE_KEY`
→ anon, `SUPABASE_SERVICE_ROLE_KEY` → service-role. `anonClient()` (RLS-bound,
the assertion client), `adminClient()` (bypasses RLS, teardown only),
`createAuthedUser(suffix)`, `createBudget(client,name)` (via `create_budget` RPC),
`seedExpense(...)`, `deleteUser(admin,userId)` (cascade). Pattern: `beforeAll`
setup → `it` act+assert → `afterAll` **`Promise.allSettled` best-effort cleanup**
(mandated by impl-review F1, `testing-rls-authorization/reviews/impl-review.md:33-41`).
Timestamp-suffixed identities avoid collisions and the local
`sign_in_sign_ups = 30 / 5 min` limit.

**No route-handler test pattern exists.** A `tests/` sweep for `pages/api`,
`APIRoute`, `APIContext`, `new Request`, mock context, bare `GET(`/`POST(` →
**zero matches**. Routes are currently exercised only *indirectly* via the live
Supabase client against the RLS boundary. Filling this gap is Phase 2's job.

## Code References

- `src/pages/api/expenses.ts:1-6` — imports; no zod, `EXPENSE_CATEGORIES` only validation asset
- `src/pages/api/expenses.ts:88-95` — JSON-parse guard → 400
- `src/pages/api/expenses.ts:97-105` — amount type/bounds + sub-cent rounding
- `src/pages/api/expenses.ts:107-109` — category allow-list check
- `src/pages/api/expenses.ts:111-116` — date regex + real-date check
- `src/pages/api/expenses.ts:58-60`, `:130-132`, `:157-159` — **raw `error.message` → 500 (leak sites)**
- `src/pages/api/expenses.ts:150-165` — DELETE: 400/500/404; 404 conflates not-found & forbidden; no UUID validation
- `src/types.ts:7-17` — `EXPENSE_CATEGORIES` (the validation oracle, independent of the handler)
- `src/pages/api/budgets.ts:20,24-26` — raw name; `error.message` leak into redirect
- `src/pages/api/budgets/join.ts:6-10,26-30,36-39` — sanitized `ERROR_MESSAGES` map (clean reference pattern)
- `src/pages/api/auth/signin.ts:7-9,17-19` — no input validation; raw `error.message` leak
- `src/pages/api/auth/signup.ts:7-9,17-19` — same
- `src/pages/api/auth/signout.ts:8-11` — no input, no error inspection
- `src/lib/supabase.ts:1-3` — `createClient` imports `astro:env/server` (the Vitest blocker)
- `vitest.config.ts:16-38` — unit vs integration projects
- `tests/integration/helpers/supabase.ts:8-118` — client construction + fixtures + teardown
- `tests/setup/load-env.ts:7` — `.env.test` loading
- `tests/integration/rls-isolation.test.ts:42-83` — representative integration pattern
- `tests/integration/rls-guard.test.ts:44-55` — harness self-check (false-green guard)

## Architecture Insights

- **Two route shapes, two leak shapes.** JSON API (`expenses.ts`) leaks via `500`
  body; form routes leak via `302 ?error=`. A contract suite for the JSON API can
  assert status + body directly; the form routes would need redirect-`Location`
  parsing. The behavior-rich, cheaply testable surface is `expenses.ts`.
- **The codebase already contains both the anti-pattern and its fix.** Raw
  passthrough (`expenses.ts`, `budgets.ts`, auth) vs. the sanitized
  `ERROR_MESSAGES` map (`join.ts`). The contract test's "what good looks like" is
  literally `join.ts`'s convention. This also implies a likely *implementation*
  follow-up (sanitize the `expenses.ts` 500 bodies) — but Phase 2 is a **test**
  phase; tests should pin the leak as a failing/known risk per the rule, not
  silently encode current behavior (oracle problem).
- **Validation is hand-rolled, not zod** — contradicts CLAUDE.md "validate with
  zod." The test must assert *from the PRD/business rule* (reject `≤ 0`,
  `> 1_000_000`, sub-cent, bad category, malformed date), **not** by importing or
  mirroring the handler's regex/conditionals.
- **Mock-the-edge is sanctioned for this risk specifically.** Phase 1 forbade
  mocking the Supabase client because RLS *is* the thing under test. Risk #4's
  thing-under-test is handler-local validation + error shaping, so test-plan §6.3
  explicitly allows "mock only the external edge" — i.e. stub the
  `astro:env`/`createClient` boundary, drive the handler with a real `Request`,
  assert status + body.

## Historical Context (from prior changes)

- `context/changes/testing-rls-authorization/plan.md:64-68` & `research.md:107-109`
  — `astro:env/server` is unresolvable from the Node Vitest project; established
  here and reaffirmed since. The integration project deliberately avoids Astro's
  Vite pipeline.
- `context/changes/testing-rls-authorization/reviews/impl-review.md:24-27,33-41`
  — service-role key stays in test `process.env` only (never in app/config);
  `Promise.allSettled` best-effort teardown is mandatory.
- `context/changes/testing-expense-computation/plan.md:30-37` — Phase 3's reaffirmation
  of the `astro:env` constraint; pure functions extracted to `src/lib` so they
  unit-test without the SSR boundary (the same extraction trick may inform how to
  make the handler edge injectable).
- `context/foundation/test-plan.md` §2 Risk #4 row (`:46`) + Risk Response Guidance
  (`:68`); §6.2 integration recipe (`:157-191`); **§6.3 (`:193-198`) is the slot
  Phase 2 fills** — "request → response shape AND side-effects … mock only the
  external edge"; §7 negative space (`:230-244`) — Supabase Auth internals,
  generated `database.types.ts`, UI snapshots out of scope.

## Related Research

- `context/changes/testing-rls-authorization/research.md` — RLS boundary & harness origin
- `context/changes/testing-expense-computation/research.md` — pure-function extraction precedent

## Open Questions

1. **Test mechanism for the JSON handler (the planning fork).** Two options, both
   land in `tests/integration/**`:
   - **(a) Direct handler invocation** — import `POST`/`GET`/`DELETE` from
     `expenses.ts`, pass a mock `APIContext` (`new Request(...)`, cookies, url),
     and **mock the external edge** (`@/lib/supabase` `createClient` →
     a fake returning a controllable `{ data, error }`). Reaches the validation
     block and the `error.message`-return paths directly; lets a test *force* a
     DB `error` to assert the 500 body. Requires solving the `astro:env` import
     (mock `@/lib/supabase`, or refactor `createClient` to be injectable). This is
     what §6.3 prescribes and is the recommended path.
   - **(b) Live integration only** — cannot reach handler-local validation (it
     isn't in the DB), so it cannot cover the validation half. Insufficient alone.
   Decision belongs in `/10x-plan`; research recommends **(a)**.
2. **Scope of the error-disclosure assertion.** Do we cover only the JSON `500`
   leaks (`expenses.ts:59,131,158`), or also the form-route redirect leaks
   (`budgets.ts:25`, `signin.ts:18`, `signup.ts:18`)? The auth-route input
   validation is out of scope (§7 Auth internals), but the *disclosure* on those
   redirects is app-layer. Recommend: prioritize `expenses.ts` JSON `500` bodies;
   treat form-redirect leaks as a documented secondary (or a noted follow-up).
3. **Pin-the-leak vs. assert-clean.** The 500 bodies currently *do* leak. A
   correct Risk #4 test asserts the *desired* contract (no schema/internal text)
   — which means it may **fail against current code**, correctly flagging the leak
   rather than encoding it. Plan must decide: ship a failing/`.todo` test that
   documents the gap, or pair Phase 2 with a small sanitization fix to
   `expenses.ts` so the assertion passes. (This is the oracle-problem guardrail in
   action: assert from the rule, not from current output.)
4. **DELETE 404/forbidden conflation & missing UUID validation** — in scope for
   Risk #4 (untrusted input → `id`), or deferred? A malformed `id` → `500` leak
   ties it to the disclosure half.
