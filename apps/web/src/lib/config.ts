const envAny = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export const API_BASE_URL = envAny.VITE_API_BASE_URL ?? "http://localhost:8787";

export function apiUrl(path: string): string {
  const base = API_BASE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
