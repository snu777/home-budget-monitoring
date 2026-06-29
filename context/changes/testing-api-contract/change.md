---
change_id: testing-api-contract
title: API input + error-boundary contract (Test Plan Phase 2)
status: implementing
created: 2026-06-29
updated: 2026-06-29
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md` (§3). Covers **Risk #4** —
untrusted input + error disclosure at the API boundary: the server trusts
client-side validation, or a 5xx response leaks raw Postgres / schema text.

Test types planned: integration / contract on the API route(s) under
`src/pages/api/` (hot-spot: 14 commits/30d).

Risk response intent (from §2 Risk Response Guidance, to verify — not blindly
accept — during research):

- **Prove:** the server rejects amount ≤ 0 / > 1,000,000 / sub-cent, invalid
  category, and malformed date regardless of the client; a 5xx body carries no
  schema or internal text.
- **Challenge:** "the client validated, so the server can trust it"; "returning
  `error.message` is harmless".
- **Ground:** the POST validation block and where `error.message` is returned
  to the client.
- **Anti-pattern to avoid:** the oracle problem (copying the validation regex
  into the test); valid-input-only coverage.
