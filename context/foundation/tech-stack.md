---
starter_id: 10x-astro-starter
package_manager: npm
project_name: home-budget-monitoring
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo developer shipping a shared household budget tracker in 2 weeks needs a
battle-tested, agent-friendly starter that handles auth and database out of the
box — `10x-astro-starter` is the recommended default for the `(web-app, js)`
cell and clears all four agent-friendly gates. Supabase ships PostgreSQL, auth,
and a TypeScript SDK without any manual wiring, directly satisfying FR-001 and
FR-002 (email + password registration and persistent sessions). The 2-week hard
deadline favors a verified opinionated stack over a hand-assembled one; Astro's
file-based routing and Cloudflare Pages' native adapter mean the first deploy
path is frictionless. Realtime sync (< 3 s) was flagged in the PRD but
de-scoped from the technical stack decision — Supabase Realtime can be added
later without replacing the stack. CI runs on GitHub Actions with
auto-deploy-on-merge, the standard shape the starter ships with.
