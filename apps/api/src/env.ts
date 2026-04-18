export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  PUBLIC_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  MAX_DOWNLOAD_BYTES: string;
  FETCH_TIMEOUT_MS: string;
  ALLOWED_MIME_TYPES: string;
  /** When "true", `POST /api/auth/dev-signup` is enabled. */
  ALLOW_DEV_SIGNUP: string;
}

export function getLimits(env: Env) {
  return {
    maxBytes: Number.parseInt(env.MAX_DOWNLOAD_BYTES, 10) || 25 * 1024 * 1024,
    fetchTimeoutMs: Number.parseInt(env.FETCH_TIMEOUT_MS, 10) || 15000,
    allowedMime: env.ALLOWED_MIME_TYPES.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    allowedOrigins: env.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
