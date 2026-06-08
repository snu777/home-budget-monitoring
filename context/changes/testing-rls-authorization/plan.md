# Test runner + RLS authorization (Risk #1 isolation) Implementation Plan

## Overview

Stand up the repository's first automated test harness — plain Vitest plus
a local-Supabase integration layer — and use it to prove **cross-couple
read isolation** (test-plan Risk #1): user B can never read user A's
`expenses` or `budgets` rows. The tests run against a real local Postgres
because the isolation boundary is an RLS policy, not application code
(`GET /api/expenses` applies no app-layer `budget_id` filter) — so a
mocked client would prove nothing.

This is Phase 1 of `context/foundation/test-plan.md`, scoped here to
**Risk #1 only** (membership integrity #2 and delete IDOR #3 are deferred
to a follow-up in the same change folder).

## Current State Analysis

- **No test tooling exists.** Real `package.json` has no `test` script and
  no Vitest / jsdom / testing-library. There is no `vitest.config.*` and
  zero test files anywhere (`package.json:5-13`, glob for `*.test.ts` →
  empty). Greenfield harness.
- **The repo carries `*.scaffold` twins** of every root config
  (`package.json.scaffold`, `src.scaffold/`, etc.). These are inactive
  starter leftovers — all work targets the **real** files.
- **Supabase local is configured.** `supabase/config.toml` exists with the
  two migrations present; `enable_confirmations = false`
  (`supabase/config.toml:209`) so a programmatic signup yields an
  immediate session. Rate limit `sign_in_sign_ups = 30 / 5 min`
  (`supabase/config.toml:189`) bounds how many signups a run may do.
- **The deps we need are already present:** `@supabase/supabase-js@^2.99.1`
  and the `supabase` CLI (`package.json:22, devDeps`). Only `vitest` and
  `dotenv` must be added.
- **The RLS boundary (what we are testing):**
  `expenses_select_budget_members` and `budgets_select_members`
  (`supabase/migrations/20260528000000_expense_data_schema.sql:107-114,
61-69`) scope reads by `auth.uid()` membership. No `USING (true)`, no
  `anon` grant, no service-role key anywhere in the app — so a per-user
  anon-key client is subject to RLS, which is exactly the boundary under
  test (see `research.md`).
- **Fixtures must use RPCs.** The direct `budget_members` INSERT policy was
  dropped (`..._secure_budget_creation.sql:3`); budgets are created only
  via `create_budget(p_name)` → returns budget UUID, creator auto-joined
  (`..._secure_budget_creation.sql:6-28`).

## Desired End State

`npm test` runs a Vitest integration suite against a running local
Supabase that:

1. Confirms the harness is sound (RLS enabled on the tables under test;
   assertion clients are anon, not service-role).
2. Proves user B receives **none** of user A's `expenses` or `budgets`
   rows, with a positive control proving A still reads its own.
3. Cleans up after itself (created users cascade-deleted), leaving the DB
   as it was found.

Verification: `npm test` is green; deliberately breaking a policy
(e.g. `USING (true)`) makes the isolation tests fail; the cookbook in
`test-plan.md §6.2` documents the reusable pattern.

### Key Findings

- Use plain `@supabase/supabase-js` `createClient` + `signInWithPassword`,
  **not** the SSR factory `src/lib/supabase.ts` — the factory needs
  `astro:env/server` + `AstroCookies` and is unusable from Node
  (`src/lib/supabase.ts:1-26`). Two client instances = two users; each
  carries its own JWT and is subject to RLS per-user.
- `astro:env/server` is a virtual module Vitest can't resolve; we avoid it
  entirely by never importing app modules that use it.
- expenses require `created_by = auth.uid()`, `amount > 0`, and a valid
  enum `category` (Polish literals, e.g. `"Jedzenie"`) —
  `..._expense_data_schema.sql:4-14, 39-47`; `src/types.ts:7-17`.
- The expense API assumes one membership per user (`maybeSingle()`), so
  keep each test user in exactly one budget.

## What We Are NOT Doing

- **Risk #2** (membership/invite integrity, 2-member cap concurrency, NULL
  `auth.uid()`) and **Risk #3** (delete IDOR) — same change folder,
  separate follow-up after their research is appended.
- **`budget_members` own-row test, anon/unauthenticated read, cross-budget
  INSERT rejection** — deferred per scoping decision. _Note:_ the
  anon-read case is named in the test plan's Risk #1 success criteria; it
  is a cheap add and is called out as a recommended follow-up, not a
  silent drop.
