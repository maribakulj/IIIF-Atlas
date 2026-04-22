import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.resolve(__dirname, "./migrations"));

  return {
    resolve: {
      alias: {
        "@iiif-atlas/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      },
    },
    test: {
      setupFiles: ["./test/setup.ts"],
      poolOptions: {
        workers: {
          // Disable Miniflare's per-test isolated storage: it interacts
          // badly with D1's WAL companion files (the `updateStackedStorage`
          // pop fails when a `.sqlite-shm` is still mapped), and every test
          // already scopes writes by a freshly-minted workspace/api-key so
          // state leakage is not a concern. See setup.ts for the minimal
          // cleanup we still run between tests.
          isolatedStorage: false,
          singleWorker: true,
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            d1Databases: ["DB"],
            r2Buckets: ["BUCKET"],
            compatibilityDate: "2024-10-15",
            compatibilityFlags: ["nodejs_compat"],
            bindings: {
              PUBLIC_BASE_URL: "http://test.local",
              ALLOWED_ORIGINS: "http://localhost:5173,chrome-extension://*",
              MAX_DOWNLOAD_BYTES: "26214400",
              FETCH_TIMEOUT_MS: "15000",
              ALLOWED_MIME_TYPES:
                "image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif,image/svg+xml,application/json,application/ld+json",
              ALLOW_DEV_SIGNUP: "true",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
