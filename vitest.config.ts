import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two projects under one `npm test` (`vitest run`):
//   - `unit`: pure functions, no DB / no dotenv, parallel — fast. Run alone
//     with `vitest run --project unit`.
//   - `integration`: RLS suite vs local Supabase — needs `.env.test`, runs
//     serially. Deliberately does NOT pull in Astro's Vite pipeline (talks to
//     Supabase via `@supabase/supabase-js`, never imports `astro:env/server`).
// The `@` alias resolves the generated `@/database.types` in both projects.
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/setup/load-env.ts"],
          // RLS tests share two real users created once per file and must not
          // race against the single local Supabase instance.
          fileParallelism: false,
          // Signup + DB round-trips over the local network exceed the 5s default.
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
