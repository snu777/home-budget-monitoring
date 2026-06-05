<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Shared Expense Flow (S-01)

- **Plan**: context/changes/shared-expense-flow/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-05-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  5 warnings  5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — budget_members query relies solely on RLS, no app-layer user filter

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/expenses.ts:21, src/pages/api/expenses.ts:62, src/pages/dashboard.astro:15
- **Detail**: All three budget_members queries have no .eq("user_id", user.id) filter. The RLS policy (user_id = auth.uid()) IS the security mechanism and correctly restricts rows, but defense-in-depth requires the app layer to also scope by user. If RLS is ever misconfigured or service_role is accidentally used, the query could return the wrong row.
- **Fix**: Add `.eq("user_id", user.id)` to all three budget_members queries.
- **Decision**: FIXED — added .eq("user_id", user.id) to expenses.ts:21, :62 and dashboard.astro:15; also fixed F9 (if supabase && user → if supabase) in the same edit

### F2 — Date validation accepts structurally valid but logically invalid dates

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/expenses.ts:88
- **Detail**: Regex /^\d{4}-\d{2}-\d{2}$/ accepts "2024-13-99" — format is valid but date is nonsense. DB may store it or error with a raw Postgres message returned to caller (leaks schema info on line 99).
- **Fix**: After regex check, add: `const d = new Date(expense_date); if (isNaN(d.getTime())) return Response.json({error:"Invalid date"}, {status:400});`
- **Decision**: ALREADY FIXED — current expenses.ts already has the `isNaN(new Date(expense_date).getTime())` guard (codebase evolved since the 2026-05-28 review).

### F3 — Amount has no upper bound; sub-cent values accepted without rounding

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/expenses.ts:80
- **Detail**: amount > 0 is the only check. Client can send 1e308 (overflow) or 0.001 (sub-cent). NUMERIC(10,2) column rounds at DB level, but rounding-before-insert keeps API contract honest.
- **Fix**: Add `if (amount > 1_000_000) return Response.json({error:"Amount too large"},{status:400});` and `const safeAmount = Math.round(amount * 100) / 100;` before insert.
- **Decision**: FIXED — added upper-bound guard (> 1_000_000) and `safeAmount = Math.round(amount * 100) / 100` used in the insert (expenses.ts).

### F4 — Polling silently ignores HTTP 401; session expiry leaves stale UI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/components/expenses/ExpenseDashboard.tsx:167-180
- **Detail**: When the session expires, GET /api/expenses returns 401 JSON. fetch() resolves, .catch() never fires, data.expenses is undefined, stale list stays on screen indefinitely. User has no idea their session expired.
- **Fix A ⭐ Recommended**: Check res.ok/res.status in first .then(); stop polling on 401 and redirect to /auth/signin. Strength: Exact fix for symptom. Tradeoff: Polling stops on any server error. Confidence: HIGH. Blind spot: None significant.
- **Fix B**: Add global error state + banner — show "Session expired" banner without redirecting. Tradeoff: Polling still runs every 5s while showing banner.
- **Decision**: FIXED via Fix A — fetchExpenses checks res.status === 401, clears the interval, and redirects to /auth/signin (ExpenseDashboard.tsx).

### F5 — Race condition: poll can overwrite optimistic entry before POST resolves

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/expenses/ExpenseDashboard.tsx:183-191
- **Detail**: If a 5s poll fires while a POST is in-flight, setExpenses(data.expenses) replaces the full array — the optimistic entry (temp UUID) disappears. In error path: user sees entry vanish and reappear on next poll — confusing.
- **Fix A ⭐ Recommended**: Track in-flight optimistic IDs in a ref Set; on poll, preserve expenses whose id is in the Set. Strength: Correct merge semantics. Tradeoff: ~15 lines of additional logic. Confidence: HIGH. Blind spot: onAdd/onRemove must also update the ref Set.
- **Fix B**: Pause polling during in-flight POST (set `posting` ref). Simpler but delays partner sync during POST.
- **Decision**: FIXED via Fix A — optimisticIdsRef Set tracks in-flight entries; poll merges them back (`[...fresh, ...inFlight]`), handleAdd/handleRemove/handleConfirm keep the Set in sync, and the form calls onConfirm on POST success (ExpenseDashboard.tsx).

### F6 — budgetId prop accepted but not used in ExpenseDashboard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/expenses/ExpenseDashboard.tsx:162
- **Detail**: Props interface declares budgetId but component destructures only currentUserId. Dead prop is misleading and prevents the performance optimization of passing budget_id as query param to skip one DB round-trip.
- **Fix**: Remove budgetId from Props + Astro template, OR pass it to fetch as ?budget_id= and use in API to skip membership lookup.
- **Decision**: FIXED — removed the unused budgetId from Props and from the dashboard.astro call site (no behavior change).

### F7 — p_name: name ?? undefined passes undefined instead of null for empty names

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/budgets.ts:22
- **Detail**: name is null when field is empty, null ?? undefined = undefined. RPC treats missing argument as NULL — functionally correct but fragile if RPC signature changes.
- **Fix**: Pass null explicitly: `supabase.rpc("create_budget", {p_name: name})`
- **Decision**: DISMISSED — finding is incompatible with the generated types. database.types.ts types the arg as `p_name?: string` (optional, non-nullable), so `p_name: name` (string | null) fails type-check. Omitting via `name ?? undefined` is correct: the SQL `DEFAULT NULL` applies. Left as-is.

### F8 — signup.ts missing export const prerender = false (pre-existing)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signup.ts:1
- **Detail**: All new API routes correctly export prerender = false. The existing signup.ts does not — works because output:"server" makes SSR default, but violates the explicit project rule and sets a bad example.
- **Fix**: Add `export const prerender = false;` to signup.ts, signin.ts, signout.ts.
- **Decision**: FIXED — added `export const prerender = false;` to signup.ts, signin.ts, and signout.ts.

### F9 — Redundant supabase && user guard after early return in dashboard.astro

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:13
- **Detail**: if (!user) return at line 7 guarantees user is non-null. The subsequent if (supabase && user) at line 13 is dead code for the user part — misleads readers.
- **Fix**: Change `if (supabase && user)` to `if (supabase)`.
- **Decision**: ALREADY FIXED — dashboard.astro already uses `if (supabase)` (resolved alongside F1 in a prior edit).

### F10 — category not reset after successful expense add

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/expenses/ExpenseDashboard.tsx:77-79
- **Detail**: On success the form clears amount and date but category stays at previously selected value. Plan says "czyści pola formularza". Minor; sticky category may be intentional UX but should be documented.
- **Fix**: Add `setCategory(EXPENSE_CATEGORIES[0])` after date reset, or document that sticky category is intentional.
- **Decision**: SKIPPED — user opted to leave sticky category as-is for now.
