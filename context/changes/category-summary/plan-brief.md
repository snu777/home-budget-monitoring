# Category Spending Summary — Plan Brief

> Full plan: `context/changes/category-summary/plan.md`

## What and why

Users can see their monthly expenses listed chronologically but have no way to understand where their money goes by category. This adds a per-category spending summary with a donut chart and monthly total to the dashboard — answering the question "how much did we spend, and on what?"

## Starting point

The dashboard already fetches the current month's expenses into React state with 5-second polling. Nine expense categories are defined as a Postgres enum. No summary or analytics components exist yet. The CSS theme already includes 5 chart color tokens.

## Desired end state

A "Podsumowanie" section appears between the add-expense form and the expense list. It shows a prominent monthly total, a Recharts donut chart with colored segments per category, and a legend with each category's name, amount, and percentage. Only categories with expenses are shown. The summary updates instantly when expenses are added or deleted.

## Key decisions taken

| Decision | Choice | Why (1 sentence) |
|----------|--------|-------------------|
| Visualization | Recharts donut chart | Most visually engaging; popular React charting library with good PieChart API |
| Data source | Client-side aggregation | Expenses already in React state; no new API endpoint needed for ~50 items/month |
| Placement | Above expense list | Natural information hierarchy — overview first, then details |
| Zero categories | Hidden | Cleaner UI when only 2-3 of 9 categories are used |
| Monthly total | Shown prominently | Answers the #1 question — "how much did we spend?" |

## Scope

**In scope:** Donut chart, category legend with amounts/percentages, monthly total, empty state, responsive layout, optimistic update reactivity

**Out of scope:** New API endpoints, server-side aggregation, month-over-month comparison (S-05), interactive chart features (tooltips, click-to-filter), category management

## Architecture / Approach

Pure client-side feature. A new `CategorySummary` React component receives the existing `expenses[]` from `ExpenseDashboard` state, aggregates by category, and renders using Recharts `PieChart`. The `formatAmount` utility is extracted to `src/lib/format.ts` for reuse. No database, API, or schema changes required.

## Phases at a glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. CategorySummary component | Recharts installed, formatAmount extracted, standalone component built | Recharts bundle size (~45KB gz); chart colors must be visible on dark background |
| 2. Dashboard integration | Component mounted in ExpenseDashboard, reactive to add/delete | Layout shift on mobile; must handle loading/empty states gracefully |

**Prerequisites:** S-01 (shared-expense-flow) completed — expense CRUD and dashboard exist
**Estimated effort:** ~1 session in 2 phases

## Open risks and assumptions

- Recharts compatibility with React 19 — widely used, but worth verifying during install
- 9 categories need 9 distinct colors; only 5 CSS chart tokens exist — 4 additional hardcoded colors needed

## Success criteria (summary)

- User sees a donut chart with per-category breakdown on the dashboard
- Monthly total is displayed prominently and matches sum of all expenses
- Summary updates instantly when expenses are added or deleted
