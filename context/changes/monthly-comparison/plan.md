# Month-over-Month Category Comparison Plan

## Overview

Add month-over-month (MoM) comparison markers to the per-category summary (`CategorySummary`, from S-04). For each category whose current-month total changed by more than 20% versus the previous month, render an inline marker: a red `↑+X%` for increases >20% and a green `↓−X%` for decreases >20%. Previous-month per-category totals come from a one-time fetch of the previous month via a parametrized `GET /api/expenses`. In the first month of use (previous month has no expenses at all) no markers appear anywhere; for a single category that had zero in the previous month, that category gets no marker (no comparison base).

## Current State Analysis

- `GET /api/expenses` (`src/pages/api/expenses.ts:31-41`) returns **only the current month** — it computes `startOfMonth`/`endOfMonth` from `new Date()` and has no parameter to select another month. There is no previous-month data anywhere today.
- `ExpenseDashboard` (`src/components/expenses/ExpenseDashboard.tsx:181-210`) fetches current-month expenses into `expenses` state and polls every 5s. It mounts `CategorySummary` (per S-04) and passes `expenses`.
- `CategorySummary` (S-04, `src/components/expenses/CategorySummary.tsx`) receives `expenses: Expense[]`, aggregates by `category`, filters zero-sum categories, sorts descending, and renders a donut + legend rows (color dot, name, amount, percentage). **This component does not exist yet** — S-04 is planned but not implemented.
- 9 fixed categories in `src/types.ts:7-17` (`EXPENSE_CATEGORIES`); `formatAmount` is extracted to `@/lib/format` by S-04.
- RLS already scopes `expenses` SELECT to budget members (`expenses_select_budget_members`, migration `20260528000000`), so a previous-month query needs no new policy.

### Key findings:

- The expenses API hardcodes the current month — previous-month data requires a query parameter, not a new table or migration (`src/pages/api/expenses.ts:31-33`).
- Client-side aggregation is the established pattern (`CategorySummary` from S-04); the comparison reuses it rather than introducing server-side aggregation.
- Polling drives recomputation of the current month; the previous month is immutable within a session, so it is fetched once on mount (`ExpenseDashboard.tsx:202-210` is the mount effect to extend).
- PRD §Business Logic (`context/foundation/prd.md:84-94`): fixed 20% threshold, marker = icon + % delta, first month = totals only.

## Desired End State

On the dashboard summary, each legend row may carry a MoM marker:
- Current total > previous total by **more than 20%** → red `TrendingUp` icon + `↑+X%`.
- Current total < previous total by **more than 20%** → green `TrendingDown` icon + `↓−X%`.
- Change within ±20% → no marker (row unchanged from S-04).
- Category had **zero** in the previous month → no marker (skip; no comparison base).
- Previous month has **no expenses at all** (first month of use) → no markers anywhere on the summary.

Verification: with seeded two-month data, categories crossing the ±20% boundary show the correct colored marker and integer percent; a fresh budget (no prior month) shows the S-04 summary with zero markers.

## What We Are NOT Doing

- No new database table, column, or migration — RLS and schema are unchanged.
- No server-side aggregation endpoint — aggregation stays client-side (consistent with S-04).
- No history beyond the previous month (PRD §Non-Goals: two months only).
- No persistence/caching of previous-month totals across sessions.
- No user-configurable threshold (PRD: fixed 20%).
- No standalone comparison screen — markers live inside the existing `CategorySummary`.
- No handling of month-rollover at midnight within a live session (acceptable for MVP; resolved on page reload).

## Implementation Approach

Two phases. Phase 1 makes previous-month data available: parametrize `GET /api/expenses` with an optional `month` selector and have `ExpenseDashboard` fetch the previous month once on mount, holding it in separate state and passing it to `CategorySummary`. Phase 2 puts the comparison logic and markers inside `CategorySummary`: aggregate previous-month expenses the same way as current, compute per-category deltas, and render colored icon + integer-percent markers with the documented edge-case rules.

The previous-month prop is optional so `CategorySummary` keeps working with current-month-only data (e.g., before this change, or when no prior month exists).

## Phase 1: Previous-month data

### Overview

Extend the expenses API to serve a selectable month and plumb previous-month expenses through `ExpenseDashboard` into `CategorySummary`.

### Changes Required:

#### 1. Parametrize the expenses GET by month

**File**: `src/pages/api/expenses.ts`

**Purpose**: Allow the same endpoint to return the previous month's expenses so the client can compute MoM comparison, without changing the default (current-month) behavior used by the expense list and S-04.

**Contract**: `GET /api/expenses` accepts an optional query param `month` with values `current` (default) or `previous`. When `previous`, compute `startOfMonth`/`endOfMonth` for the prior calendar month (handling January → previous-year December) and apply the same `gte`/`lte`/order. Any other/absent value behaves exactly as today. Response shape is unchanged (`{ expenses }`). Auth, membership check, and RLS scoping remain as-is.

#### 2. Fetch previous month once and pass it down

**File**: `src/components/expenses/ExpenseDashboard.tsx`

**Purpose**: Provide `CategorySummary` with the previous month's expenses, fetched a single time on mount (the previous month is immutable within a session), while the current month continues to refresh via the existing 5s poll.

