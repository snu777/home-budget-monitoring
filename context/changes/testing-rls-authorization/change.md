---
id: testing-rls-authorization
title: "Test runner + RLS authorization (Test Plan Phase 1)"
status: impl_reviewed
created: 2026-06-08
updated: 2026-06-08
roadmap_ref: test-plan §3 Phase 1
risks: [1, 2, 3]
---

Stand up Vitest + a local-Supabase integration harness and prove
cross-couple isolation and membership integrity on all three tables
(`budgets`, `budget_members`, `expenses`).

This change implements Phase 1 of `context/foundation/test-plan.md`. It
covers three risks from the Risk Map:

- **Risk #1** — Cross-couple data leak (a user reads another budget's
  rows). _Researched first — see `research.md`._
- **Risk #2** — Membership / invite-gate write integrity (join without
  invite, 2-member cap under concurrency, NULL `auth.uid()`).
- **Risk #3** — Delete IDOR (DELETE removes an expense the caller does
  not own).

The first research artifact (`research.md`) grounds **Risk #1**: where the
cross-couple read boundary actually lives in the code and where it would
break. Research for #2 and #3 is appended to the same document as
follow-up sections when those phases are driven.

## Status

The implemented plan (`plan.md`) is scoped to **Risk #1 only**: the Vitest +
local-Supabase harness (`tests/integration/helpers/`, `vitest.config.ts`),
the RLS-enabled guard test, and the cross-couple expenses + budgets
read-isolation suite. **Risks #2 (membership/invite integrity) and #3
(delete IDOR) remain open** — they reuse this harness and will be driven by
a follow-up research → plan pass in this same change folder. The
`test-plan.md` §3 Phase 1 row therefore stays `implementing` until #2/#3
ship.
