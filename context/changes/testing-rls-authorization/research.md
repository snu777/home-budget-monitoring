---
date: 2026-06-08T00:00:00Z
researcher: snu777
git_commit: e94f02b04dcf0046ce449f35a462c813bf02074d
branch: main
repository: home-budget-monitoring
topic: "Risk #1 — Cross-couple data leak: where the read boundary lives and where it would break"
tags: [research, codebase, rls, supabase, authorization, budgets, expenses, budget_members, risk-1, test-plan-phase-1]
status: complete
last_updated: 2026-06-08
last_updated_by: snu777
---

# Research: Risk #1 — Cross-couple data leak (RLS authorization)

**Date**: 2026-06-08T00:00:00Z
**Researcher**: snu777
**Git Commit**: e94f02b04dcf0046ce449f35a462c813bf02074d
**Branch**: main
**Repository**: home-budget-monitoring

## Research Question

From `context/foundation/test-plan.md` Risk #1 (Phase 1):

> Cross-couple data leak: a user reads another budget's expenses /
> budgets / members because a policy is too permissive or relies on
> app-layer filtering.

The Risk Response row for #1 requires research to ground three things
before a test is written:

1. The actual RLS policies on `budgets` / `budget_members` / `expenses`.
2. How the user JWT reaches the query.
3. How membership scopes reads.

This document answers all three with `file:line` evidence, and — per §1
principle #3 of the test plan — establishes **where the failure would
actually live** so the Phase 1 integration test targets the real
boundary, not a guess.

## Summary

**No active cross-couple read leak exists at commit `e94f02b`.** All three
tables have RLS enabled, every SELECT policy is membership-scoped through
`auth.uid()`, there is no `USING (true)`, no `anon`/`public` read grant,
and no service-role key anywhere in the codebase. The per-request Supabase
client is built from the **anon key + the user's JWT cookie**, so
`auth.uid()` resolves to the caller and RLS is the live enforcement layer.

But the research surfaces the precise fact the test must pin down:

> **The single read boundary for the whole expenses surface is one RLS
> policy — `expenses_select_budget_members`. The `GET /api/expenses`
> handler applies NO application-layer `budget_id` filter; it fetches the
> caller's `membership.budget_id` and then never uses it in the query.**

So the failure does **not** live in the API handler (there is nothing to
get wrong there — it deliberately delegates to RLS). It lives **entirely**
in the database policy. If that one policy were dropped, disabled, or
weakened to `USING (true)`, every couple's expenses would leak on the very
next request, with zero app-layer backstop. That is exactly the scenario
Risk #1 names ("relies on app-layer filtering" — here it is the inverse:
relies *solely* on RLS), and it is why the test plan correctly insists on
an **integration test against real Postgres with two real users/budgets** —
mocking the Supabase client would prove nothing, because the client is not
where the boundary is.

This makes the cheapest *real-signal* test unambiguous: seed two budgets
(A, B) with distinct users, authenticate as user A, and assert that **no
read path returns any of budget B's rows** — and that an `anon` read
returns nothing.

## Detailed Findings

### Area 1 — The RLS policies (the actual read boundary)

Two migrations define everything; no later migration alters these policies.

- [`supabase/migrations/20260528000000_expense_data_schema.sql`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/supabase/migrations/20260528000000_expense_data_schema.sql) — creates the three tables, enables RLS, defines all policies, defines `join_budget_by_invite_code`.
- [`supabase/migrations/20260528000001_secure_budget_creation.sql`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/supabase/migrations/20260528000001_secure_budget_creation.sql) — adds `create_budget`, hardens the join function, **drops** `budget_members_insert_own`.

RLS is enabled on all three tables: `expense_data_schema.sql:52-54`.

