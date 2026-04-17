import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    PUBLIC_BASE_URL: string;
    ALLOWED_ORIGINS: string;
    MAX_DOWNLOAD_BYTES: string;
    FETCH_TIMEOUT_MS: string;
    ALLOWED_MIME_TYPES: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}

// Apply migrations once per test worker.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
