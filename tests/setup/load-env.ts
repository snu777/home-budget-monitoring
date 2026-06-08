import { config } from "dotenv";

// Load Supabase connection config for the integration suite from a gitignored
// `.env.test` into `process.env`. Referenced by `vitest.config.ts` setupFiles,
// so it runs before any test file (and therefore before the harness helpers
// read these vars). `quiet` suppresses dotenv's promotional startup log.
config({ path: ".env.test", quiet: true });
