# Deployment Plan — home-budget-monitoring

**Platform:** Cloudflare Workers  
**Stack:** Astro 6 SSR + @astrojs/cloudflare v13 + Supabase (external)  
**Account:** kontostim1998@gmail.com (ID: `2632816e07d78d0317fab99ed45fde5a`)  
**Plan created:** 2026-05-20  
**Plan updated:** 2026-05-21 (corrected stale statuses, added Phase 0)  
**Deployed:** 2026-05-21 · Version ID: `d8396a75-23c3-478a-a639-c22d37bb2f89`  
**Production URL:** https://home-budget-monitoring.kontostim1998.workers.dev  
**Source contracts:** `context/foundation/infrastructure.md`, `context/foundation/tech-stack.md`

Legend: 🤖 agent executes · 👤 human must execute · ✅ already correct

---

## Phase 0 — Cloudflare authentication  👤

Run once before Phase 2 (opens browser, stores credentials in `~/.wrangler`):

```bash
npx wrangler login
```

Verify the session is active and points to the correct account:

```bash
npx wrangler whoami
# Expected: kontostim1998@gmail.com · account 2632816e07d78d0317fab99ed45fde5a
```

---

## Phase 1 — Pre-deploy config  ✅ ALL DONE

### 1.1 Worker name in wrangler.jsonc  ✅

`name` is already `home-budget-monitoring` — no change needed.

### 1.2 `nodejs_compat` flag  ✅

`compatibility_flags: ["nodejs_compat"]` is already present in `wrangler.jsonc`. The Supabase JS client requires this flag for `crypto` / `TextEncoder` APIs — no change needed.

### 1.3 tech-stack.md deployment_target  ✅

`deployment_target: cloudflare-workers` is already correct — no change needed.

### 1.4 CI branch  ✅

`.github/workflows/ci.yml` already listens on `main` for both `push` and `pull_request` — no change needed.

### 1.5 CI deploy job  ✅

A `deploy` job that runs `npx wrangler deploy` after `ci` succeeds is already present in `ci.yml` — no change needed.

---

## Phase 2 — Secrets setup  👤

These must be executed by a human — secrets are write-once via CLI and never readable afterward.

Run in the project root (requires active `wrangler login` session from Phase 0):

```bash
npx wrangler secret put SUPABASE_URL
# paste your Supabase project URL when prompted
# e.g. https://<ref>.supabase.co  or  http://127.0.0.1:54321 for local

npx wrangler secret put SUPABASE_KEY
# paste your Supabase anon key when prompted
```

**Verification:** Secrets appear in Cloudflare dashboard → Workers → `home-budget-monitoring` → Settings → Variables (values are hidden — only the key names are visible).

> **Note:** Both variables are also declared in `astro.config.mjs` under `astro:env` schema (as `context: "server", access: "secret"`). The double-declaration (Cloudflare side + Astro side) is required — omitting either side gives a "variable undefined" runtime error, not a config error.

---

## Phase 3 — First manual deploy  ✅ DONE 2026-05-21

```bash
npm run build
npx wrangler deploy
```

Expected output:
```
✨ Successfully deployed to https://home-budget-monitoring.<account>.workers.dev
```

**Parallel terminal — watch live logs during verification:**
```bash
npx wrangler tail --status error
```

**Smoke tests after deploy:**
1. `GET /` — home page loads (HTTP 200)
2. `GET /auth/signin` — sign-in form renders
3. `GET /dashboard` — redirects to `/auth/signin` (auth guard working)
4. Sign up with a test email → sign in → `/dashboard` loads

**If a 500 appears with no stack trace in `wrangler tail`:** likely CPU time limit (10ms on free tier) exceeded by Supabase JWT parsing. Upgrade to the $5/month Workers Paid plan if this occurs consistently.

---

## Phase 4 — CI/CD pipeline setup

### 4.1 Add Cloudflare + Supabase secrets to GitHub repository  👤

Go to GitHub → repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Create at dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, scoped to account `2632816e07d78d0317fab99ed45fde5a` |
| `CLOUDFLARE_ACCOUNT_ID` | `2632816e07d78d0317fab99ed45fde5a` |
| `SUPABASE_URL` | Same value used in Phase 2 (needed for build step) |
| `SUPABASE_KEY` | Same value used in Phase 2 (needed for build step) |

**API Token minimum permissions:**
- Account: Workers Scripts → Edit
- Account: Workers Routes → Edit  
- Zone: (none required for workers.dev subdomain)

### 4.2 CI deploy job  ✅

The `deploy` job already exists in `.github/workflows/ci.yml`. After adding the four secrets above, pushes to `main` will trigger lint → build → deploy automatically.

---

## Phase 5 — Post-deploy verification checklist

| Check | Command / Method | Expected result |
|---|---|---|
| Worker visible in dashboard | dash.cloudflare.com → Workers | `home-budget-monitoring` listed |
| Secrets attached | Dashboard → Worker → Settings → Variables | `SUPABASE_URL`, `SUPABASE_KEY` listed (values hidden) |
| Home page | `curl -I https://home-budget-monitoring.<account>.workers.dev` | HTTP 200 |
| Auth redirect | `curl -I https://.../dashboard` | HTTP 302 → `/auth/signin` |
| Live log stream | `npx wrangler tail` | No errors at rest |
| CI pipeline | Push a trivial commit to `main` | lint → build → deploy all green |

---

## Phase 6 — Rollback procedure

**Code-only rollback** (no schema change involved):

```bash
npx wrangler rollback
# rolls back to the previous deployment in seconds
```

Or roll back to a specific deployment:
```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

**If a bad Supabase migration was also applied:**  
`wrangler rollback` restores the Worker code but **does not revert SQL**. Runbook:

1. `npx wrangler rollback` — restore previous Worker immediately
2. Identify the migration file in `supabase/migrations/` that was applied
3. Write and apply a compensating SQL migration (ALTER TABLE / DROP COLUMN) manually via Supabase dashboard SQL editor or `psql`
4. Verify app health with `npx wrangler tail`
5. Document the incident in `context/archive/`

---

## Secrets status

| Secret | Location | Status |
|---|---|---|
| `SUPABASE_URL` | Cloudflare Workers Secrets | ✅ Connected |
| `SUPABASE_KEY` | Cloudflare Workers Secrets | ✅ Connected |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions Secret | Pending Phase 4.1 |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions Secret | Pending Phase 4.1 |
| `SUPABASE_URL` | GitHub Actions Secret | Pending Phase 4.1 |
| `SUPABASE_KEY` | GitHub Actions Secret | Pending Phase 4.1 |

---

## Risk mitigations applied

From `infrastructure.md` risk register:

| Risk | Mitigation in this plan |
|---|---|
| CPU 10ms limit → silent 500 | `wrangler tail --status error` open during smoke test; paid plan upgrade path documented |
| `nodejs_compat` missing | Verified present ✅ |
| CI targeting wrong branch | Verified correct (`main`) ✅ |
| `astro:env` + wrangler double-declaration | Noted in Phase 2 with exact error symptom |
| Rollback without SQL revert | Full rollback runbook in Phase 6 |
| Worker name collision (starter default) | Verified correct (`home-budget-monitoring`) ✅ |
| Missing `wrangler login` before secrets | Added as Phase 0 with verification command |