- **CI test step** — explicitly test-plan Phase 5; this plan adds the local
  `test` script only and does not touch `.github/workflows/ci.yml`.
- **Component/React or e2e tests**, and any change to application code or
  RLS policies. This phase is test infrastructure + assertions only.

## Implementation Approach

Two anon-key `supabase-js` clients (A, B) exercise RLS as two real users;
a third **service-role** client exists only for teardown (cascade-delete
users). DB state strategy is "running instance + unique IDs": the suite
assumes `npx supabase start` is up, creates timestamp-unique users/budgets
so it never collides with dev data or parallel runs, and removes only what
it created. The integration file runs **serially / single-fork** and
creates its two users **once** (shared) to stay far under the signup rate
limit. Vitest is configured standalone (no Astro integration), reading
connection config from `process.env` via `dotenv`.

## Critical Implementation Details

- **Service-role key must never enter the `astro:env` schema or the app.**
  It is read only in test setup via `process.env.SUPABASE_SERVICE_ROLE_KEY`
  (printed by `npx supabase start`). Putting it in `astro.config.mjs`'s
  env schema would hand the app an RLS-bypass key — the exact thing whose
  absence currently makes the app safe. The assertion clients must use the
  **anon** key; only the teardown/admin client uses the service-role key.
- **Rate limit:** create the two users once in `beforeAll`, not per test.
  Re-running the full suite many times within 5 minutes can still approach
  `sign_in_sign_ups = 30 / 5 min`; if hit, the signin/up calls 429 — a
  known, documented flake source, not a product bug.

---

## Phase 1: Test runner + integration harness

### Overview

Add Vitest and the harness plumbing so `npm test` can run integration
tests against local Supabase, and land the **RLS-enabled guard test** that
validates the harness configuration itself.

### Required changes:

#### 1. Test dependencies and script

**File**: `package.json`

**Purpose**: Make `npm test` available and add the only two missing
dev dependencies (`vitest`, `dotenv`).

**Contract**: Add `"test": "vitest run"` (and optionally
`"test:watch": "vitest"`) to `scripts`. Add `vitest` (Vite-7 compatible,
honoring the existing `overrides.vite ^7.3.2` pin) and `dotenv` to
`devDependencies`. No production dependency changes.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Purpose**: Configure a standalone Node test runner that does not pull in
Astro's Vite pipeline, runs integration tests serially, and resolves the
`@/*` alias for the few app imports we allow (`src/types.ts`).

