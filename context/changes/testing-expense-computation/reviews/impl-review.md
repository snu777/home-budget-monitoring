<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Expense computation correctness (Risk #6)

- **Plan**: context/changes/testing-expense-computation/plan.md
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

All 9 planned items MATCH. The refactor is verified byte-identical to the
pre-refactor logic (`sumByCategory`/`computeMarker`/`aggregate` moved verbatim;
`resolveMarkers` reproduces the inline first-month + zero-base + threshold
composition exactly) — strictly behavior-preserving. The rule-based unit suite
asserts from the PRD rules (exact ±20%→null, `120.01`→flagged, zero-base→null;
no oracle-problem tautologies); characterization tests are labelled current-
behavior and numerically correct. Scope held: no computation behavior change,
the per-row percentage and date-window/TZ correctly deferred, no CI touch.
Automated success criteria green (17/17 unit, typecheck, lint); 2.1's
integration half user-confirmed on the local stack.

## Findings

### F1 — Percentage-display logic untested at its real call site

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria (coverage boundary)
- **Location**: tests/unit/expenses-summary.characterization.test.ts:35-38 vs src/components/expenses/CategorySummary.tsx:55
- **Detail**: The sum-of-rounded-percentages characterization test recomputes the `Math.round((row.total / total) * 100)` formula inline, because the per-row percentage still lives in the component's JSX (not the pure module). It pins a copy of the rule, not the rendered code — a change to the component's rounding would not fail a test. This is the documented out-of-scope boundary ("What We Are NOT Doing": the per-row percentage stays inline), so it's by-design, not a defect.
- **Fix**: Leave as-is (percentage was explicitly deferred), or in a small follow-up lift the per-row percentage into `expenses-summary.ts` and add a rule-based test so the real call site is covered.
- **Decision**: PENDING (documented out-of-scope boundary; no action taken this review)
