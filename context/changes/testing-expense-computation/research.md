---
date: 2026-06-08T00:00:00Z
researcher: snu777
git_commit: 1f66c9db9b2ff86fc5a5c66af08a295a473a8b74
branch: main
repository: home-budget-monitoring
topic: "Risk #6 — Category / month-over-month computation correctness: where the pure functions live and whether they're unit-testable"
tags: [research, codebase, computation, aggregation, month-over-month, timezone, risk-6, test-plan-phase-3]
status: complete
last_updated: 2026-06-08
last_updated_by: snu777
---

# Research: Risk #6 — Expense computation correctness

**Date**: 2026-06-08T00:00:00Z
**Researcher**: snu777
**Git Commit**: 1f66c9d (research state; source files referenced below are unchanged since pushed `origin/main` e94f02b)
**Branch**: main
**Repository**: home-budget-monitoring

## Research Question

From `context/foundation/test-plan.md` Risk #6 (Phase 3):

> Category / month-over-month computation: aggregation, the strict >20%
> threshold, the zero-base skip, the first-month rule, or month-boundary
> windows compute wrong, so the couple acts on bad numbers.

The Risk Response row for #6 requires research to ground: that the pure
functions (the plan *guesses* `aggregate` / `sumByCategory` /
`computeMarker` / `toLocalISODate`) are **exportable and side-effect
free**, and to verify the rules — strict `>20%` (not `≥`), zero-base skip
(not `+∞%`), first-month hide, and calendar-month windows that don't break
under a positive-offset TZ (`toISOString()` is UTC).

## Summary

**The rules are implemented correctly. The blocker for Risk #6 is
testability, not correctness.** Every behavior the test plan worried about
is right in the code:

- **Strict `>20%`, symmetric** — `delta > 0.2` / `delta < -0.2`; exactly
  ±20% is skipped. ✓
- **Zero-base guarded** — `if (previous === 0) return null` runs *before*
  the division, so no `Infinity`/`NaN`. ✓
- **First-month hide** — `hasPrevMonth = prevExpenses.length > 0` gates the
  marker. ✓ (but see the coupling caveat below)
- **Timezone** — the UTC `toISOString()` hazard was a real bug that **was
  already fixed**: `api/expenses.ts` uses a local-date formatter
  `toLocalISODate` and relies on `Date` normalization for Jan→Dec rollover. ✓
- **Rounding can't flip the boundary** — `Math.round` is applied to the
  returned percent *after* the threshold decision on the raw fraction. ✓

But the test plan's own "cheapest layer = unit (deterministic, no DB)"
**does not work as-is**, because:

> **The pure functions are side-effect-free but NOT exported.**
> `sumByCategory`, `computeMarker`, and `aggregate` are module-private
> helpers inside the React island `CategorySummary.tsx` (the only `export`
> is the default component). `toLocalISODate` and the month-window calc are
> inline/unexported inside the `GET /api/expenses` handler. A unit test
> **cannot import any of them today** without either rendering the React
> component (RTL) or adding `export`/extracting to `src/lib/`.

Two rules are additionally **not in the pure function** at all: the
**first-month gate** lives in the component body (`hasPrevMonth`, the call
site), and the **per-row percentage** (with its only division-by-zero
guard) is computed **inline in JSX**. So even after exporting
`computeMarker`, those two behaviors need either a small refactor (fold
them into pure functions) or a component test.