**Contract**: `defineConfig` from `vitest/config` with: `test.environment
= "node"`; an include glob for `tests/integration/**/*.test.ts`;
single-fork / serial execution (`pool: "forks"` with
`poolOptions.forks.singleFork = true`, or `fileParallelism: false`);
`test.setupFiles` pointing at the dotenv loader (change #3); and
`resolve.alias` mapping `@` → `./src`. No `astro` plugin, no
`astro:env` handling — app modules using it are never imported.

#### 3. Test environment loader + example

**File**: `tests/setup/load-env.ts` (new); `.env.example` (edit)

**Purpose**: Load Supabase connection config for tests from a gitignored
`.env.test` into `process.env`, and document the three required keys.

**Contract**: `load-env.ts` calls `dotenv.config({ path: ".env.test" })`
at module load (referenced from `vitest.config.ts` setupFiles).
`.env.example` gains commented documentation of the test keys —
`SUPABASE_URL`, `SUPABASE_KEY` (anon), and `SUPABASE_SERVICE_ROLE_KEY`
(test-only; from `npx supabase start` output) — without real values.
Confirm `.env.test` is covered by `.gitignore` (the existing `.env*`
ignore should cover it; verify and add if not).

#### 4. Harness helper module

**File**: `tests/integration/helpers/supabase.ts` (new)

**Purpose**: Provide the reusable primitives every integration test needs,
so individual tests stay declarative.

**Contract**: Exports —

- `anonClient()` → a fresh `@supabase/supabase-js` client on
  `SUPABASE_URL` + anon `SUPABASE_KEY`, with session persistence disabled
  (`auth: { persistSession: false, autoRefreshToken: false }`) so parallel
  client instances don't share a session.
- `adminClient()` → a client on the **service-role** key (teardown only).
- `createAuthedUser(suffix)` → signs up a uniquely-suffixed email
  (timestamp + suffix), signs in, returns `{ client, userId, email }`. One
  membership per user invariant respected by callers.
- `createBudget(client, name)` → `rpc("create_budget", { p_name })`,
  returns the budget UUID.
- `seedExpense(client, { budgetId, amount, category, expenseDate })` →
  inserts via the user's own client (RLS-valid: `created_by = auth.uid()`),
  default category a valid enum literal.
- `deleteUser(admin, userId)` → `admin.auth.admin.deleteUser(userId)`;
  cascades to that user's budgets/members/expenses.

#### 5. RLS-enabled guard test

**File**: `tests/integration/rls-guard.test.ts` (new)

**Purpose**: Fail loudly if the harness is misconfigured in a way that
would make every isolation test a false green (research Open Question #1):
migrations not applied, or assertion clients accidentally privileged.

**Contract**: Two assertions —
(a) **RLS is enforced**: an authed user querying a row they do not own /
no row exists returns empty (not an error and not foreign rows) — i.e. the
policy is active. A direct check is to confirm a freshly-created user sees
zero `expenses` before seeding any. (Optionally also assert via the admin
client a catalog read that `relrowsecurity` is true on the three tables.)
(b) **Assertion client is not privileged**: the anon client's key is not
the service-role key (guard against env mix-up) — assert
`SUPABASE_KEY !== SUPABASE_SERVICE_ROLE_KEY` and that the anon client
cannot perform a service-role-only action.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install`
- Type-check passes: `npx astro sync && npx tsc --noEmit` (or `npm run lint`)
- Lint passes: `npm run lint`
- `npm test` runs and the RLS-guard test passes (with local Supabase running)

#### Manual Verification:

- `npx supabase start` is running locally and `.env.test` holds the URL,
  anon key, and service-role key printed by the CLI
- Temporarily setting the anon client to the service-role key makes the
  RLS-guard test (b) fail — confirming the guard works
- No service-role key appears in `astro.config.mjs`, `.env.example` values,
  or any committed file

**Implementation note**: After this phase passes automated verification,
stop for human confirmation that local Supabase is wired and the guard
behaves before proceeding to Phase 2.

---

## Phase 2: Risk #1 cross-couple isolation suite

### Overview

Prove the cross-couple read boundary: user B reads none of user A's
`expenses` or `budgets`, with positive controls, then cleans up.

### Required changes:

#### 1. Isolation test suite

**File**: `tests/integration/rls-isolation.test.ts` (new)

**Purpose**: Assert the `expenses_select_budget_members` and
`budgets_select_members` policies actually isolate two budgets.

**Contract**: Lifecycle and cases —

- `beforeAll`: via the helpers, create shared users A and B
  (timestamp-unique); A `create_budget` → budget A, seed one expense in A;
  B `create_budget` → budget B, seed one expense in B. Keep each user in
  exactly one budget.
- **Expenses isolation**: B's client `from("expenses").select("*")` returns
  zero rows belonging to budget A (assert none of A's expense ids /
  budget_id appear). **Positive control**: A's client reads its own seeded
  expense (count ≥ 1, contains A's expense).
- **Budgets isolation**: B's client
  `from("budgets").select("*").eq("id", budgetAId)` returns empty.
  **Positive control**: A's client reading budget A returns it.
- `afterAll`: admin client `deleteUser(A)` and `deleteUser(B)` — cascade
  removes their budgets/members/expenses. Teardown is best-effort and
  idempotent (a failed setup must not leave the suite unable to clean up).

### Success Criteria:

#### Automated Verification:

- `npm test` is green including the isolation suite
- Lint passes: `npm run lint`

#### Manual Verification:

- After a run, the local DB contains no leftover test users
  (`auth.users`) or test budgets — confirm in Studio (`localhost:54323`)
- Temporarily weakening `expenses_select_budget_members` to `USING (true)`
  and re-running (against a scratch DB) makes the expenses isolation test
  fail — confirming the test detects a real leak
- Re-running the suite twice in a row stays green (no unique-ID collisions,
  no rate-limit 429)

**Implementation note**: Stop for human confirmation that the leak-injection
check was observed (the test fails when the policy is broken) before
marking the phase done.

---

## Phase 3: Cookbook + test-plan wiring

### Overview

Document the reusable integration pattern and advance the test-plan state
so the next phase builds on this harness instead of re-deriving it.

### Required changes:

#### 1. Cookbook pattern

**File**: `context/foundation/test-plan.md`

**Purpose**: Replace the §6.2 "TBD" with the concrete pattern this phase
established, and record stack/version facts.

**Contract**: §6.2 documents: assume `npx supabase start`; two anon-key
`supabase-js` clients for two users; fixtures via `create_budget`;
service-role client for teardown via `deleteUser` cascade;
timestamp-unique identities; serial execution. §4 Stack: fill the Vitest
row with the installed version and a `checked:` date. §3 Phase 1 Status:
advance to reflect the shipped harness (Risk #1 portion). Optionally add a
§6.5 note on the anon-key-vs-service-role split.

#### 2. Change status

**File**: `context/changes/testing-rls-authorization/change.md`

**Purpose**: Record that the harness + Risk #1 isolation shipped, with #2/#3
still open.

**Contract**: Update `status`/`updated` and a one-line note that Risk #1 is
covered and #2/#3 remain.

### Success Criteria:

#### Automated Verification:

- Markdown is well-formed: `npm run format` (Prettier) leaves the docs clean

#### Manual Verification:

- §6.2 reads as a usable recipe for the next contributor (a reader can add
  a new integration test without re-discovering the harness)
- §4 Vitest row shows the real installed version + `checked:` date

---

## Testing Strategy

### Unit tests:

- None in this phase — Risk #1 is a database-authorization concern that
  only a real-Postgres integration test can prove (test plan §1, principle
  #1: cheapest test that gives _real_ signal).

### Integration tests:

- RLS guard: RLS enforced + assertion client is anon (Phase 1)
- Cross-couple expenses isolation + positive control (Phase 2)
- Cross-couple budgets isolation + positive control (Phase 2)

### Manual Testing Steps:

1. `npx supabase start`; copy URL, anon key, service-role key into
   `.env.test`.
2. `npm test` → all green.
3. Break `expenses_select_budget_members` to `USING (true)` on a scratch
   DB, re-run → expenses isolation test fails (proves the test bites).
4. Restore the policy; confirm Studio shows no leftover test users/budgets
   after a run.

## Performance Considerations

Serial, two-signup-per-run design keeps the suite well under the
`sign_in_sign_ups = 30 / 5 min` local limit and fast (a handful of
round-trips to local Postgres). No performance budget beyond "does not trip
the rate limiter on normal reruns."

## Migration Notes

No schema or data migration. The harness assumes the two existing
migrations are already applied to the running local instance (the DB
lifecycle strategy is "running instance + unique IDs", not reset).

## References

- Related research: `context/changes/testing-rls-authorization/research.md`
- Test strategy: `context/foundation/test-plan.md` (Risk #1, §2 Risk
  Response row #1, §3 Phase 1, §6.2)
- RLS boundary: `supabase/migrations/20260528000000_expense_data_schema.sql:107-114, 61-69`
- Fixtures via RPC: `supabase/migrations/20260528000001_secure_budget_creation.sql:6-28`
- Test-friendly client path: `src/lib/supabase.ts:1-26` (why the SSR
  factory is bypassed); category enum: `src/types.ts:7-17`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when
> a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test runner + integration harness

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` — 633f108
- [x] 1.2 Type-check passes: `npx astro sync && npx tsc --noEmit` — 633f108
- [x] 1.3 Lint passes: `npm run lint` — 633f108
- [x] 1.4 `npm test` runs and the RLS-guard test passes (local Supabase running) — 633f108

#### Manual

- [x] 1.5 `npx supabase start` running; `.env.test` holds URL + anon key + service-role key
- [x] 1.6 Setting the anon client to the service-role key makes RLS-guard (b) fail
- [x] 1.7 No service-role key in `astro.config.mjs`, `.env.example` values, or any committed file

### Phase 2: Risk #1 cross-couple isolation suite

#### Automated

- [ ] 2.1 `npm test` green including the isolation suite
- [x] 2.2 Lint passes: `npm run lint` — 6c24323

#### Manual

- [ ] 2.3 No leftover test users/budgets after a run (verified in Studio)
- [ ] 2.4 Weakening `expenses_select_budget_members` to `USING (true)` makes the expenses isolation test fail
- [ ] 2.5 Suite stays green on two consecutive runs (no ID collisions / 429)

### Phase 3: Cookbook + test-plan wiring

#### Automated

- [x] 3.1 Docs format clean: `npm run format`

#### Manual

- [ ] 3.2 §6.2 reads as a usable recipe for the next contributor
- [ ] 3.3 §4 Vitest row shows the real installed version + `checked:` date
