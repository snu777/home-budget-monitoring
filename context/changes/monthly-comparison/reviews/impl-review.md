<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Month-over-Month Category Comparison

- **Plan**: context/changes/monthly-comparison/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-06-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Previous-month query inherits the existing UTC date-boundary quirk

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/expenses.ts:37-38
- **Detail**: `new Date(year, month, 1).toISOString()` builds a local-midnight date, then serializes in UTC. In a positive-offset timezone (e.g. Poland UTC+2), local midnight June 1 becomes "2026-05-31" in UTC, so the gte/lte window is shifted by one boundary day. This is a PRE-EXISTING quirk in the current-month query (from expense-data-schema); the plan explicitly chose to "apply the same gte/lte", so the previous-month window is shifted identically and the MoM comparison stays internally consistent. Noted only because near month boundaries a single day can land in the adjacent month's bucket, which can nudge a category's total across the ±20% threshold.
- **Fix**: Out of scope for this change (plan-adherent by design). If exact calendar months are wanted later, format boundaries from local Y/M/D directly instead of round-tripping through toISOString(), fixing it once for both the current-month and previous-month paths.
- **Decision**: FIXED — added `toLocalISODate()` helper in src/pages/api/expenses.ts; both current- and previous-month boundaries now formatted from local Y/M/D instead of toISOString(). Lint + build pass.
