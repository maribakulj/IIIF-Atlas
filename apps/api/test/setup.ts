import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll } from "vitest";

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

// Apply migrations once per test worker.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// Workaround for an upstream miniflare/workerd bug where SQLite WAL/SHM
// companion files left over after a test cause `updateStackedStorage` to
// fail when popping isolated storage. TRUNCATE removes the WAL and lets the
// snapshot mechanism see only the .sqlite file.
afterEach(async () => {
  try {
    await env.DB.prepare("PRAGMA wal_checkpoint(TRUNCATE)").run();
  } catch {
    /* not critical for test correctness */
  }
});
