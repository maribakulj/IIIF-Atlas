import type {
  CapturePayload,
  Collection,
  CollectionCreate,
  CollectionResponse,
  CreateCaptureResponse,
  GenerateManifestResponse,
  Item,
  ItemPatch,
  ItemResponse,
  ListCollectionsResponse,
  ListItemsResponse,
} from "@iiif-atlas/shared";
import { apiUrl } from "../lib/config.js";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const msg =
      (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
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
