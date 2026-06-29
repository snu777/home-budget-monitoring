# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-29 (Phase 2 → complete: API input + error-boundary contract suite shipped, 500 bodies sanitized; next pending: Phase 4 — sync behaviour)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/pages/api`,
`src/components/expenses`, `src/components/auth`, `supabase/migrations`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                    | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cross-couple data leak: a user reads another budget's expenses / budgets / members because a policy is too permissive or relies on app-layer filtering                                                                     | High   | High       | interview Q1, Q2; PRD §Guardrails ("only the two partners can see their shared budget"); PRD §Access Control; hot-spot `supabase/migrations`, `src/pages/api` |
| 2   | Membership / invite-gate write integrity: a user joins or inserts into a budget they were never invited to, or the 2-member cap is exceeded under concurrency; a SECURITY DEFINER function misbehaves on NULL `auth.uid()` | High   | Medium     | interview Q3; `context/foundation/lessons.md` (NULL `auth.uid()` rule); hot-spot `supabase/migrations`                                                        |
| 3   | Delete IDOR: a DELETE removes an expense the caller does not own / that belongs to another budget (FR-007 = delete _your own_)                                                                                             | High   | Medium     | PRD FR-007; abuse lens (authorization / IDOR); hot-spot `src/pages/api`                                                                                       |
| 4   | Untrusted input + error disclosure at the API boundary: the server trusts client-side validation, or a 5xx response leaks raw Postgres / schema text                                                                       | Medium | Medium     | PRD §Access Control; abuse lens (untrusted input, info disclosure); hot-spot `src/pages/api` (14 commits/30d)                                                 |
| 5   | Sync race: a poll landing mid-POST drops or duplicates the optimistic entry; a partner's add/delete is not reflected; a 401 leaves a stale list on screen                                                                  | Medium | Medium     | PRD NFR (sync < 3s); hot-spot `src/components/expenses` (`ExpenseDashboard.tsx`, 9 commits/30d)                                                               |
| 6   | Category / month-over-month computation: aggregation, the strict >20% threshold, the zero-base skip, the first-month rule, or month-boundary windows compute wrong, so the couple acts on bad numbers                      | Medium | Medium     | PRD §Business Logic; hot-spot `src/components/expenses`, `src/pages/api`                                                                                      |

**Impact × Likelihood rubric.** High impact = user loses access, data, or
money / failure is publicly visible. High likelihood = area changes weekly
or we have already been burned here. Risk #1 is High × High and is defended
first. No High-impact × Low-likelihood scenarios were padded into the map.

