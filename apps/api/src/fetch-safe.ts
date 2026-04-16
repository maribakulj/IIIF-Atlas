import { assertOutboundUrl } from "./ssrf.js";
import { badRequest, unprocessable } from "./errors.js";

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  allowedMime?: string[];
  /** `no-redirect` disables redirect following (for manifest fetch hardening). */
  redirect?: "follow" | "no-redirect";
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  headers: Headers;
  body: Uint8Array;
  mime: string;
  finalUrl: string;
}

/**
 * Fetch a URL with SSRF validation, timeout, byte cap, and MIME check.
 * Used for both IIIF JSON and image downloads.
 */
export async function safeFetch(raw: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  assertOutboundUrl(raw);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), opts.timeoutMs);

  let response: Response;
  try {
    response = await fetch(raw, {
      signal: controller.signal,
      redirect: opts.redirect === "no-redirect" ? "manual" : "follow",
      headers: {
        "User-Agent": "IIIF-Atlas/0.1 (+https://iiif-atlas.example.com)",
        Accept: "*/*",
        ...(opts.headers ?? {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    throw unprocessable("Upstream fetch failed", { cause: String(err) });
  }

  // If redirected, re-validate the final URL (defense in depth).
  const finalUrl = response.url || raw;
  if (finalUrl !== raw) {
    assertOutboundUrl(finalUrl);
  }

  const mime = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (opts.allowedMime && opts.allowedMime.length > 0) {
    if (!opts.allowedMime.includes(mime)) {
      clearTimeout(timer);
      throw unprocessable("Disallowed MIME type", { mime, allowed: opts.allowedMime });
    }
  }

  const len = Number(response.headers.get("content-length") ?? "0");
  if (len && len > opts.maxBytes) {
    clearTimeout(timer);
    throw unprocessable("Upstream resource exceeds size limit", {
      contentLength: len,
      max: opts.maxBytes,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw unprocessable("Empty response body");
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > opts.maxBytes) {
        controller.abort("size_limit");
        throw unprocessable("Upstream resource exceeds size limit", {
          received,
          max: opts.maxBytes,
        });
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }

  return { status: response.status, headers: response.headers, body, mime, finalUrl };
}

export async function safeFetchJson<T = unknown>(
  raw: string,
  opts: Omit<SafeFetchOptions, "allowedMime">,
): Promise<T> {
  const res = await safeFetch(raw, {
    ...opts,
    allowedMime: ["application/json", "application/ld+json", "text/json"],
  });
  if (res.status < 200 || res.status >= 300) {
    throw badRequest(`Upstream returned ${res.status}`);
  }
  const text = new TextDecoder().decode(res.body);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw unprocessable("Upstream response was not valid JSON");
  }
}
