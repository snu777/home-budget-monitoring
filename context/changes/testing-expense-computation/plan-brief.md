# Expense computation correctness (Risk #6) — Plan Brief

> Full plan: `context/changes/testing-expense-computation/plan.md`
> Research: `context/changes/testing-expense-computation/research.md`

## What and why

Make the category-aggregation and month-over-month (MoM) computations
unit-testable, then pin the documented business rules with a deterministic
unit suite (test-plan Risk #6). The rules are already correct — the problem
is they're locked inside a React island and can't be reached by a unit test.

## Starting point

`sumByCategory` / `computeMarker` / `aggregate` are pure but module-private
in `CategorySummary.tsx`, and two rules (first-month gate, percentage) live
in the component/JSX. The Vitest harness from `testing-rls-authorization`
exists but is integration-only (node, dotenv, serial). No unit layer yet.

## Desired end state

`npm test` runs two Vitest projects — the existing integration suite and a
new fast unit suite — both green. The unit suite imports pure functions from
`src/lib/expenses-summary.ts` and asserts the Risk #6 rules from the PRD,
with the dashboard rendering exactly as before.

## Key decisions made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Testability approach | Extract/export to pure functions | Makes the cheapest deterministic layer real; matches §7 (no UI tests) | Research |
| Where compute lives | New `src/lib/expenses-summary.ts` | Decouples from the React island; keeps React/Recharts out of the unit test graph | Plan |
| First-month rule | One marker-resolution fn `(current, prev)` | Asserts the composed decision (first-month hides all, zero-base, >20%) in one pure call | Plan |
| Coverage | Aggregation + MoM marker + first-month | The agreed Risk #6 core | Plan |
| MVP quirks | Add labelled characterization tests | Document current float/percent/"Inne" behavior; catch drift | Plan |
| Date-window/TZ | Deferred | Already fixed (monthly-comparison) + covered by its manual checks | Plan |
| Refactor safety | Behavior-preserving; build/typecheck/lint + manual render guard | No unit tests exist yet to catch a regression | Plan |

## Scope

**In scope:** extract compute to `src/lib/expenses-summary.ts`; rewire
`CategorySummary.tsx`; add a Vitest `unit` project; unit tests for
aggregation, MoM marker boundaries, first-month; labelled characterization
tests; cookbook §6.1 + test-plan wiring.

**Out of scope:** `toLocalISODate`/month-window extraction & tests (deferred);
the per-row percentage; any computation *behavior* change; RTL/component or
snapshot tests; CI test step (test-plan Phase 5).

## Architecture / approach

Pure functions move to `src/lib/expenses-summary.ts` (one of them a
marker-resolution fn folding in the first-month gate); `CategorySummary.tsx`
becomes a thin consumer. A Vitest projects config separates the fast unit
project (no DB/dotenv, parallel) from the serial integration project, both
under one `npm test`. Tests assert PRD rules, never current output (oracle
problem), except the explicitly-labelled characterization file.

## Phases at a glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Extract compute | Pure `src/lib` module; component rewired | Behavior-preserving refactor with no tests yet — guarded by build + manual render |
| 2. Unit runner + suite | Two-project Vitest; Risk #6 + characterization tests green | Oracle-problem temptation; characterization tests must stay labelled |
| 3. Cookbook + wiring | §6.1 pattern + §3/§4 + change.md | Low — docs |

**Prerequisites:** the existing Vitest harness (from `testing-rls-authorization`).
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open risks and assumptions

- The Phase 1 refactor changes app code before any unit test exists; it must
  be a pure move, verified by build + a manual dashboard check.
- Characterization tests assert incidental output — they're expected to
  change on an intentional numeric-model change, unlike the rule tests.
- Date-window/TZ stays covered only by the `monthly-comparison` manual
  checks until a follow-up extracts it.

## Success criteria (summary)

- `npm test` green across both projects; dashboard visually unchanged.
- Breaking a rule (`>` → `>=`) fails a unit boundary test.
- The unit-test pattern is documented in §6.1 for the next contributor.
