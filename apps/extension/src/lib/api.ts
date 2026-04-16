import type { CapturePayload, CreateCaptureResponse } from "@iiif-atlas/shared";

const DEFAULT_API = "http://localhost:8787";

export async function getApiBase(): Promise<string> {
  const stored = await chrome.storage.sync.get(["apiBase"]);
  return (stored.apiBase as string | undefined) ?? DEFAULT_API;
}

export async function setApiBase(url: string): Promise<void> {
  await chrome.storage.sync.set({ apiBase: url });
}

export async function postCapture(payload: CapturePayload): Promise<CreateCaptureResponse> {
  const base = await getApiBase();
  const res = await fetch(`${base.replace(/\/$/, "")}/api/captures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Capture failed (${res.status}): ${text}`);
  }
  return (await res.json()) as CreateCaptureResponse;
}
