<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test runner + RLS authorization (Risk #1)

- **Plan**: context/changes/testing-rls-authorization/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-08
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

All 9 planned items MATCH the plan. Deviations are faithful in-scope
refinements: Vitest `testTimeout`/`hookTimeout` for network round-trips; a
required `createdBy` on `seedExpense` (the RLS `created_by = auth.uid()`
invariant demands it); `@/database.types` as the type source (blessed by
test-plan §7); `dotenv quiet:true`. Security is clean — service-role key
confined to test `process.env`, `.env.test` gitignored, no committed
secrets, guard test load-bearing assertion is the `listUsers` rejection.
Scope held — no app code, RLS policy, or CI changes. Automated success
criteria green (typecheck + lint); `npm test` verified on the user's stack.

## Findings

### F1 — Guard test teardown is not best-effort (can orphan a user)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: tests/integration/rls-guard.test.ts:30-34
- **Detail**: The guard suite's `afterAll` calls `deleteUser(adminClient(), user.userId)` directly. If that delete throws, `afterAll` fails and the guard user is orphaned in local Supabase. The isolation suite (`rls-isolation.test.ts:47-53`) already uses the best-effort `Promise.allSettled` pattern; the guard file is inconsistent. Harmless in practice (unique timestamped emails avoid rerun collisions), but an asymmetric reliability wart.
- **Fix**: Wrap the guard `afterAll` delete in `Promise.allSettled([...])` (or a try/catch swallow) so a failed teardown can't fail the suite, matching `rls-isolation.test.ts`.
- **Decision**: FIXED (wrapped guard `afterAll` delete in `Promise.allSettled`)
