# Repository Guidelines

Home budget monitoring — Astro 6 SSR + React 19 islands + Tailwind 4 + Supabase auth, Cloudflare Workers deployment. See @README.md for setup.

## Hard Rules

- **Never use `"use client"` or Next.js directives.** This is Astro; React islands use `client:load` / `client:idle` directives instead.
- **API routes require `export const prerender = false`.** All pages are SSR (`output: "server"`); this export is mandatory for every file under `src/pages/api/`.
- **Use `cn()` from `@/lib/utils` for all Tailwind class merging.** Never concatenate class strings manually.
- **Enable RLS on every new Supabase table** with per-operation, per-role policies — never a blanket `USING (true)`.
- **Read env vars via `astro:env/server`** (schema declared in `@astro.config.mjs`), not `process.env`.

## Project Structure

- `src/components/` — Astro (`.astro`) for static UI; React (`.tsx`) for interactive islands
  - `auth/` — React auth form components; `ui/` — shadcn/ui; `hooks/` — custom hooks
- `src/lib/` — utilities and Supabase client; `services/` for extracted business logic
- `src/middleware.ts` — auth guard; add protected paths to `PROTECTED_ROUTES`
- `src/pages/api/` — API endpoints (uppercase `GET`/`POST` exports, validate with zod)
- `src/types.ts` — shared entity and DTO types
- `supabase/migrations/` — SQL files named `YYYYMMDDHHmmss_short_description.sql`

Path alias: `@/*` → `./src/*`. Add shadcn components via `npx shadcn@latest add <name>`.

## Build and Dev Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime, reads `.dev.vars`)
- `npm run build` — production build (requires `SUPABASE_URL` + `SUPABASE_KEY`)
- `npm run lint` — ESLint with strict type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (120-char width, double quotes, trailing commas)

Pre-commit: husky + lint-staged auto-runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Coding Conventions

- Astro components for static content; React only where interactivity is required.
- shadcn/ui style is `new-york`; components live in `src/components/ui/`.
- ESLint enforces `react-compiler/react-compiler: error` — do not suppress this rule.
- Prefix unused vars/args with `_` to satisfy the no-unused-vars rule.

## Environment and Secrets

Copy `.env.example` → `.env` (Node tooling) and `.dev.vars` (Cloudflare workerd) — both are gitignored, never commit either.

Local Supabase: `npx supabase start` (requires Docker); copy the printed URL and anon key into both files.

Deploy: `npx wrangler deploy`. Set secrets via `npx wrangler secret put` or the Cloudflare dashboard.

## CI

`.github/workflows/ci.yml`: lint → build on every push/PR to `master`. Requires `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets.