**Abuse / security lens.** The product has auth and accepts user input, so
the map carries explicit abuse scenarios: authorization read leak (#1),
membership/invite integrity (#2), delete IDOR (#3), and untrusted input +
info disclosure (#4). These rarely surface from the interview because the
happy path excludes the attacker.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                | Must challenge                                                                                                                             | Context `/10x-research` must ground                                                                                                        | Likely cheapest layer                                   | Anti-pattern to avoid                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| #1   | User A (budget 1) never receives any of budget 2's rows on any read path; an `anon`/unauthenticated read returns nothing                                                                   | "Authenticated == authorized" — being logged in does not grant access to _this_ budget's rows                                              | The actual RLS policies on `budgets` / `budget_members` / `expenses`; how the user JWT reaches the query; how membership scopes reads      | integration vs local Supabase, two real users / budgets | Mocking the Supabase client (proves nothing about RLS); single-user happy-path read                    |
| #2   | A join requires a valid invite code; no direct `budget_members` insert for an arbitrary budget_id; the 2-member cap holds under concurrent joins; a NULL `auth.uid()` raises a clean error | "The invite code is a UX gate"; "count-then-insert is enough" (TOCTOU)                                                                     | The `create_budget` + `join_budget_by_invite_code` definitions, the `FOR UPDATE` lock, GRANTs, and whether direct insert is still possible | integration (DB) + a concurrency test                   | Happy-join only; asserting the RPC return value instead of the resulting membership rows               |
| #3   | Deleting another user's / another budget's expense changes nothing (404 / forbidden); only own-budget rows can be removed                                                                  | "`eq('id')` is safe because RLS handles it" — verify RLS actually scopes DELETE; a 200 does not mean the right row (or no row) was deleted | The expenses DELETE policy and the handler's count check                                                                                   | integration (DB) as a non-owner                         | Asserting only status 200 on own-delete; no cross-user negative case                                   |
| #4   | The server rejects amount ≤ 0 / > 1,000,000 / sub-cent, invalid category, malformed date regardless of client; a 5xx body carries no schema or internal text                               | "The client validated, so the server can trust it"; "returning `error.message` is harmless"                                                | The POST validation block and where `error.message` is returned to the client                                                              | integration / contract on the route                     | Oracle problem — copying the validation regex into the test; valid-input-only                          |
| #5   | A poll mid-POST keeps the optimistic row (no flicker / duplicate); a partner's change reflects within the poll interval; a 401 stops polling and redirects                                 | "Happy add works, so sync is fine"; "fetch resolved, so it succeeded" (a 401 is a resolved fetch)                                          | The `optimisticIdsRef` merge, `handleConfirm` on success, and the 401 branch in the poll                                                   | component test (RTL + fake timers, mocked fetch)        | Over-mocking internals; asserting ref contents instead of the rendered list; brittle timer assumptions |
| #6   | Totals sum correctly; the marker flags > 20% up/down, skips ≤ 20% and zero-base, hides in the first month; month windows select the right calendar month (Jan→Dec, positive-offset TZ)     | "> 20% means ≥ 20%"; "previous = 0 → +∞%"; "`toISOString()` gives the local month"                                                         | That the pure functions (`aggregate` / `sumByCategory` / `computeMarker` / `toLocalISODate`) are exportable and side-effect free           | unit (deterministic, no DB)                             | Oracle problem — asserting the function's current output; a donut snapshot                             |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                          | Goal (one line)                                                                                                                      | Risks covered | Test types                    | Status      | Change folder                                  |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------- | ----------- | ---------------------------------------------- |
| 1   | Test runner + RLS authorization     | Stand up Vitest + a local-Supabase integration harness and prove cross-couple isolation and membership integrity on all three tables | #1, #2, #3    | integration (DB), concurrency | complete    | `context/changes/testing-rls-authorization/`   |
| 2   | API input + error-boundary contract | Prove server-side validation is enforced regardless of client and that error responses leak no schema text                           | #4            | integration / contract        | complete    | `context/changes/testing-api-contract/`        |
| 3   | Expense computation correctness     | Prove aggregation, the MoM rules, and month-boundary windows are exact at the cheapest deterministic layer                           | #6            | unit                          | complete    | `context/changes/testing-expense-computation/` |
| 4   | Sync behaviour                      | Prove optimistic add/delete, polling, and 401 handling behave under races                                                            | #5            | component (RTL)               | not started | —                                              |
| 5   | Quality-gate wiring                 | Lock the floor: add a test step to CI so the new suites block regressions                                                            | cross-cutting | gates                         | not started | —                                              |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                  | Tool                                  | Version                          | Notes                                                                                                                                      |
| ---------------------- | ------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| unit + integration     | Vitest                                | 4.1.8 (checked: 2026-06-08)      | Vite-native; two projects — `unit` (Phase 3, no DB, parallel) + `integration` (Phase 1, `.env.test` via `dotenv` 17). `npm test` runs both |
| integration (DB / RLS) | local Supabase (`npx supabase start`) | CLI 2.98.2 (checked: 2026-06-08) | RLS proven against real Postgres; harness seeds two budgets / users via the `create_budget` SECURITY DEFINER RPC                           |
| component              | React Testing Library + jsdom         | none yet — see §3 Phase 4        | For the `ExpenseDashboard` sync/optimistic/401 behaviour                                                                                   |
| e2e                    | (not planned for MVP)                 | —                                | Integration vs local Supabase covers the auth + DB crossing more cheaply than browser e2e at this scale                                    |
| accessibility          | (not planned for MVP)                 | —                                | Out of negative-space scope; revisit post-MVP                                                                                              |

**Stack grounding tools (current session):**

- Docs: Context7 available — not queried this run; Vitest-on-Astro/Vite and `@testing-library/react` are well-established, exact config to be verified in Phase 1 research; checked: 2026-06-05
- Search: Exa.ai available — not queried this run; reserve for verifying current Supabase local-test guidance during Phase 1; checked: 2026-06-05
- Runtime/browser: no Playwright/browser MCP in session — not used; e2e not planned for MVP; checked: 2026-06-05
- Provider/platform: no GitHub/Cloudflare/Supabase MCP in session — Supabase exercised via the local CLI (`npx supabase`), not an MCP; checked: 2026-06-05

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                   | Where           | Required?                                                    | Catches                                                  |
| ---------------------- | --------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| lint + typecheck       | local + CI      | required (already wired: husky + `.github/workflows/ci.yml`) | syntactic / type drift                                   |
| unit                   | local + CI      | required after §3 Phase 3                                    | computation regressions (aggregation, MoM, date windows) |
| integration (DB / RLS) | local + CI      | required after §3 Phase 1                                    | authorization leaks, membership-integrity regressions    |
| component              | local + CI      | required after §3 Phase 4                                    | sync / optimistic / 401 regressions                      |
| CI test step           | CI on push / PR | required after §3 Phase 5                                    | any of the above reaching `main`                         |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

Established by Phase 3 (`testing-expense-computation`). Pure functions live in
`src/lib` (e.g. `src/lib/expenses-summary.ts`); unit tests live in
`tests/unit/**/*.test.ts`.

- **Runner.** Vitest runs two projects (`vitest.config.ts`): `unit` (node, no
  DB, no dotenv, parallel) and `integration`. `npm test` runs both; run units
  alone with `npx vitest run --project unit` — fast, needs no Supabase.
- **Extract first if needed.** Logic embedded in a React island or an API
  handler is not unit-testable. Lift the pure computation into an exported
  `src/lib` function (as the MoM/aggregation logic was extracted from
  `CategorySummary.tsx` into `expenses-summary.ts`); the component/handler
  then becomes a thin consumer. A plain `.ts` module keeps React/Recharts out
  of the unit test's module graph.
- **Assert from the rule, not the output (avoid the oracle problem).** Pin the
  documented PRD behaviour with small hand-built fixtures — e.g. strict
  `>20%` so exactly ±20% yields no marker, `previous = 0` → no marker, empty
  previous month → no markers. Never copy the function's current output into
  the expected value; that locks in bugs and can't fail for the right reason.
- **Characterization tests are separate and labelled.** When you must pin
  incidental current behaviour (float/cents, rounding artefacts), put it in a
  clearly-headed `*.characterization.test.ts` stating it asserts current
  behaviour and is expected to change on an intentional numeric-model change —
  distinct from the rule-based suite.
- **Bite-check.** Temporarily break a rule (e.g. `>` → `>=`) and confirm a
  boundary test fails, so you know the test actually defends the rule.

### 6.2 Adding an integration test (DB / RLS)

Established by Phase 1 (`testing-rls-authorization`). Tests live in
`tests/integration/**/*.test.ts`; shared primitives in
`tests/integration/helpers/supabase.ts`.

- **Prerequisite.** `npx supabase start` running, with both migrations
  applied. Put `SUPABASE_URL`, `SUPABASE_KEY` (anon), and
  `SUPABASE_SERVICE_ROLE_KEY` into a gitignored `.env.test` (one-liner:
  `npx supabase status -o env | sed -E 's/^API_URL=/SUPABASE_URL=/; s/^ANON_KEY=/SUPABASE_KEY=/; s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/'`).
- **Clients.** Use plain `@supabase/supabase-js` via the helpers'
  `anonClient()` — one instance per user, each carrying its own JWT so RLS
  runs per-user. **Never** import the SSR factory `src/lib/supabase.ts`: it
  needs the `astro:env/server` virtual module and is unusable from Node.
- **Fixtures.** `createAuthedUser(suffix)` (timestamp-unique email; email
  confirmations are off locally so signup yields a session), then
  `createBudget(client, name)` (the `create_budget` RPC; creator
  auto-joined — direct `budget_members` insert is blocked by policy), then
  `seedExpense(client, { budgetId, createdBy })` (valid enum `category`,
  `amount > 0`, `created_by = auth.uid()`). Keep each user in exactly one
  budget (the expense API assumes one membership per user).
- **Assert behaviour, with a positive control.** A cross-couple read must
  return `[]` (not an error); pair every isolation assertion with a control
  proving the owner still reads its own row, so the test can fail for the
  right reason. Add an RLS-enabled guard test (see `rls-guard.test.ts`) so a
  misconfigured harness fails loudly instead of passing green.
- **Teardown.** `afterAll` → `adminClient()` (service-role) +
  `deleteUser(id)`; the `auth.users` cascade removes budgets/members/
  expenses. Make it best-effort (`Promise.allSettled`) so one failure
  doesn't block the rest. The service-role key is read only from test
  `process.env` — never add it to the `astro:env` schema or app code.
- **Run.** `npm test`. The suite runs serially (`fileParallelism: false`)
  and creates ~2 users per run to stay under the local
  `sign_in_sign_ups = 30 / 5 min` limit; rapid reruns that 429 are a
  rate-limit flake, not a product bug.

### 6.3 Adding a test for a new API endpoint

Established by Phase 2 (`testing-api-contract`). Contract tests for JSON API
routes (`src/pages/api/**`) live in `tests/integration/**/*.test.ts`; shared
scaffolding in `tests/integration/helpers/api-context.ts`. They run in the
`integration` project but, unlike the RLS suite, need **no** local Supabase —
they mock the external edge.

- **Mechanism — invoke the handler, mock only the edge.** Import the route's
  `GET`/`POST`/`DELETE` exports and call them with a hand-built context from
  `makeContext({ method, body | rawBody, searchParams })`. `vi.mock("@/lib/supabase")`
  replaces the SSR client factory with one returning a scriptable fake — this is
  also what sidesteps the `astro:env/server` blocker, since replacing the module
  means its virtual-module import never runs. **The mock factory must not call
  `importActual`** (that re-triggers the import). Use `vi.hoisted` for the
  mutable client slot so the mock is set up before the handler import.
- **Script the fake per test.** `makeFakeSupabase({ user, membership,
expensesSelect, expensesInsert, expensesDelete })` controls auth state and each
  query's `{ data, error, count }`. Set the client to `null` to exercise the
  unauthenticated (401) path. `captured.insertedExpense` exposes the insert
  payload for assertions (e.g. cent-rounding).
- **Assert from the rule, not the implementation (oracle problem).** Validation
  expectations come from the PRD (amount `> 0` / `≤ 1,000,000` / cent precision;
  category from the predefined list — use literal good/bad values, never import
  `EXPENSE_CATEGORIES` or the handler's regex; strict `YYYY-MM-DD`).
- **Force errors to test the error boundary.** Drive a query's `error` to a
  realistic raw PostgREST message and assert the 5xx body is generic with **no**
  schema/constraint/column text — the security half of Risk #4. This is the
  contract, independent of the current string.
- **Bite-check.** Flip a validation boundary (`<= 0` → `< 0`) or re-introduce
  `error.message` into a 500 body and confirm a test fails, so the suite
  actually defends the rule.

### 6.4 Adding a component / sync test

- TBD — see §3 Phase 4 (pattern for RTL + fake timers + mocked fetch,
  asserting the rendered list rather than internal refs).

### 6.5 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line
note here capturing anything surprising the rollout phase taught.)

**Phase 1 (`testing-rls-authorization`, Risk #1).** Stood up Vitest 4 + the
local-Supabase integration harness and proved cross-couple read isolation on
`expenses` + `budgets`. Surprises: (1) the SSR client factory is unusable
from Node (`astro:env/server` virtual module) — tests use plain
`@supabase/supabase-js`; (2) the service-role key needed for teardown stays
in test `process.env` only, never the `astro:env` schema, so the app keeps
no RLS-bypass path. Risks #2 (membership/invite integrity) and #3 (delete
IDOR) remain deferred follow-ups in the same change folder — the §3 row
stays `implementing` until they ship.

**Phase 3 (`testing-expense-computation`, Risk #6).** Added a Vitest `unit`
project and pinned the aggregation, strict-`>20%` MoM, zero-base, and
first-month rules. The rules were already correct — the real work was a
behavior-preserving refactor extracting the pure functions out of the
`CategorySummary.tsx` island into `src/lib/expenses-summary.ts` so they're
reachable by a unit test (incl. a `resolveMarkers` fn folding in the
first-month gate). The month-boundary/timezone half of Risk #6
(`toLocalISODate`) was deferred — already fixed in `monthly-comparison` and
covered by its manual checks — so the §3 row stays `implementing` until that
sub-scope ships.

**Phase 2 (`testing-api-contract`, Risk #4).** Added contract tests for the
`expenses` JSON API plus a reusable route-handler harness
(`tests/integration/helpers/api-context.ts`: a scriptable fake Supabase client +
`makeContext`). Surprises/decisions: (1) the `astro:env/server` blocker that
forced plain `@supabase/supabase-js` in Phase 1 is dodged differently here —
`vi.mock("@/lib/supabase")` (no `importActual`) means the real factory and its
virtual-module import never load, so the handler runs in Node with a mocked
edge; (2) input validation was already solid, so the real work was the **error
boundary** — the three 500 paths leaked raw `error.message`, now sanitized to a
generic body with the cause logged server-side (mirrors `budgets/join.ts`).
**Deferred follow-up:** the form-route redirect leaks remain unsanitized and
untested — `budgets.ts` and the auth routes `signin.ts`/`signup.ts` still echo
raw `error.message` into a `302 ?error=` query string (vs. the sanitized
`join.ts`). Out of scope here (JSON boundary only; auth routes border §7 Auth
internals); revisit if those routes surface sensitive errors.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI snapshot / visual-diff tests** — pixel/snapshot tests of the
  dashboard, donut chart, and Tailwind layout are brittle and catch little;
  they churn constantly without signal. Re-evaluate only if a rendering
  regression actually ships. (Source: Phase 2 interview Q5.)
- **Supabase Auth internals** — email/password/session machinery is the
  vendor's responsibility, not ours to re-test. Re-evaluate if we wrap or
  customize the auth flow. (Source: Phase 2 interview Q5; standard.)
- **Generated `src/database.types.ts`** — the Supabase type generator is the
  test; asserting on its output is noise. Re-evaluate if types are
  hand-edited. (Source: Phase 2 interview Q5; standard.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-05
- Stack versions last verified: 2026-06-05
- AI-native tool references last verified: 2026-06-05

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
