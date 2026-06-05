# Month-over-Month Category Comparison — Plan Brief

> Full plan: `context/changes/monthly-comparison/plan.md`

## What and why

Flag categories whose spending is changing fast so a couple can act on it. In the per-category summary (from S-04), mark each category that changed by more than 20% versus last month — a red `↑+X%` for increases and (by user decision) a green `↓−X%` for decreases. This delivers PRD §Business Logic / FR-008 — the "where is the money going *more*?" signal that a single-month summary can't give.

## Starting point

S-04 (`CategorySummary`) renders a donut + per-category legend from the current month's expenses, aggregated client-side. The expenses API (`GET /api/expenses`) only ever returns the current month — there is no previous-month data anywhere today. S-04 is planned but not yet implemented; this change assumes it lands first.

## Desired end state

Each legend row may carry a colored marker: red `↑+X%` when a category is up >20% MoM, green `↓−X%` when down >20%, nothing when within ±20% or when there's no comparison base. A brand-new budget (no prior month) shows the plain S-04 summary with no markers.

## Key decisions made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Previous-month data source | One-time fetch via parametrized `/api/expenses?month=previous` | Previous month is immutable in a session — fetch once, keep current-month polling lean | Plan |
| Zero-previous-month category | Skip marker | The 20% rule needs a non-zero base; `+∞%` would mislead | Plan |
| Marker visual | Icon (`TrendingUp`/`Down`) + `↑+X%` / `↓−X%`, red/green | Matches PRD example "🔴 Food ↑+50%" | Plan |
| Refresh model | Previous month once on mount; current month drives recompute via 5s poll | No redundant traffic on immutable data; markers still react to new expenses | Plan |
| First-month detection | Previous month has no expenses at all → no markers | Deterministic, straight from data; pairs with per-category skip rule | Plan |
| Rule scope | Flag increases >20% (red) **and** decreases >20% (green) | User chose to also surface savings — extends PRD (increases only) | Plan |
| Integration point | Extend `CategorySummary` with optional `prevExpenses` prop | One summary component, no duplicated aggregation/legend | Plan |
| Number format / threshold | Integer percent, strict `>20%` | Readable, matches spec | Plan |

## Scope

**In scope:** parametrized expenses GET (current/previous), one-time previous-month fetch in `ExpenseDashboard`, per-category delta + colored markers inside `CategorySummary`, all edge cases (zero base, empty previous month).

**Out of scope:** new tables/migrations, server-side aggregation, history beyond two months, configurable threshold, standalone comparison screen, midnight month-rollover in a live session.

## Architecture / approach

`ExpenseDashboard` keeps its current-month polling, adds a single `?month=previous` fetch on mount, and passes both current and previous expenses to `CategorySummary`. `CategorySummary` aggregates both months by category, computes `(current − previous) / previous` per category, and renders a red/green icon + integer-percent marker when `|delta| > 20%`, applying the skip rules. No server-side aggregation; RLS already scopes reads.

## Phases at a glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Previous-month data | `?month=previous` API param + one-time fetch plumbed into `CategorySummary` | January→prior-year December boundary; not polling the previous month |
| 2. Comparison logic + markers | Per-category deltas and red/green markers with edge cases | Edge-case correctness (zero base, empty prior month); mobile legend overflow |

**Prerequisites:** S-04 (`category-summary`) implemented — `CategorySummary.tsx` and `@/lib/format` must exist.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open risks and assumptions

- **Depends on unimplemented S-04** — if `CategorySummary` ships differently than its plan, Phase 2's prop/legend contract may need adjustment.
- **Decreases-in-green extends PRD** §Business Logic (which specifies increases only) — accepted as an explicit user decision.
- Month-rollover during a live session leaves stale previous-month data until reload (accepted for MVP).
- A budget that started mid-previous-month gets flagged against a partial base (accepted for MVP).

## Success criteria (summary)

- Categories crossing ±20% MoM show the correct colored marker with an integer percent matching a hand calculation.
- New categories (zero last month) and first-month budgets show no markers.
- The expense list, donut chart, and 5s polling behavior are unaffected; only one previous-month request fires per load.
