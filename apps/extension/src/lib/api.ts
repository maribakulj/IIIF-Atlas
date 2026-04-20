import type { CapturePayload, CreateCaptureResponse, IngestionMode } from "@iiif-atlas/shared";

const DEFAULT_API = "http://localhost:8787";

interface Stored {
  apiBase?: string;
  apiKey?: string;
  /** Per-domain ingestion mode defaults: { "hostname": "cached" | "reference" | "iiif_reuse" }. */
  domainPresets?: Record<string, IngestionMode>;
}

export async function getSettings(): Promise<{
  apiBase: string;
  apiKey: string | null;
  domainPresets: Record<string, IngestionMode>;
}> {
  const stored = (await chrome.storage.sync.get(["apiBase", "apiKey", "domainPresets"])) as Stored;
  return {
    apiBase: stored.apiBase ?? DEFAULT_API,
    apiKey: stored.apiKey ?? null,
    domainPresets: stored.domainPresets ?? {},
  };
}

export async function getApiBase(): Promise<string> {
  return (await getSettings()).apiBase;
}

export async function setApiBase(url: string): Promise<void> {
  await chrome.storage.sync.set({ apiBase: url });
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.sync.set({ apiKey: key });
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
    throw new Error("No API key configured. Open the extension's Options page to set one.");
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
    const text = await res.text().catch(() => "");
    throw new Error(`Capture failed (${res.status}): ${text}`);
  }
  return (await res.json()) as CreateCaptureResponse;
}
