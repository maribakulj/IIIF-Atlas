/**
 * Lightweight client-side auth: a single API key stored in localStorage
 * and sent as a Bearer token. Key creation/rotation lives on the server;
 * the web app is purely a consumer.
 */

const STORAGE_KEY = "iiif-atlas:apiKey";

type Listener = (key: string | null) => void;
const listeners = new Set<Listener>();

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode etc. */
  }
  for (const l of listeners) l(key);
}

export function onApiKeyChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
