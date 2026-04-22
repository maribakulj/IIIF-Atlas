import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    PUBLIC_BASE_URL: string;
    ALLOWED_ORIGINS: string;
    ALLOW_DEV_SIGNUP: string;
    MAX_DOWNLOAD_BYTES: string;
    FETCH_TIMEOUT_MS: string;
    ALLOWED_MIME_TYPES: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}

// Apply migrations once per test worker. With isolatedStorage disabled the
// schema persists across tests; every test bootstraps its own workspace +
// API key via devSignup() so data stays logically partitioned.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
