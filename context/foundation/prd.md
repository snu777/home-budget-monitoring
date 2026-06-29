---
project: "Home Budget Monitoring"
version: 1
status: draft
created: 2026-05-18
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 2
  hard_deadline: "2026-06-15"
  after_hours_only: null
---

## Vision & Problem Statement

A couple reaches the end of the month, looks at their bank balance, and can't explain where the money went. Both partners spend independently — there is no shared view, and no category breakdown. Without data, they can't identify which spending areas are growing or make conscious decisions about where money should go instead.

Insight: existing budget tools require too much initial setup and sustained manual categorization. When one partner stops entering data, the shared picture collapses entirely. The barrier isn't awareness — it's the effort required to maintain the habit as a team.

## User & Persona

**Primary persona**: A couple (exactly 2 people) sharing one household budget. Both partners make purchases independently throughout the month. The pain surfaces retrospectively — at month-end, when the bank balance shows the damage but provides no category explanation. The goal is to know which spending categories are increasing so the couple can act on that information.

## Success Criteria

### Primary

Both partners can log in, see the current month's shared expense list in chronological order, and add an expense with an amount and category from a predefined list — the expense appears immediately for both partners.

### Secondary

Per-category expense summary for the current month (e.g. Food: $200, Transport: $50) — answers "where does the money go?" at a glance.

### Guardrails

- Private data: only the two partners can see their shared budget — no outside access.
- Instant sync: when one partner adds or deletes an expense, the other sees it immediately, without manual refresh.
- Low entry barrier: adding an expense is fast and does not require re-login on every app launch.

## User Stories

### US-01: Adding an expense after a purchase

**Given** the user is logged in and has the app open,
**When** they enter an amount and select a category from the predefined list,
**Then** the expense appears immediately on the shared list — visible to their partner without refreshing.

## Functional Requirements

### Authentication & Account
- FR-001: User can register an account (email + password). Priority: must-have
  > Socratic: No counter-argument — an account is required to link two people to one shared budget.
- FR-002: User can log in to the app; session persists on the device. Priority: must-have
  > Socratic: No counter-argument — persistent session is required by the guardrail "instant entry without re-login."

### Shared Budget
- FR-003: User can generate an invitation code to share their budget with a partner. Priority: must-have
  > Socratic: No counter-argument — a code is the simplest sharing mechanism with no external email dependency.
- FR-004: User can join a shared budget by entering a partner's invitation code; the app is fully usable solo before a partner joins. Priority: must-have
  > Socratic: Counter-argument considered: "joining should be optional — solo mode must work first." Resolution: retained FR, constraint added — solo mode is a first-class state, not a degraded experience.

### Expenses
- FR-005: User can add an expense (amount, category from predefined list, date defaulting to today). Priority: must-have
  > Socratic: No counter-argument — category is the core data that enables the month-over-month comparison rule.
- FR-006: User can view the current month's shared expense list in chronological order, with attribution showing who added each entry. Priority: must-have
  > Socratic: Counter-argument considered: "a list without filters becomes hard to read at 30–50 entries per month." Resolution: retained as must-have; readability at scale goes to Open Questions.
- FR-007: User can delete their own expense after a confirmation step. Priority: must-have
  > Socratic: No counter-argument — deletion with confirmation is the minimum correction mechanism without the complexity of an edit flow.
- FR-009: User can edit their own expense (amount, category, date) in place. Priority: must-have
  > Socratic: Counter-argument considered: "delete-and-re-add is enough." Resolution: in-place edit added to complete the CRUD surface; ownership is enforced in the DB (RLS `expenses_update_own`), not only in the UI.

### Summary
- FR-008: User can view a per-category expense summary for the current month. Priority: nice-to-have
  > Socratic: Counter-argument considered: "a summary without historical comparison gives no context — '$200 on food' means nothing without last month." Resolution: retained as nice-to-have; historical context gap goes to Open Questions as potential v2 scope.

## Non-Functional Requirements

- Sync: an expense added by one partner appears for the other in < 3 seconds, without manual refresh.
- Privacy: expense data is never shared with third parties or used for advertising purposes.
- Platform: the app works on the latest two major versions of mainstream mobile browsers (iOS Safari, Android Chrome).

## Business Logic

The app compares each spending category's total for the current month against the previous month and flags categories that increased by more than 20%.

Inputs (user-visible): per-category expense totals for the current month and the previous month — both derived from the shared expense list.

Output: a visual marker on each flagged category in the summary screen (icon + percentage delta, e.g. "🔴 Food: $300 ↑+50% vs last month").

Threshold: fixed at 20% — the app decides autonomously, no user configuration required.

Constraint: the rule requires data from two calendar months. In the first month of use, the summary screen shows totals only — flags appear from the second month onward.

## Access Control

Authentication: email + password. Each partner registers their own account separately. Accounts are linked to a shared budget via a generated invitation code — one partner creates the code, the other enters it. Flat permission model: both partners see the same budget and have identical permissions (adding expenses, viewing the list, deleting their own entries). No admin roles or read-only tiers in MVP. The app is functional for a single user before a partner joins.

## Non-Goals

- No bank integration: expenses are entered manually — automatic import from bank accounts or payment apps is out of scope.
- No budget planning: the app tracks actual spending only — no monthly limits or plan-vs-actual comparison.
- (Removed non-goal) Expense editing is now in scope — see FR-009. In-place edit of an own expense (amount, category, date) is supported; ownership is enforced at the database via RLS.
- No history beyond two months: the month-over-month comparison rule requires the current and previous month; older data is not shown in MVP.

## Open Questions

1. **List readability at scale** — at 30–50 entries per month, a chronological list without filters or day-grouping may become hard to scan. Should MVP group entries by day, or paginate? Owner: user. Not blocking v1.
2. **Historical context for summary** — FR-008 (nice-to-have) without month history provides limited value ("$200 on food — but is that a lot?"). Should v2 include month-over-month comparison directly in the summary view, independent of the Business Logic flag rule? Owner: user. Potential v2 scope.