**`budgets`**
- `budgets_select_members` (SELECT) — `:61-69` — `USING (EXISTS (SELECT 1 FROM budget_members bm WHERE bm.budget_id = budgets.id AND bm.user_id = auth.uid()))`. **Membership-scoped — safe.**
- `budgets_insert_authenticated` (INSERT) — `:72-74` — `WITH CHECK (auth.uid() IS NOT NULL)`. The only loosely-scoped policy, but it governs creating an *empty* budget only; it exposes no existing rows.
- `budgets_update_members` (UPDATE) — `:77-85` — same membership `EXISTS` subquery.

**`budget_members`**
- `budget_members_select_own` (SELECT) — `:93-95` — `USING (user_id = auth.uid())`. A user sees **only their own membership row**, never the partner's. This is deliberate to avoid RLS self-recursion (see Historical Context). It is not a leak; it is *more* restrictive than "all members of my budget".
- `budget_members_insert_own` (INSERT) — `:98-100` — **DROPPED** by `secure_budget_creation.sql:3`. After migration 2 there is **no direct INSERT policy**; all membership writes go through the two SECURITY DEFINER RPCs. (Relevant to Risk #2, not #1.)

**`expenses`** — *the highest-value target for Risk #1*
- `expenses_select_budget_members` (SELECT) — `:107-114` — `USING (budget_id IN (SELECT budget_id FROM budget_members WHERE user_id = auth.uid()))`. **This single policy is the entire cross-couple read boundary for expenses.**
- `expenses_insert_budget_members` (INSERT) — `:117-125` — `WITH CHECK (created_by = auth.uid() AND budget_id IN (...membership...))`.
- `expenses_delete_own` (DELETE) — `:128-130` — `USING (created_by = auth.uid())`. (Risk #3's boundary.)
- No UPDATE policy → expenses are immutable under RLS.

No `USING (true)`, no blanket-permissive read policy, no `anon`/`public` grant on any of the three tables.

### Area 2 — How the user JWT reaches the query

The client is per-request, anon-key, and JWT-cookie-scoped — so `auth.uid()`
inside the policies resolves to the logged-in user.

- [`src/lib/supabase.ts:6-25`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/lib/supabase.ts#L6-L25) — the **sole** client factory. Uses `@supabase/ssr` `createServerClient` with the anon `SUPABASE_KEY` (declared in [`astro.config.mjs:17-22`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/astro.config.mjs#L17-L22)), reading the session from the request `Cookie` header via `getAll()`/`parseCookieHeader` and writing refreshed cookies via `setAll()`. The SSR client attaches the access token as `Authorization: Bearer <jwt>` on every PostgREST/RPC call.
- **No service-role key** exists anywhere — grep for `service_role|serviceRole|SERVICE_ROLE|admin` over `src/` returns nothing. The env schema exposes only `SUPABASE_URL` + `SUPABASE_KEY`. There is therefore **no RLS-bypass path** in the app.
- **No module-level singleton.** The only `createServerClient` invocation is line 10 of the factory; every caller invokes `createClient(request.headers, cookies)` fresh per request. No one user's JWT can leak into another request.
- [`src/middleware.ts:1-25`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/middleware.ts) — attaches only `context.locals.user` (verified via `auth.getUser()`); it intentionally does **not** put a client on `locals`. `App.Locals` is typed `{ user: User | null }` at [`src/env.d.ts:1-5`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/env.d.ts). `PROTECTED_ROUTES = ["/dashboard"]`; API routes are not listed there and each enforces auth itself.

### Area 3 — How membership scopes reads (and where it relies 100% on RLS)

Every server read of the three tables uses the per-request user-scoped
client. Critically, the two expenses operations carry **no app-layer
budget filter**:

- [`src/pages/api/expenses.ts` GET, lines 50-56](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/pages/api/expenses.ts#L50-L56) — `from("expenses").select("*").gte("expense_date", …).lte("expense_date", …)`. It fetches `membership.budget_id` at `:31-35` but **never applies it** to the expenses query. **Isolation = `expenses_select_budget_members` RLS, nothing else.** → *Primary Risk #1 read path.*
- [`src/pages/api/expenses.ts` DELETE, ~line 150-160](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/pages/api/expenses.ts#L150-L160) — `delete({ count: "exact" }).eq("id", id)` where `id` comes from the client query string, with **no** `created_by`/`budget_id` filter. Isolation = `expenses_delete_own` RLS only; the `count` doubles as an existence-probe channel. → *Risk #3 path (follow-up).*
- [`src/pages/dashboard.astro:15-27`](https://github.com/snu777/home-budget-monitoring/blob/e94f02b04dcf0046ce449f35a462c813bf02074d/src/pages/dashboard.astro#L15-L27) — `budget_members.select("budget_id").eq("user_id", user.id)` then `budgets.select(...).eq("id", membership.budget_id)`. Here `budget_id` is **server-derived from the caller's own membership**, never client-supplied, and the page additionally `.eq("user_id", user.id)` — defense-in-depth.

**Key asymmetry the test must encode:** the `budget_members` reads were
explicitly hardened with `.eq("user_id", user.id)` defense-in-depth (see
Historical Context), but the **`expenses` GET and DELETE were not** given
an equivalent `.eq("budget_id", …)` / `.eq("created_by", …)` backstop.
They remain RLS-only. So the most fragile point in the entire isolation
story is `expenses_select_budget_members`.

**No client-supplied `budget_id` exists on any read path** — the classic
forged-`budget_id` IDOR vector is absent. The only client-controlled
identifiers reaching a query are `expenses.id` (DELETE) and `invite_code`
(RPC). So Risk #1's realistic failure is **a policy regression**, not a
parameter-tampering attack.

### Area 4 — SECURITY DEFINER functions (do they leak?)

- `create_budget(TEXT)` — `secure_budget_creation.sql:6-28` — SECURITY DEFINER, `SET search_path`, granted to `authenticated`, revoked from `anon`, guards `auth.uid() IS NULL`, inserts a budget + the caller's own membership, returns only the new `budget_id`. No cross-budget exposure.
- `join_budget_by_invite_code(TEXT)` — defined `expense_data_schema.sql:135-177`, hardened `secure_budget_creation.sql:34-77` — SECURITY DEFINER, guards NULL `auth.uid()`, locks the budget row `FOR UPDATE`, enforces the 2-member cap, inserts only `auth.uid()`, returns only `budget_id`. Worst case it confirms a valid invite code exists (the intended mechanism). No cross-budget data exposure.

Both always bind membership to `auth.uid()` (never a caller-supplied id),
so neither can be abused to read another couple's data.

## Code References

- `supabase/migrations/20260528000000_expense_data_schema.sql:52-54` — `ENABLE ROW LEVEL SECURITY` on all three tables
- `supabase/migrations/20260528000000_expense_data_schema.sql:107-114` — `expenses_select_budget_members` — **THE Risk #1 read boundary**
- `supabase/migrations/20260528000000_expense_data_schema.sql:61-69` — `budgets_select_members`
- `supabase/migrations/20260528000000_expense_data_schema.sql:93-95` — `budget_members_select_own` (own row only; anti-recursion)
- `supabase/migrations/20260528000000_expense_data_schema.sql:128-130` — `expenses_delete_own` (Risk #3)
- `supabase/migrations/20260528000001_secure_budget_creation.sql:3` — drops `budget_members_insert_own`
- `supabase/migrations/20260528000001_secure_budget_creation.sql:6-28` / `:34-77` — `create_budget` / hardened `join_budget_by_invite_code`
- `src/lib/supabase.ts:6-25` — per-request anon-key + JWT-cookie client (RLS is live)
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`
- `src/pages/api/expenses.ts:50-56` — GET expenses: **no app-layer `budget_id` filter; RLS-only**
- `src/pages/api/expenses.ts:150-160` — DELETE expenses: `.eq("id", id)` only; RLS-only (Risk #3)
- `src/pages/dashboard.astro:15-27` — membership-derived budget read (defense-in-depth `.eq("user_id", …)`)

## Architecture Insights

- **RLS is the single source of truth for expense isolation**, by design.
  The app layer deliberately omits a `budget_id` filter on `GET
  /api/expenses`. This is clean (one place to reason about), but it means
  the test for Risk #1 must hit **real Postgres** — a mocked client cannot
  exercise the only boundary that exists.
- **`budget_members` SELECT is `user_id = auth.uid()` (own-row only)**, not
  "all members of my budget". A test that expects a user to see the
  partner's membership row through this table would be asserting a leak;
  the correct expectation is the opposite.
- **Anon path:** with no session cookie, `createClient` still returns a
  client but `auth.uid()` is NULL, so every membership subquery matches
  zero rows → reads return nothing. The Risk #1 test should include an
  `anon`/unauthenticated read asserting empty results.
- **Defense-in-depth is uneven:** `budget_members` reads got an explicit
  `.eq("user_id", …)` backstop; `expenses` GET/DELETE did not. Not a bug
  today, but it is the documented soft spot a regression would exploit. A
  reasonable Phase-1 follow-up (out of test scope) is to add
  `.eq("budget_id", membership.budget_id)` to the GET query as a belt-and-
  suspenders layer.

## Historical Context (from prior changes)

- `context/archive/2026-05-28-expense-data-schema/plan.md:45-46` — the
  `budget_members` SELECT was **simplified to `user_id = auth.uid()` to
  escape `infinite recursion detected in policy`** when a self-referential
  subquery was used. Partner attribution ("Ty" vs "Partner") was moved to
  the **application layer** (compare `created_by` to `auth.uid()`). This
  explains why the partner's membership row is invisible by design.
- `context/archive/2026-05-28-expense-data-schema/plan.md:48` — the invite
  flow needs `SECURITY DEFINER` precisely because a non-member cannot
  SELECT `budgets` under `budgets_select_members`; the function bypasses
  RLS but enforces its own business rules.
- `context/archive/2026-05-28-shared-expense-flow/reviews/impl-review.md:23-31`
  — review **added `.eq("user_id", user.id)` to all three
  `budget_members` queries** as defense-in-depth, explicitly because "if
  RLS is ever misconfigured or service_role is accidentally used, the query
  could return the wrong row." Note: the same hardening was **not** applied
  to the `expenses` GET/DELETE — this is the asymmetry flagged above.
- `context/foundation/lessons.md` — every SECURITY DEFINER function using
  `auth.uid()` must guard `IF auth.uid() IS NULL THEN RAISE EXCEPTION
  'unauthenticated'`. Both RPCs comply (Risk #2 relevance).
- `context/changes/expense-delete/plan.md:72` — confirms the DELETE relies
  on `expenses_delete_own`: a non-owner delete returns `count: 0` (404),
  no Postgres error. (Risk #3 path.)
- `context/changes/monthly-comparison/plan.md:13,155` — the previous-month
  query needs **no new RLS policy**; `expenses_select_budget_members`
  already scopes it. Confirms temporal filters are orthogonal to access
  control and ride the same single boundary.

## Related Research

- `context/foundation/test-plan.md` §2 Risk #1, Risk Response row #1 — the
  brief this research grounds.
- This change (`testing-rls-authorization`) also covers Risk #2
  (membership/invite integrity) and Risk #3 (delete IDOR); their research
  will be appended here as follow-up sections.

## Open Questions

1. **Is RLS actually enabled in the running local DB the test harness will
   seed?** The migrations enable it (`:52-54`), but the Phase-1 harness
   must apply these migrations to the local Supabase instance and assert
   `relrowsecurity` is true — a harness that forgets to run migration 2, or
   that connects as the `postgres`/service role, would silently bypass the
   very boundary under test. This is the #1 thing the harness setup must
   get right.
2. **Should the test also cover the `anon` PostgREST role directly**
   (no JWT), independent of the app, to prove the policies (not the app
   guards) reject it? Recommended: yes — it isolates the DB boundary.
3. **Defense-in-depth follow-up (not a test):** add `.eq("budget_id",
   membership.budget_id)` to `GET /api/expenses` so isolation no longer
   rests on a single policy. Track separately from the test work.
