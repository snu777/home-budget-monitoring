# Category Spending Summary Plan

## Overview

Add a per-category spending summary section to the dashboard showing a donut chart (Recharts), monthly total, and per-category breakdown. The summary appears above the expense list inside `ExpenseDashboard`, computed client-side from the existing `expenses` state — no new API endpoint needed.

## Current State Analysis

The dashboard (`src/pages/dashboard.astro`) renders `ExpenseDashboard` (`src/components/expenses/ExpenseDashboard.tsx`) as a React island. This component already fetches the full current month's expenses via `GET /api/expenses` with 5-second polling and stores them in React state (line 181). Expenses have a `category` field (one of 9 `expense_category` enum values) and a numeric `amount`.

The CSS (`src/styles/global.css`) already defines 5 chart color tokens (`--chart-1` through `--chart-5`) in both light and dark modes (lines 26-30, 60-64), which Recharts cells can reference.

No summary or analytics components exist yet.

### Key findings:

- Expense data already available in React state — `expenses: Expense[]` at `ExpenseDashboard.tsx:181`
- 9 categories defined in `src/types.ts:7-17` as `EXPENSE_CATEGORIES`
- `formatAmount()` helper already exists at `ExpenseDashboard.tsx:31-38` — reuse for consistent Polish locale formatting
- 5 chart CSS tokens available in `global.css:60-64` (dark mode) — will cycle through for 9 categories
- Dashboard uses glassmorphic card pattern: `rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`

## Desired End State

A new "Podsumowanie" section appears between the add-expense form and the expense list. It contains:
1. A prominent monthly total (e.g., "1 234,56 zł")
2. A Recharts donut chart showing category proportions with colored segments
3. A legend listing each non-zero category with its color, name, amount, and percentage

When there are no expenses, the section shows a simple empty-state message. The summary updates reactively as expenses are added/deleted (optimistic updates included).

## What We Are NOT Doing

