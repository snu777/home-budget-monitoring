---
id: testing-expense-computation
title: "Expense computation correctness (Test Plan Phase 3)"
status: implementing
created: 2026-06-08
updated: 2026-06-08
roadmap_ref: test-plan §3 Phase 3
risks: [6]
---

Prove the category aggregation, month-over-month (MoM) marker rules, and
month-boundary date windows are exact at the cheapest deterministic layer
(unit), per Phase 3 of `context/foundation/test-plan.md` (Risk #6).

The first artifact (`research.md`) grounds **Risk #6**: where the pure
computation functions actually live (`sumByCategory` / `computeMarker` /
`aggregate` in `CategorySummary.tsx`; `toLocalISODate` + the month-window
calc in `api/expenses.ts`), whether they are exportable and side-effect
free, and which business rules (strict >20%, zero-base skip, first-month
hide, calendar-month windows with positive-offset TZ) are correctly
implemented vs. coupled to UI/DB.

## Status

Shipped: a behavior-preserving refactor extracting the pure computations into
`src/lib/expenses-summary.ts`, a Vitest `unit` project, and the Risk #6 unit
suite covering **aggregation totals, the strict-`>20%` MoM marker (incl. exact
±20% → no marker), zero-base skip, and the first-month rule**, plus labelled
characterization tests for the accepted MVP numeric quirks. **Deferred:** the
month-boundary / timezone half of Risk #6 (`toLocalISODate` + the month-window
calc in `api/expenses.ts`) — already fixed in `monthly-comparison` and covered
by its manual checks; a cheap extract-and-unit-test follow-up. The test-plan
§3 Phase 3 row therefore stays `implementing` until that sub-scope ships.
