import type {
  CapturePayload,
  Collection,
  CollectionCreate,
  CollectionResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateCaptureResponse,
  DevSignupRequest,
  DevSignupResponse,
  GenerateManifestResponse,
  Item,
  ItemPatch,
  ItemResponse,
  ListApiKeysResponse,
  ListCollectionsResponse,
  ListItemsResponse,
  MeResponse,
} from "@iiif-atlas/shared";
import { getApiKey, setApiKey } from "../lib/auth.js";
import { apiUrl } from "../lib/config.js";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (opts.auth !== false) {
    const key = getApiKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;
  }
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401) {
    // Forget the bad key so the app routes back to sign-in.
    setApiKey(null);
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const b = body as { code?: string; error?: string; message?: string };
    throw new ApiError(res.status, b.code ?? b.error ?? "error", b.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // -- auth ----------------------------------------------------------
  devSignup: (body: DevSignupRequest) =>
    request<DevSignupResponse>(
      "/api/auth/dev-signup",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      { auth: false },
    ),
  me: () => request<MeResponse>("/api/auth/me"),
  listApiKeys: () => request<ListApiKeysResponse>("/api/auth/api-keys"),
  createApiKey: (body: CreateApiKeyRequest) =>
    request<CreateApiKeyResponse>("/api/auth/api-keys", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revokeApiKey: (id: string) => request<void>(`/api/auth/api-keys/${id}`, { method: "DELETE" }),

  // -- items / captures / collections --------------------------------
  listItems: (opts: { q?: string; mode?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.q) q.set("q", opts.q);
    if (opts.mode) q.set("mode", opts.mode);
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.offset) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return request<ListItemsResponse>(`/api/items${qs ? `?${qs}` : ""}`);
  },
  getItem: (id: string) => request<ItemResponse>(`/api/items/${id}`),
  patchItem: (id: string, body: ItemPatch) =>
    request<ItemResponse>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  generateManifest: (id: string) =>
    request<GenerateManifestResponse>(`/api/items/${id}/generate-manifest`, {
      method: "POST",
    }),
  createCapture: (body: CapturePayload) =>
    request<CreateCaptureResponse>("/api/captures", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listCollections: () => request<ListCollectionsResponse>("/api/collections"),
  getCollection: (id: string) => request<CollectionResponse>(`/api/collections/${id}`),
  createCollection: (body: CollectionCreate) =>
    request<CollectionResponse>("/api/collections", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCollection: (id: string, body: Partial<CollectionCreate>) =>
    request<CollectionResponse>(`/api/collections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export type { Item, Collection };
