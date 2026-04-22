import type {
  AddTagRequest,
  AnnotationCreate,
  AnnotationPatch,
  AnnotationResponse,
  CapturePayload,
  Collection,
  CollectionCreate,
  CollectionResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateCaptureResponse,
  CreateShareRequest,
  CreateShareResponse,
  DevSignupRequest,
  DevSignupResponse,
  GenerateManifestResponse,
  Item,
  ItemPatch,
  ItemResponse,
  ItemSort,
  ListAnnotationsResponse,
  ListApiKeysResponse,
  ListCollectionsResponse,
  ListItemsResponse,
  ListSharesResponse,
  ListTagsResponse,
  MeResponse,
  ShareResolveResponse,
  Tag,
} from "@iiif-atlas/shared";
import { getApiKey, setApiKey } from "../lib/auth.js";
import { apiUrl } from "../lib/config.js";

export class ApiError extends Error {
  status: number;
  code: string;
  /** Seconds the caller should wait before retrying; set for 429 responses. */
  retryAfter: number | null;
  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
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
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) || null : null;
    const fallback =
      res.status === 429
        ? `Too many requests — retry in ${retryAfter ?? "a few"}s`
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, b.code ?? b.error ?? "error", b.message ?? fallback, retryAfter);
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
  listItems: (
    opts: {
      q?: string;
      mode?: string;
      tag?: string;
      rights?: string;
      sort?: ItemSort;
      facets?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.q) q.set("q", opts.q);
    if (opts.mode) q.set("mode", opts.mode);
    if (opts.tag) q.set("tag", opts.tag);
    if (opts.rights) q.set("rights", opts.rights);
    if (opts.sort) q.set("sort", opts.sort);
    if (opts.facets) q.set("facets", "1");
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.offset) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return request<ListItemsResponse>(`/api/items${qs ? `?${qs}` : ""}`);
  },
  listTags: () => request<ListTagsResponse>("/api/tags"),
  addItemTag: (itemId: string, body: AddTagRequest) =>
    request<{ tag: Tag }>(`/api/items/${itemId}/tags`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeItemTag: (itemId: string, tagSlug: string) =>
    request<void>(`/api/items/${itemId}/tags/${tagSlug}`, { method: "DELETE" }),
  exportItemsUrl: (
    opts: { format: "json" | "csv" | "ris"; q?: string; tag?: string } = { format: "json" },
  ) => {
    const p = new URLSearchParams();
    p.set("format", opts.format);
    if (opts.q) p.set("q", opts.q);
    if (opts.tag) p.set("tag", opts.tag);
    return `/api/export/items?${p.toString()}`;
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
  retryItem: (id: string) => request<ItemResponse>(`/api/items/${id}/retry`, { method: "POST" }),
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

  // -- annotations ---------------------------------------------------
  listAnnotations: (itemId: string) =>
    request<ListAnnotationsResponse>(`/api/items/${itemId}/annotations`),
  createAnnotation: (itemId: string, body: AnnotationCreate) =>
    request<AnnotationResponse>(`/api/items/${itemId}/annotations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchAnnotation: (id: string, body: AnnotationPatch) =>
    request<AnnotationResponse>(`/api/annotations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAnnotation: (id: string) => request<void>(`/api/annotations/${id}`, { method: "DELETE" }),

  // -- shares --------------------------------------------------------
  listShares: (opts: { resourceType?: string; resourceId?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.resourceType) p.set("resourceType", opts.resourceType);
    if (opts.resourceId) p.set("resourceId", opts.resourceId);
    const qs = p.toString();
    return request<ListSharesResponse>(`/api/shares${qs ? `?${qs}` : ""}`);
  },
  createShare: (body: CreateShareRequest) =>
    request<CreateShareResponse>("/api/shares", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revokeShare: (id: string) => request<void>(`/api/shares/${id}`, { method: "DELETE" }),
  resolveShare: (token: string) =>
    request<ShareResolveResponse>(`/api/shares/${token}`, {}, { auth: false }),
};

export type { Item, Collection };
