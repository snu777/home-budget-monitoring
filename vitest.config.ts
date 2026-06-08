import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone Vitest config for the integration suite. Deliberately does NOT
// pull in Astro's Vite pipeline: the tests talk to Supabase via
// `@supabase/supabase-js` directly and never import app modules that use the
// `astro:env/server` virtual module. The only app import we allow is the
// generated `@/database.types`, resolved by the alias below.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup/load-env.ts"],
    // RLS tests share two real users created once per file and must not race
    // each other against the single local Supabase instance. Files run one at a
    // time; tests within a file are serial unless explicitly marked concurrent.
    fileParallelism: false,
    // Signup + DB round-trips over the local network exceed Vitest's 5s default.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