**Contract**: Add state `prevExpenses: Expense[]` (default `[]`). In the mount effect (`:202-210`), after/alongside the initial `fetchExpenses()`, perform a one-time `fetch("/api/expenses?month=previous")` and store the result in `prevExpenses`; do **not** add it to the polling interval. Pass `prevExpenses` to `<CategorySummary>` as a new optional prop (e.g. `prevExpenses={prevExpenses}`). Current-month state, polling, optimistic add/delete, and the expense list are untouched.

### Success Criteria:

#### Automated verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual verification:

- `GET /api/expenses?month=previous` returns only prior-month expenses for the user's budget; default and `month=current` return the current month unchanged.
- January correctly resolves the previous month to the prior year's December.
- `ExpenseDashboard` issues exactly one previous-month request on load (not on every poll), verifiable in the network tab.

---

## Phase 2: Comparison logic and markers

### Overview

Inside `CategorySummary`, aggregate the previous-month expenses, compute per-category deltas, and render the colored icon + integer-percent markers with the agreed edge-case rules.

### Changes Required:

#### 1. Accept previous-month data and compute deltas

**File**: `src/components/expenses/CategorySummary.tsx`

**Purpose**: Turn current vs previous per-category totals into a marker decision per category.

**Contract**: Add optional prop `prevExpenses?: Expense[]` (default `[]`). Aggregate `prevExpenses` by category using the same grouping as current totals. For each category shown in the legend, derive a marker:
- If `prevExpenses` is empty (first month of use) → marker = none for all categories.
- Else if the category's previous total is `0` → none (skip; no base).
- Else compute `delta = (current − previous) / previous`. If `delta > 0.20` → `{ direction: "up", percent: round(delta*100) }`; if `delta < −0.20` → `{ direction: "down", percent: round(abs(delta)*100) }`; otherwise none.

Threshold is strict (`> 0.20`); percent is rounded to the nearest integer for display.

#### 2. Render the marker in legend rows

**File**: `src/components/expenses/CategorySummary.tsx`

**Purpose**: Show the marker inline in each category's legend row, matching the PRD example (icon + % delta).

**Contract**: In the legend row, when a category has a marker, render a `lucide-react` icon + text:
- up → `TrendingUp` icon with `↑+X%`, red (reuse the existing red accent already used elsewhere, e.g. the `text-red-300/400` tones in `ExpenseDashboard`).
- down → `TrendingDown` icon with `↓−X%`, green.
Categories without a marker render exactly as in S-04. The donut chart is unchanged. Layout must not overflow the legend row on mobile.

### Success Criteria:

#### Automated verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual verification:

- A category up >20% MoM shows a red `↑+X%` marker; down >20% shows a green `↓−X%`; within ±20% shows no marker.
- A category with spending this month but none last month shows no marker.
- A budget with no previous-month expenses shows the summary with zero markers (first-month behavior).
- Displayed percentages are integers and match a hand calculation.
- Markers update when the current month changes via polling (e.g., adding an expense pushes a category over the threshold within ~5s).
- Legend remains readable / non-overflowing on a mobile viewport.

---

## Testing Strategy

### Manual testing steps:

1. Seed a budget with previous-month expenses across several categories and current-month expenses that produce: one category up >20%, one down >20%, one within ±20%, one new (zero last month). Verify each renders the correct marker (or none).
2. Use a fresh budget with only current-month expenses → confirm no markers appear (first month).
3. Add an expense to a borderline category until it crosses +20% → confirm the red marker appears after the next poll.
4. Confirm the expense list and donut chart are unaffected.
5. Check mobile viewport for legend overflow.
6. Verify only one `?month=previous` request fires per page load.

## Performance Notes

Aggregating ~30–50 expenses for each of two months client-side is trivial. The previous month is fetched once, so the 5s poll cost is unchanged from S-04.

## Migration Notes

None — no schema or data migration. RLS already scopes previous-month reads to budget members.

## References

- Roadmap entry: `context/foundation/roadmap.md` — S-05
- PRD business rule: `context/foundation/prd.md:84-94` (§Business Logic), FR-008 (`:75`)
- Prerequisite plan (S-04): `context/changes/category-summary/plan.md`
- Expenses API: `src/pages/api/expenses.ts:31-48`
- Dashboard component: `src/components/expenses/ExpenseDashboard.tsx:181-210`
- Schema/RLS: `supabase/migrations/20260528000000_expense_data_schema.sql:107-114`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Don't rename step titles. See `references/progress-format.md`.

### Phase 1: Previous-month data

#### Automated

- [x] 1.1 Lint passes: npm run lint — 2738344
- [x] 1.2 Build succeeds: npm run build — 2738344

#### Manual

- [x] 1.3 `?month=previous` returns prior-month expenses; default unchanged — 2738344
- [x] 1.4 January resolves previous month to prior-year December — 2738344
- [x] 1.5 Exactly one previous-month request fires on load (not per poll) — 2738344

### Phase 2: Comparison logic and markers

#### Automated

- [x] 2.1 Lint passes: npm run lint
- [x] 2.2 Build succeeds: npm run build

#### Manual

- [x] 2.3 Up >20% red marker, down >20% green marker, within ±20% none
- [x] 2.4 Zero-previous category shows no marker
- [x] 2.5 No previous month → no markers anywhere (first-month behavior)
- [x] 2.6 Percentages are integers and match hand calculation
- [x] 2.7 Markers update via polling; legend non-overflowing on mobile
