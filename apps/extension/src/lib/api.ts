import type { CapturePayload, CreateCaptureResponse } from "@iiif-atlas/shared";

const DEFAULT_API = "http://localhost:8787";

interface Stored {
  apiBase?: string;
  apiKey?: string;
}

export async function getSettings(): Promise<{ apiBase: string; apiKey: string | null }> {
  const stored = (await chrome.storage.sync.get(["apiBase", "apiKey"])) as Stored;
  return {
    apiBase: stored.apiBase ?? DEFAULT_API,
    apiKey: stored.apiKey ?? null,
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
