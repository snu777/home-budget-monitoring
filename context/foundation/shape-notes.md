---
project: "Home Budget Monitoring"
context_type: greenfield
created: 2026-05-18
updated: 2026-05-18
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 8
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  after_hours_only: null
  hard_deadline: "2026-06-15"
  gray_areas_resolved:
    - topic: "pain moment"
      decision: "end of month — couple sees the bank balance and doesn't know where the money went"
    - topic: "cost today"
      decision: "nothing — relying on the bank balance with zero category visibility"
    - topic: "pain category"
      decision: "coordination overhead (two people, no shared view) + decision paralysis (can't act without data)"
    - topic: "insight"
      decision: "existing tools require too much setup and manual categorization — the habit dies when one partner stops"
    - topic: "persona scope"
      decision: "couple (exactly 2 people) sharing one household budget"
    - topic: "authentication"
      decision: "email + password — each partner registers separately"
    - topic: "sharing model"
      decision: "invitation code — one partner generates a code, the other enters it"
    - topic: "permissions"
      decision: "flat — both see everything, both can add expenses, no role distinction"
    - topic: "main screen"
      decision: "chronological list of expenses for the current month"
    - topic: "categories"
      decision: "predefined — fixed list built into the app, no custom categories in MVP"
  frs_drafted: 0
  quality_check_status: accepted
---

## Vision & Problem Statement

A couple reaches the end of the month, looks at their bank balance, and can't explain where the money went. Both partners spend independently — there is no shared view, and no category breakdown. Without data, they can't identify which spending areas are growing or make conscious decisions about where money should go instead.

Insight: existing budget tools require too much initial setup and sustained manual categorization. When one partner stops entering data, the shared picture collapses entirely. The barrier isn't awareness — it's the effort required to maintain the habit as a team.

## User & Persona

**Primary persona**: A couple (exactly 2 people) sharing one household budget. Both partners make purchases independently throughout the month. The pain surfaces retrospectively — at month-end, when the bank balance shows the damage but provides no category explanation. The goal is to know which spending categories are increasing so the couple can act on that information.

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
  > Socratic: No counter-argument — the shared list is the core screen of the product.
- FR-007: User can delete their own expense after a confirmation step. Priority: must-have
  > Socratic: No counter-argument — deletion with confirmation is the minimum correction mechanism without the complexity of an edit flow.

### Summary
- FR-008: User can view a per-category expense summary for the current month. Priority: nice-to-have
  > Socratic: Counter-argument considered: "a summary without historical comparison gives no context — '$200 on food' means nothing without last month." Resolution: retained as nice-to-have; historical context gap goes to Open Questions as potential v2 scope.

## Non-Goals

- No bank integration: expenses are entered manually — automatic import from bank accounts or payment apps is out of scope.
- No budget planning: the app tracks actual spending only — no monthly limits or plan-vs-actual comparison.
- No expense editing: to correct a mistake, the user deletes the entry and re-adds it — no in-place edit form.
- No history beyond two months: the month-over-month comparison rule requires the current and previous month; older data is not shown in MVP.

## Business Logic

The app compares each spending category's total for the current month against the previous month and flags categories that increased by more than 20%.

Inputs (user-visible): per-category expense totals for the current month and the previous month — both derived from the shared expense list.

Output: a visual marker on each flagged category in the summary screen (icon + percentage delta, e.g. "🔴 Food: $300 ↑+50% vs last month").

Threshold: fixed at 20% — the app decides autonomously, no user configuration required.

Constraint: the rule requires data from two calendar months. In the first month of use, the summary screen shows totals only — flags appear from the second month onward.

## Non-Functional Requirements

- Sync: an expense added by one partner appears for the other in < 3 seconds, without manual refresh.
- Privacy: expense data is never shared with third parties or used for advertising purposes.
- Platform: the app works on the latest two major versions of mainstream mobile browsers (iOS Safari, Android Chrome).

## User Stories

### US-01: Adding an expense after a purchase

**Given** the user is logged in and has the app open,
**When** they enter an amount and select a category from the predefined list,
**Then** the expense appears immediately on the shared list — visible to their partner without refreshing.

## Success Criteria

### Primary

Both partners can log in, see the current month's shared expense list, add an expense with an amount and category from a predefined list, browse all recorded expenses, and delete their own entries — all changes are visible to both partners immediately without refreshing.

### Secondary

Per-category expense summary for the current month (e.g. Food: $200, Transport: $50) — answers "where does the money go?" at a glance.

### Guardrails

- Private data: only the two partners can see their shared budget — no outside access.
- Instant sync: when one partner adds or deletes an expense, the other sees it immediately, without manual refresh.

## Access Control

Authentication: email + password. Each partner registers their own account separately. Accounts are linked to a shared budget via a generated invitation code — one partner creates the code, the other enters it. Flat permission model: both partners see the same budget and have identical permissions (adding expenses, viewing the list, deleting their own entries). No admin roles or read-only tiers in MVP. The app is functional for a single user before a partner joins.
