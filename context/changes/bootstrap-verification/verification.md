---
bootstrapped_at: 2026-05-20T15:58:00Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: home-budget-monitoring
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: home-budget-monitoring
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
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
```

**Why this stack**

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

## Pre-scaffold verification

| Signal      | Value                                                        | Severity    | Notes                                                          |
| ----------- | ------------------------------------------------------------ | ----------- | -------------------------------------------------------------- |
| npm package | not run                                                      | n/a         | cmd_template uses `git clone`; no npm CLI package to check     |
| GitHub repo | not run                                                      | n/a         | `gh` CLI not installed; recency check unavailable              |

Registry card records `last_updated: 2026-05-01` (fresh, within 3 months of 2026-05-20).

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo into temp dir, removed upstream `.git/`, applied conflict matrix, deleted temp dir)
**Exit code**: 0
**Files moved silently**: none (project was already fully bootstrapped from this starter; all scaffold files conflicted)
**Conflicts (.scaffold siblings)**: `.env.example`, `.github`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `CLAUDE.md`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `package-lock.json`, `package.json`, `public`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc` (19 items)
**`node_modules` handling**: excluded from conflict matrix (installed dependencies, not scaffold files)
**.gitignore handling**: append-merged — no new lines (scaffold `.gitignore` identical to project's)
**.bootstrap-scaffold cleanup**: deleted

**Note**: The high conflict count is expected — the project was previously bootstrapped from this same starter. The `.scaffold` siblings are diff targets; run `diff <file> <file>.scaffold` to compare starter defaults against any customisations made after the original bootstrap.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0 (CRITICAL/HIGH/MODERATE/LOW)

#### CRITICAL findings

None.

#### HIGH findings

| Package  | Version range  | Advisory                                                                                        | CVSS | Fix              |
| -------- | -------------- | ----------------------------------------------------------------------------------------------- | ---- | ---------------- |
| devalue  | 5.6.3 – 5.8.0  | [GHSA-77vg-94rm-hx3p](https://github.com/advisories/GHSA-77vg-94rm-hx3p) DoS via sparse array deserialization | 7.5  | fix available    |

*Transitive* — pulled in through the dependency tree, not a direct project dependency.

#### MODERATE findings

| Package                 | Direct? | Root cause advisory                                     | Fix available              |
| ----------------------- | ------- | ------------------------------------------------------- | -------------------------- |
| `@astrojs/check`        | yes     | via `@astrojs/language-server` → `volar-service-yaml`  | `@astrojs/check@0.9.2` (breaking) |
| `@astrojs/cloudflare`   | yes     | via `wrangler` / `@cloudflare/vite-plugin`             | `@astrojs/cloudflare@12.6.13` (breaking) |
| `wrangler`              | yes     | via `miniflare` → `ws`                                 | `wrangler@3.107.3` (breaking) |
| `@astrojs/language-server` | no   | via `volar-service-yaml` → `yaml`                      | fix via `@astrojs/check@0.9.2` |
| `@cloudflare/vite-plugin` | no    | via `miniflare` → `ws`                                 | fix via `@astrojs/cloudflare` |
| `miniflare`             | no      | via `ws` (uninitialized memory disclosure)              | fix via `wrangler` or `@astrojs/cloudflare` |
| `volar-service-yaml`    | no      | via `yaml-language-server`                              | fix via `@astrojs/check` |
| `ws`                    | no      | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) Uninitialized memory | fix via upstream |
| `yaml`                  | no      | [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) Stack overflow       | fix via `@astrojs/check` |
| `yaml-language-server`  | no      | via `yaml`                                              | fix via `@astrojs/check` |

**Observation**: most MODERATE findings are dev-tooling transitive chains (`@astrojs/check`, `wrangler`). The `ws` uninitialized memory advisory affects `@supabase/realtime-js` (a production dependency) but has CVSS 4.4 with high-privilege prerequisite. All fixes require semver-major bumps.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value              |
| ----------------------- | ------------------ |
| bootstrapper_confidence | first-class        |
| quality_override        | false              |
| path_taken              | standard           |
| self_check_answers      | null               |
| team_size               | solo               |
| deployment_target       | cloudflare-pages   |
| ci_provider             | github-actions     |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true               |
| has_payments            | false              |
| has_realtime            | false              |
| has_ai                  | false              |
| has_background_jobs     | false              |

These fields were read and preserved in this log for the future M1L4 skill ("Memory Architecture") to act on. v1 bootstrapper does not modify the scaffold based on feature flags.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
