# Test runner + RLS authorization (Risk #1) — Plan Brief

> Full plan: `context/changes/testing-rls-authorization/plan.md`
> Research: `context/changes/testing-rls-authorization/research.md`

## What and why

Stand up the repo's first automated test harness (Vitest + local Supabase)
and use it to prove **cross-couple read isolation** — that user B can never
read user A's expenses or budgets. This is the highest risk in the test
plan (#1, High×High), and the boundary protecting it is a single RLS policy
with no application-layer backstop, so it must be tested against real
Postgres.

## Starting point

The repo has **zero test tooling** — no `test` script, no Vitest, no test
files. Local Supabase is already configured (two migrations,
`enable_confirmations = false`), and `@supabase/supabase-js` is already a
dependency. The isolation boundary today rests entirely on the
`expenses_select_budget_members` / `budgets_select_members` RLS policies;
`GET /api/expenses` applies no app-layer `budget_id` filter.

## Desired end state

`npm test` runs a green integration suite against a running local Supabase
that creates two real users, proves B reads none of A's expenses or budget
(with positive controls that A reads its own), guards against a
misconfigured harness silently passing, and cleans itself up — leaving the
DB as found.

## Key decisions made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test layer | Real-Postgres integration, two anon-key `supabase-js` clients | The boundary is RLS, not app code; a mock proves nothing | Research |
| Client path | Plain `supabase-js`, not the SSR `src/lib/supabase.ts` factory | Factory needs `astro:env/server` + cookies — unusable from Node | Research |
| DB lifecycle | Running instance + timestamp-unique IDs | Fast, non-destructive to dev data, matches independence rule | Plan |
| Teardown | Test-only service-role key, cascade-delete users in `afterAll` | One delete cleans the whole tree, leaves DB pristine | Plan |
| Fixtures | Two shared users created once, suite runs serially | ~2 signups/run — stays under the 30/5min rate limit | Plan |
| Coverage | Expenses + budgets cross-read (with positive controls) | Scoped to the core Risk #1 read boundary | Plan |
| Harness guard | RLS-enabled guard test | Turns research's silent-false-green risk into a loud failure | Plan |
| Runner config | Plain Vitest, env via `process.env`/dotenv | Sidesteps the `astro:env/server` virtual-module gotcha | Plan |

## Scope

**In scope:** Vitest + dotenv setup, `vitest.config.ts`, test env wiring
(`.env.test` + `.env.example` docs), harness helper module, RLS-enabled
guard test, cross-couple expenses + budgets isolation suite, cookbook +
test-plan updates.

**Out of scope:** Risks #2 (membership/invite) and #3 (delete IDOR);
`budget_members` own-row test; anon/unauthenticated read (flagged as a
cheap follow-up — it is named in the test plan's Risk #1 criteria);
cross-budget INSERT rejection; CI test step (test-plan Phase 5); any app or
RLS-policy change.

## Architecture / approach

Two anon-key `supabase-js` clients act as two real users and exercise RLS
per-user via their own JWTs; a third **service-role** client exists only
for teardown. Vitest is standalone (no Astro integration), reads config
from `process.env`, runs the integration file serially, and creates its two
users once. The service-role key lives only in test `process.env` — never
in the `astro:env` schema or the app — preserving the property that the app
has no RLS-bypass path.

## Phases at a glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Runner + harness | `npm test` works; RLS-guard test green | The `astro:env`/service-role-key wiring is the fiddly part |
| 2. Isolation suite | B reads none of A's expenses/budgets, proven | Teardown must be idempotent; rate limit on reruns |
| 3. Cookbook + wiring | §6.2 pattern + stack/status updated | Low — documentation |

**Prerequisites:** `npx supabase start` running locally with the two
migrations applied; URL + anon key + service-role key copied into
`.env.test`.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open risks and assumptions

- Assumes the running local instance has both migrations applied (lifecycle
  is "running instance", not reset) — the RLS-guard test partially covers
  this by failing loudly if RLS isn't enforced.
- Rapid full-suite reruns can approach the local `sign_in_sign_ups = 30 /
  5 min` limit; mitigated by creating only two users per run.
- The service-role key is powerful; it must stay gitignored and out of the
  app env schema.

## Success criteria (summary)

- `npm test` is green against running local Supabase.
- Breaking an RLS policy to `USING (true)` makes the isolation suite fail
  (the test bites).
- A run leaves no orphan test users/budgets behind.