**Net for Phase 3:** the cheapest real-signal path is a tiny enabling
refactor — add `export` to the three `CategorySummary` helpers, extract
`toLocalISODate` + a `monthRange(now, offset)` helper into `src/lib/`, and
move the first-month gate and percentage into pure functions — *then* the
deterministic unit suite the plan wants becomes possible. Without that, the
only layer that reaches the logic is an RTL component test (more expensive,
and the test plan's §7 deliberately avoids snapshot/UI tests).

## Detailed Findings

### Area 1 — Category aggregation (the donut data)

All in [`src/components/expenses/CategorySummary.tsx`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/components/expenses/CategorySummary.tsx), **module-private, not exported**:

- `sumByCategory(expenses): Map<ExpenseCategory, number>` — `:45-51`. Pure
  group-by on `.category`, accumulating `.amount`. No rounding per row.
- `aggregate(expenses): { rows, total }` — `:64-78`. Calls `sumByCategory`,
  **filters `total > 0`** (drops zero/negative net categories from both the
  list *and* the grand total), sorts desc, assigns a cycling `fill` color,
  sums the grand total over surviving rows.
- The **per-category percentage** is *not* in a pure function — it's inline
  in JSX at `:122`: `total > 0 ? Math.round((row.total / total) * 100) : 0`.
  This is the only division-by-zero guard for the percentage and it lives in
  the render body.
- `formatAmount` (pl-PL, 2dp + " zł") **is** exported in
  [`src/lib/format.ts:1-8`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/lib/format.ts#L1-L8) — independently testable.

Edge facts worth a test: float/cents accumulation is naive (`amount` is
`NUMERIC(10,2)` → JS `number`; the write path rounds at insert, the read/
aggregation path does not); **there is no "Inne"/Other overflow bucket** —
"Inne" is just one of the 9 enum categories, and the test plan's assumption
of remainder bucketing is incorrect; sum-of-rounded-percentages need not
equal 100.

### Area 2 — Month-over-month marker

`computeMarker(current, previous): Marker | null` —
[`CategorySummary.tsx:56-62`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/components/expenses/CategorySummary.tsx#L56-L62), with `MOM_THRESHOLD = 0.2` (`:38`). **Pure, deterministic, NOT exported.**

```ts
if (previous === 0) return null;                 // zero-base skip — before the divide
const delta = (current - previous) / previous;
if (delta > MOM_THRESHOLD) return { direction: "up", percent: Math.round(delta * 100) };
if (delta < -MOM_THRESHOLD) return { direction: "down", percent: Math.round(Math.abs(delta) * 100) };
return null;                                      // exactly ±20% falls through → null
```

- **Strict `>`**, symmetric up/down, against the raw fraction `0.2`. Exactly
  20% → `null`. ✓
- **Rounding after the decision** — `Math.round(delta*100)` only shapes the
  displayed percent; the threshold is never compared to a rounded value, so
  rounding can't move a value across the gate. Cosmetic quirk: a 20.4%
  change displays as "20%", visually indistinguishable from a sub-threshold
  20% that shows nothing.
- **First-month rule is NOT inside `computeMarker`.** It's at
  `CategorySummary.tsx:87` (`const hasPrevMonth = prevExpenses.length > 0`)
  and the call site `:123` (`hasPrevMonth ? computeMarker(...) : null`). In
  practice it's redundant with the zero-base guard (empty prev → every
  `prevSums.get(cat) ?? 0` is 0 → `null`), but the *documented* first-month
  gate is structurally separate from the function under test.

### Area 3 — Month-boundary windows + timezone

All in [`src/pages/api/expenses.ts`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/pages/api/expenses.ts), **inline in the `GET` handler, not exported**:

- `toLocalISODate(d)` — `:11-16` — builds `YYYY-MM-DD` from local
  `getFullYear/getMonth/getDate`. **No `toISOString()`** in the window path,
  so no UTC shift. The TZ hazard the test plan named was real but is fixed.
- Boundaries — `:41-48`:
  ```ts
  const monthOffset = searchParams.get("month") === "previous" ? -1 : 0;
  const startOfMonth = toLocalISODate(new Date(y, now.getMonth() + monthOffset, 1));
  const endOfMonth   = toLocalISODate(new Date(y, now.getMonth() + monthOffset + 1, 0));
  ```
  Jan→prior-year-Dec rollover is automatic via `Date` normalization
  (`new Date(y, -1, 1)` → Dec 1 of `y-1`). ✓
- Passed to Supabase as inclusive `.gte("expense_date", start).lte(..., end)`
  (`:50-56`); `expense_date` is a Postgres `DATE`
  ([migration `:45`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/supabase/migrations/20260528000000_expense_data_schema.sql#L45)),
  so it's a clean calendar-day range, no TZ coercion.
- Residual `toISOString()` use is **UI-only** (the add-expense date default
  `today()` in `ExpenseDashboard.tsx:31-33`) — not a query boundary, not in
  scope for Risk #6.

## Code References

- `src/components/expenses/CategorySummary.tsx:38` — `MOM_THRESHOLD = 0.2`
- `src/components/expenses/CategorySummary.tsx:45-51` — `sumByCategory` (private)
- `src/components/expenses/CategorySummary.tsx:56-62` — `computeMarker` (private; strict >20%, zero-base guard)
- `src/components/expenses/CategorySummary.tsx:64-78` — `aggregate` (private; `total>0` filter, sort, grand total)
- `src/components/expenses/CategorySummary.tsx:87,123` — first-month gate (`hasPrevMonth`) — in the component, not the pure fn
- `src/components/expenses/CategorySummary.tsx:122` — per-row percentage inline in JSX (only %-div-by-zero guard)
- `src/components/expenses/CategorySummary.tsx:80` — the only `export` (default React component)
- `src/pages/api/expenses.ts:11-16` — `toLocalISODate` (private, local formatter)
- `src/pages/api/expenses.ts:41-48` — month-window calc + `month=previous` offset, Jan→Dec rollover
- `src/lib/format.ts:1-8` — `formatAmount` (exported; the one already-testable helper)
- `src/types.ts:7-17` — `EXPENSE_CATEGORIES` (9-element enum; not used by aggregation)

## Architecture Insights

- **Aggregation is client-side by design** — the dashboard already holds the
  current month's rows in React state; computing the donut in the browser
  avoids a new endpoint (S-04 decision). MoM adds a one-time
  `GET /api/expenses?month=previous` fetch into a separate `prevExpenses`
  state (S-05).
- **The math is genuinely pure but trapped in a `.tsx` island.** Purity is
  not the problem — reachability is. The single cheapest unblock is `export`
  + extraction; no `astro:env` virtual module is involved (unlike the RLS
  harness), so these would unit-test cleanly under the `@` alias.
- **Two behaviors are render-coupled** (first-month gate, percentage). A
  faithful unit suite for *all* of Risk #6's rules needs them lifted into
  pure functions, or it must accept an RTL component test for those two —
  which collides with test-plan §7 ("no UI snapshot/visual-diff tests").
- **The current Vitest config is integration-only** —
  `include: ["tests/integration/**/*.test.ts"]`, node env (from the Risk #1
  harness). A unit suite needs its own include glob / project (e.g.
  `tests/unit/**`), but no DB and no Astro pipeline.

## Historical Context (from prior changes)

- `context/foundation/prd.md` §Business Logic (≈ lines 84–94) — the
  authoritative rules: "increased by **more than 20%**" (→ strict `>`),
  threshold fixed at 20%, "first month … shows totals only — flags appear
  from the second month onward."
- `context/archive/2026-06-02-category-summary/` (S-04) — introduced
  `CategorySummary.tsx` and the client-side aggregation; impl-review
  APPROVED with one observation (double empty-state), aggregation left
  un-memoized ("fine at this scale").
- `context/changes/monthly-comparison/` (S-05) — added `computeMarker`, the
  `month=previous` branch, and **the timezone fix**. Its
  `reviews/impl-review.md` finding F1 is exactly the `toISOString()` → UTC
  shift the test plan names; decision: **FIXED** via `toLocalISODate()`,
  applied to both current and previous windows. Manual checks include
  "January resolves previous month to prior-year December" (passed).
- **Correction to one sub-agent claim / and to the test plan's wording:**
  the functions are *not* currently `export`ed (the historical agent
  inferred "exported" from the test plan's expectation; the live code at
  `CategorySummary.tsx` has no `export` on them). Per test-plan §1
  principle #3, the codebase is ground truth: they are private.

## Related Research

- `context/foundation/test-plan.md` §2 Risk #6 + Risk Response row #6 — the
  brief this grounds; §3 Phase 3 (unit); §6.1 cookbook (TBD → this phase).
- `context/changes/testing-rls-authorization/research.md` — sibling Risk #1
  research; its harness/Vitest config is the base a unit suite extends.

## Open Questions

1. **Refactor-to-test vs. test-through-render.** Risk #6's cheapest layer
   (unit) requires exports. Does the team accept a small enabling refactor
   (add `export`; extract `toLocalISODate`/`monthRange` to `src/lib/date.ts`;
   lift the first-month gate + percentage into pure fns), or prefer to test
   the as-is component via RTL (heavier, partial overlap with §7's
   no-UI-snapshot stance)? This is the central planning decision for Phase 3.
2. **Scope of "totals sum correctly."** Should the suite assert float/cents
   behavior (naive `+` accumulation, no per-row rounding) and the
   sum-of-rounded-percentages ≠ 100 quirk, or treat those as accepted MVP
   behavior and only pin the documented rules?
3. **Where the unit suite lives.** A new `tests/unit/**` include glob + a
   Vitest project/config separate from the integration harness — confirm the
   structure before Phase 3 planning.
4. **First-month rule coverage.** If not folded into `computeMarker`, how is
   the `hasPrevMonth` gate asserted deterministically without a full render?
