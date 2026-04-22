/**
 * Extension storage + API helpers.
 *
 * Storage split:
 *  - `chrome.storage.sync`  — non-sensitive config (`apiBase`,
 *    `domainPresets`). Sync lets users roam config between devices.
 *  - `chrome.storage.local` — the API key. Never synced across devices;
 *    a compromised Google account shouldn't leak workspace access.
 *
 * A first-run migration moves any `apiKey` previously stored in
 * `storage.sync` into `storage.local`, then clears it from sync.
 */

import type { CapturePayload, CreateCaptureResponse, IngestionMode } from "@iiif-atlas/shared";

const DEFAULT_API = "http://localhost:8787";

export class CaptureError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

interface SyncStored {
  apiBase?: string;
  domainPresets?: Record<string, IngestionMode>;
  /** Legacy: pre-v1.0.1 extensions stored the key here. Migrated on first read. */
  apiKey?: string;
}

interface LocalStored {
  apiKey?: string;
}

export interface Settings {
  apiBase: string;
  apiKey: string | null;
  domainPresets: Record<string, IngestionMode>;
}

async function migrateApiKeyFromSync(syncKey: string | undefined): Promise<void> {
  if (!syncKey) return;
  const local = (await chrome.storage.local.get(["apiKey"])) as LocalStored;
  if (!local.apiKey) {
    await chrome.storage.local.set({ apiKey: syncKey });
  }
  await chrome.storage.sync.remove("apiKey");
}

export async function getSettings(): Promise<Settings> {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(["apiBase", "apiKey", "domainPresets"]) as Promise<SyncStored>,
    chrome.storage.local.get(["apiKey"]) as Promise<LocalStored>,
  ]);
  if (sync.apiKey) {
    await migrateApiKeyFromSync(sync.apiKey);
  }
  return {
    apiBase: sync.apiBase ?? DEFAULT_API,
    apiKey: local.apiKey ?? sync.apiKey ?? null,
    domainPresets: sync.domainPresets ?? {},
  };
}

export async function setApiBase(url: string): Promise<void> {
  // Validate the URL is a real https: (or http: for local dev) endpoint
  // so we don't ship captures to `ftp://` or a relative path.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("API base must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API base must use http or https");
  }
  await chrome.storage.sync.set({ apiBase: parsed.toString().replace(/\/$/, "") });
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) {
    await chrome.storage.local.set({ apiKey: trimmed });
  } else {
    await chrome.storage.local.remove("apiKey");
  }
}

export async function setDomainPresets(presets: Record<string, IngestionMode>): Promise<void> {
  await chrome.storage.sync.set({ domainPresets: presets });
}

/**
 * Look up the ingestion mode preset for a page URL, if any. Checks the
 * full hostname first, then walks up one label at a time so a preset on
 * `example.org` covers `sub.example.org`.
 */
export async function getDomainPreset(url: string | undefined): Promise<IngestionMode | null> {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const { domainPresets } = await getSettings();
  const direct = domainPresets[host];
  if (direct) return direct;
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const tail = parts.slice(i).join(".");
    const p = domainPresets[tail];
    if (p) return p;
  }
  return null;
}

export async function postCapture(payload: CapturePayload): Promise<CreateCaptureResponse> {
  const { apiBase, apiKey } = await getSettings();
  if (!apiKey) {
    throw new CaptureError(
      401,
      "No API key configured. Open the extension's Options page to set one.",
    );
  }
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/captures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) || null : null;
    const text = await res.text().catch(() => "");
    const message =
      res.status === 429
        ? `Rate limit reached — retry in ${retryAfter ?? "a few"}s`
        : `Capture failed (${res.status})${text ? `: ${text}` : ""}`;
    throw new CaptureError(res.status, message, retryAfter);
  }
  return (await res.json()) as CreateCaptureResponse;
}
