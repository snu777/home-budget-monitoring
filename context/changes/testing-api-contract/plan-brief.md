# API input + error-boundary contract (Test Plan Phase 2) — Plan Brief

> Full plan: `context/changes/testing-api-contract/plan.md`
> Research: `context/changes/testing-api-contract/research.md`

## What and why

Phase 2 of the test rollout proves **Risk #4 — untrusted input + error disclosure at the API boundary**: the server must reject bad input regardless of the client, and 5xx responses must not leak raw Postgres/schema text. The `expenses.ts` JSON API already validates input well, but it leaks raw `error.message` in three 500 responses — a real information-disclosure path for a private 2-person budget app.

## Starting point

`src/pages/api/expenses.ts` has solid inline server-side validation (amount bounds, category allow-list, strict date) but three `Response.json({ error: error.message }, { status: 500 })` leak sites (`:59,131,158`). There is **no existing pattern in `tests/` for invoking an Astro route handler**, and `src/lib/supabase.ts` imports `astro:env/server`, which Vitest can't resolve in the Node project. `budgets/join.ts` already shows the sanitized-error pattern to copy.

## Desired end state

`npm test` is green with a new `tests/integration/expenses-api-contract.test.ts` that drives the handlers through a mocked Supabase edge: bad input → 400 from the rule; a forced DB error → 500 with a generic, schema-free body; DELETE id edges handled cleanly. The 500 bodies are sanitized, and the reusable mock-the-edge scaffolding plus a documented §6.3 cookbook recipe make the next route-contract test cheap to write.

## Key decisions made

| Decision             | Choice                                                                                 | Why (1 sentence)                                                                                                                   | Source   |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Test mechanism       | Direct handler invocation + mock the `@/lib/supabase` edge                             | Reaches handler-local validation + error paths and sidesteps the `astro:env` blocker; matches §6.3's "mock only the external edge" | Plan     |
| `astro:env` blocker  | `vi.mock("@/lib/supabase")` with a factory that never imports the real module          | Replacing the module means its `astro:env/server` import never runs                                                                | Plan     |
| Leak scope           | Assert the three `expenses.ts` JSON 500s; record form-route leaks as a follow-up       | The JSON boundary is the contract-testable surface; form routes need redirect parsing and sit near §7 Auth exclusions              | Plan     |
| Leak vs assert-clean | Pair with a minimal sanitization fix so the clean-body assertion ships green           | Closes the actual vulnerability instead of pinning a known-bad behavior (oracle-problem guardrail)                                 | Plan     |
| DELETE edges         | Cover missing/garbage `id` + not-found; accept the 404/forbidden conflation            | Covers the untrusted-input angle cheaply; the conflation is intentional RLS-by-design                                              | Plan     |
| Oracle independence  | Assert from the PRD rule, never by importing `EXPENSE_CATEGORIES` or the handler regex | Avoids the tautological test that encodes current behavior                                                                         | Research |

## Scope

**In scope:** sanitize `expenses.ts` 500 bodies; contract tests for POST validation matrix, clean 500 bodies (GET/POST/DELETE), auth/authorization gates, DELETE id edges; reusable fake-client + `APIContext` helper; fill cookbook §6.3 + §6.5 note.

**Out of scope:** form-route redirect leaks (documented follow-up); auth-route input validation (§7 Auth internals); a distinct DELETE 403; introducing zod; re-covering RLS; any live-Supabase path for these tests.

## Architecture / approach

`vi.mock("@/lib/supabase")` returns a scriptable chainable thenable fake client; each test scripts `user`/`membership`/terminal `{ data, error, count }`, builds a minimal `APIContext` (real `Request` + cookies stub + `URL`), invokes the imported `GET`/`POST`/`DELETE`, and asserts status + JSON body. Forcing the terminal `error` is how the 500-body assertions are reached. The fix generalizes the three 500 bodies and logs detail server-side, mirroring `join.ts`.

## Phases at a glance

| Phase                  | Delivers                                                     | Key risk                                                                             |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1. Sanitize 500 bodies | Generic client message + server-side log at the 3 leak sites | A behavior change in production code; keep validation/auth bodies untouched          |
| 2. Contract-test suite | Mock-the-edge mechanism + all Risk #4 assertions, green      | Chainable-thenable fake must match the builder surface; mock must not `importActual` |
| 3. Cookbook + wiring   | §6.3 recipe, §6.5 note, §3 → complete, format                | Low — documentation + status reconciliation                                          |

**Prerequisites:** none beyond the existing Vitest harness (the suite is fully mocked — no `npx supabase start` needed). Phases 1 and 3 of the rollout already complete.
**Estimated effort:** ~1 session across 3 phases; Phase 2 is the bulk.

## Open risks and assumptions

- The chainable-thenable fake must faithfully match the Supabase builder surface the handler uses; if a method chain is missed, a test errors rather than asserting — mitigated by the small, enumerated surface in the plan.
- Assumes `@/types` stays side-effect-free (no `astro:env` import) so importing the handler under mock is clean; true today.
- The sanitization fix slightly widens a "test phase" into production code — accepted deliberately to ship a green clean-body assertion rather than a red/`.todo` marker.

## Success criteria (summary)

- `npm test` green (both projects); new contract suite green in isolation.
- A re-introduced `error.message` 500 body, or a flipped validation boundary, makes a test fail (bite checks).
- §6.3 documents a reusable contract-test recipe; §3 Phase 2 is `complete`.
