---
id: testing-rls-authorization
title: "Test runner + RLS authorization (Test Plan Phase 1)"
status: implementing
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
  rows). *Researched first — see `research.md`.*
- **Risk #2** — Membership / invite-gate write integrity (join without
  invite, 2-member cap under concurrency, NULL `auth.uid()`).
- **Risk #3** — Delete IDOR (DELETE removes an expense the caller does
  not own).

The first research artifact (`research.md`) grounds **Risk #1**: where the
cross-couple read boundary actually lives in the code and where it would
break. Research for #2 and #3 is appended to the same document as
follow-up sections when those phases are driven.