- No new API endpoint — aggregation is client-side from existing `expenses` state
- No server-side caching or precomputation of summaries
- No monthly comparison or trend indicators (that's S-05)
- No interactive chart features (tooltips, click-to-filter)
- No category editing or management

## Implementation Approach

Two phases: (1) install Recharts and build a standalone `CategorySummary` component, (2) integrate it into `ExpenseDashboard` above the expense list.

The component receives `expenses: Expense[]` as a prop, aggregates by category, and renders using Recharts `PieChart` + `Cell` with the existing CSS chart color tokens. The `formatAmount` utility is extracted from `ExpenseDashboard` into a shared helper to avoid duplication.

## Phase 1: CategorySummary component

### Overview

Install Recharts, extract `formatAmount` to a shared utility, and build the `CategorySummary` React component with donut chart + legend + total.

### Changes Required:

#### 1. Install Recharts

**Purpose**: Add the charting dependency needed for the donut chart.

**Contract**: `npm install recharts` — adds `recharts` to `package.json` dependencies.

#### 2. Extract formatAmount to shared utility

**File**: `src/lib/format.ts` (new)

**Purpose**: Move `formatAmount` out of `ExpenseDashboard.tsx` so both `ExpenseDashboard` and `CategorySummary` can import it without duplication.

**Contract**: Export `formatAmount(amount: number): string` — identical to the current implementation at `ExpenseDashboard.tsx:31-38`. Update `ExpenseDashboard.tsx` to import from `@/lib/format` and remove the local definition.

#### 3. Build CategorySummary component

**File**: `src/components/expenses/CategorySummary.tsx` (new)

**Purpose**: Render a donut chart with per-category spending and a monthly total. Receives `expenses: Expense[]` prop, aggregates by category (skip zero-sum categories), and renders:
- Monthly total prominently displayed (centered or above chart)
- Recharts `PieChart` with `Pie` (donut via `innerRadius`/`outerRadius`) and `Cell` per category segment
- Legend below chart listing each category with color dot, name, amount, and percentage of total

**Contract**:
- Props: `{ expenses: Expense[] }`
- Aggregation: group expenses by `category`, sum `amount` per category, filter out categories with sum 0, sort descending by amount
- Colors: cycle through 9 distinct colors using CSS variables `var(--chart-1)` through `var(--chart-5)` plus 4 additional hardcoded complementary colors for the remaining categories
- Empty state: when `expenses` is empty, render "Brak danych do podsumowania." in the same `text-blue-100/40` style
- Card wrapper: use the glassmorphic pattern `rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl` consistent with other dashboard sections
- Header: "Podsumowanie" with month label in the same style as the expense list header

### Success Criteria:

#### Automated verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual verification:

- CategorySummary component renders correctly in isolation with sample data
- Donut chart segments are proportional and colored distinctly
- Legend shows category name, amount in Polish locale, and percentage
- Monthly total is prominently displayed
- Empty state shows appropriate message

---

## Phase 2: Dashboard integration

### Overview

Mount `CategorySummary` inside `ExpenseDashboard` between the add-expense form and the expense list. Handle loading state.

### Changes Required:

#### 1. Integrate CategorySummary into ExpenseDashboard

**File**: `src/components/expenses/ExpenseDashboard.tsx`

**Purpose**: Render `<CategorySummary expenses={expenses} />` between the add-expense form card (line 247-250) and the expense list card (line 252-330). Show the summary only when not in initial loading state (same guard as expense list: `!(loading && expenses.length === 0)`).

**Contract**: Import `CategorySummary` from `@/components/expenses/CategorySummary`. Insert it in the JSX between the two existing `div.rounded-2xl` blocks. The component handles its own empty state internally.

### Success Criteria:

#### Automated verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual verification:

- Summary section appears above the expense list on the dashboard
- Adding an expense updates the summary immediately (optimistic)
- Deleting an expense updates the summary immediately
- With no expenses, summary shows empty state message
- Chart colors are distinct and visible against the dark background
- Polish locale formatting is consistent (amounts with "zł", month name)
- Layout looks good on mobile (responsive, no overflow)

---

## Testing Strategy

### Manual testing:

1. Create a budget and add expenses across multiple categories — verify donut chart shows correct proportions
2. Add expenses in only 1-2 categories — verify unused categories are hidden
3. Delete an expense — verify summary updates immediately
4. View dashboard with zero expenses — verify empty state
5. Check mobile viewport — verify chart and legend are responsive
6. Verify amounts match between summary totals and individual expense list

## Performance Notes

Client-side aggregation of ~30-50 expenses per month is trivial. Recharts adds ~45KB gzipped to the bundle — acceptable for this feature. The chart re-renders on every `expenses` state change (including polling), but with small data sets this is imperceptible.

## References

- Expense types: `src/types.ts:1-17`
- Current dashboard component: `src/components/expenses/ExpenseDashboard.tsx`
- Chart CSS tokens: `src/styles/global.css:60-64`
- Roadmap entry: `context/foundation/roadmap.md` — S-04

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Don't rename step titles. See `references/progress-format.md`.

### Phase 1: CategorySummary component

#### Automated

- [x] 1.1 Lint passes: npm run lint — 5c784e7
- [x] 1.2 Build succeeds: npm run build — 5c784e7

#### Manual

- [x] 1.3 Donut chart renders with correct proportions and distinct colors — 5c784e7
- [x] 1.4 Legend shows category name, amount, and percentage — 5c784e7
- [x] 1.5 Monthly total is prominently displayed — 5c784e7
- [x] 1.6 Empty state shows appropriate message — 5c784e7

### Phase 2: Dashboard integration

#### Automated

- [x] 2.1 Lint passes: npm run lint
- [x] 2.2 Build succeeds: npm run build

#### Manual

- [x] 2.3 Summary section appears above expense list
- [x] 2.4 Adding/deleting expenses updates summary immediately
- [x] 2.5 Layout is responsive on mobile
- [x] 2.6 Polish locale formatting is consistent
