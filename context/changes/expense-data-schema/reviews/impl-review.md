<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Expense Data Schema

- **Plan**: context/changes/expense-data-schema/plan.md
- **Scope**: All phases (1–2 of 2)
- **Date**: 2026-05-28
- **Verdict**: REJECTED
- **Findings**: 1 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — budget_members_insert_own bypasses invite gate entirely

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:97-100
- **Detail**: The "budget_members_insert_own" policy (WITH CHECK (user_id = auth.uid())) lets any authenticated user INSERT into budget_members with ANY budget_id. If a user learns a budget UUID (from a URL, API response, or error message), they can bypass the invite code entirely. Also linked to F2: budget creation needs a SECURITY DEFINER function too, or the creator can never SELECT their freshly-created budget (SELECT policy requires membership).
- **Fix A ⭐ Recommended**: Drop direct-insert policy; add create_budget() SECURITY DEFINER function. New migration drops "budget_members_insert_own" and adds create_budget(p_name TEXT DEFAULT NULL) RETURNS UUID SECURITY DEFINER that atomically inserts into budgets + budget_members. All budget_member rows created only through: create_budget() (owner) or join_budget_by_invite_code() (partner).
  - Strength: Invite code becomes the enforced gate. Eliminates UUID-guessing attack and atomicity gap in one step.
  - Tradeoff: S-01 must call create_budget() via RPC instead of direct INSERT to budgets.
  - Confidence: HIGH — same pattern as join_budget_by_invite_code already in place.
  - Blind spot: Verify supabase.rpc() works from Cloudflare Workers context.
- **Fix B**: Keep direct policy; accept UUID-guessing risk as minimal at MVP scale (pairs of users, no public budget IDs).
  - Strength: Zero new migrations; simpler S-01 implementation.
  - Tradeoff: Invite code is a UX gate, not a security gate. Violates PRD §Guardrails "private data: only the two partners can see their shared budget."
  - Confidence: LOW — PRD explicitly states privacy guarantee.
  - Blind spot: None; risk is accepted, not mitigated.
- **Decision**: FIXED via Fix A — 20260528000001_secure_budget_creation.sql (drops budget_members_insert_own, adds create_budget SECURITY DEFINER, hardens join function)

### F2 — auth.uid() not guarded against NULL inside SECURITY DEFINER function

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:155
- **Detail**: join_budget_by_invite_code is GRANTed only to authenticated, so auth.uid() should never be NULL. But if called by a superuser, via psql, or if grant accidentally widens, auth.uid() returns NULL and INSERT hits a NOT NULL violation — surfacing unhelpful internal error instead of clean 'unauthenticated' exception. If Fix A for F1 adds create_budget(), that function needs the same guard.
- **Fix**: Add at start of function body: `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;`
- **Decision**: ACCEPTED-AS-RULE: "SECURITY DEFINER functions must guard against NULL auth.uid()" — already fixed in migration 20260528000001 via F1 fix

### F3 — Any member can UPDATE budget (no owner concept)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:76-85
- **Detail**: budgets_update_members allows any member — including the joining partner — to UPDATE all budget columns including invite_code and name. No owner/member distinction. A joined partner can cycle the invite_code. At 2-person MVP this is low practical risk but violates the PRD model where creator controls sharing.
- **Fix A ⭐ Recommended**: Accept as-is for MVP; note for S-01. The PRD doesn't describe invite_code regeneration in MVP scope. S-01's UI won't expose a "regenerate code" button. Document the constraint.
  - Strength: Zero migration changes needed now.
  - Tradeoff: If S-01 exposes invite_code regeneration, needs revisit.
  - Confidence: MEDIUM.
  - Blind spot: PRD doesn't explicitly resolve who controls the invite code.
- **Fix B**: Add created_by UUID to budgets; restrict UPDATE policy to creator. ALTER TABLE budgets ADD COLUMN created_by UUID REFERENCES auth.users(id); UPDATE policy USING (created_by = auth.uid()).
  - Strength: Clean owner model; no future surprise.
  - Tradeoff: Another migration + S-01 must pass created_by on budget insert.
  - Confidence: HIGH.
  - Blind spot: Must populate created_by for existing rows (no rows yet, so fine).
- **Decision**: ACCEPTED — no UI for invite_code regeneration in S-01 MVP; risk accepted for now

### F4 — auth schema not in search_path of SECURITY DEFINER function

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:139
- **Detail**: SET search_path = public does not include auth schema. auth.uid() is schema-qualified throughout so it works today. But a malicious public.uid() function could shadow auth.uid() silently. Any new SECURITY DEFINER function added for F1 has same risk.
- **Fix**: Change `SET search_path = public` to `SET search_path = public, auth` in join_budget_by_invite_code and any new SECURITY DEFINER functions.
- **Decision**: FIXED via F1 migration — search_path = public, auth applied in both functions in 20260528000001

### F5 — Database generic not wired into createServerClient

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/supabase.ts:9
- **Detail**: createServerClient called without Database generic. src/database.types.ts exports Database but not imported. All .from('budgets') calls in S-01 will return any-typed rows. Plan notes this is S-01's responsibility.
- **Fix**: Add `import type { Database } from "@/database.types"` and change `createServerClient(...)` to `createServerClient<Database>(...)` in src/lib/supabase.ts.
- **Decision**: FIXED — added import type { Database } and createServerClient<Database> to src/lib/supabase.ts; build passes

### F6 — budgets.name nullable with no NOT NULL constraint

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:22
- **Detail**: name TEXT with no NOT NULL — intentional per plan (nullable). If UI always requires a name, validate at API boundary in S-01.
- **Fix**: No DB change needed for MVP. S-01 validates name is non-empty at API boundary.
- **Decision**: SKIPPED — nullable by design; S-01 validates at API boundary

### F7 — invite_code collision raises uncaught Postgres exception

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260528000000_expense_data_schema.sql:25
- **Detail**: 8-char truncated UUID hex gives ~4.3B combinations. UNIQUE constraint correctly errors on collision. At MVP scale negligible. If create_budget() SECURITY DEFINER function is added (F1 Fix A), it can catch unique violation and retry.
- **Fix**: No action now. Handle in create_budget() if F1 Fix A is applied.
- **Decision**: SKIPPED — acceptable at MVP scale; create_budget() can add retry logic in S-01 if needed
