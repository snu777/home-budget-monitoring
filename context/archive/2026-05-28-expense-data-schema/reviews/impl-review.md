<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Expense Data Schema

- **Plan**: context/changes/expense-data-schema/plan.md
- **Scope**: All phases (1–2 of 2)
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical  1 warning  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — TOCTOU race on budget member count check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000001_secure_budget_creation.sql (join_budget_by_invite_code)
- **Detail**: The member count enforcement uses SELECT COUNT(*) then INSERT — a TOCTOU gap. Two concurrent calls could both read count=1 and both insert, exceeding the 2-member limit.
- **Fix A ⭐ Recommended**: Add FOR UPDATE to the SELECT that finds the budget row, serializing concurrent join attempts.
  - Strength: Standard Postgres pattern; minimal 1-clause change.
  - Tradeoff: Brief row-level contention (negligible at MVP scale).
  - Confidence: HIGH — standard advisory pattern.
  - Blind spot: None significant.
- **Fix B**: Accept the race at MVP scale — no code change.
  - Strength: Zero migration changes needed.
  - Tradeoff: No hard DB constraint; theoretically 3+ members possible.
  - Confidence: MEDIUM.
  - Blind spot: None.
- **Decision**: FIXED via Fix A — added FOR UPDATE to budget SELECT in join_budget_by_invite_code

### F2 — invite_code entropy (32 bits) is brute-forceable at scale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:25
- **Detail**: 8-char hex from UUID gives ~4.3B combinations. Acceptable at MVP scale; at production scale, rate-limiting or longer codes would be needed.
- **Fix**: No action now. Future hardening item.
- **Decision**: SKIPPED — acceptable at MVP scale
