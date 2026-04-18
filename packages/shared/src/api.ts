import type {
  ApiKeySummary,
  ApiKeyWithSecret,
  AuthMe,
  CapturePayload,
  Collection,
  CollectionCreate,
  DevSignupRequest,
  Item,
  ItemPatch,
} from "./types.js";

/** Response envelopes for the REST API. */

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface CreateCaptureResponse {
  capture: {
    id: string;
    createdAt: string;
  };
  item: Item;
}

export interface ListItemsResponse {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
}

export interface ItemResponse {
  item: Item;
}

export interface CollectionResponse {
  collection: Collection;
}

export interface ListCollectionsResponse {
  collections: Collection[];
}

export interface GenerateManifestResponse {
  item: Item;
  manifestUrl: string;
}

export interface DevSignupResponse {
  user: { id: string; email: string; displayName: string | null };
  workspace: { id: string; slug: string; name: string };
  apiKey: ApiKeyWithSecret;
}

export interface ListApiKeysResponse {
  keys: ApiKeySummary[];
}

export interface CreateApiKeyRequest {
  name: string;
  workspaceId?: string;
  scopes?: string[] | null;
}

export interface CreateApiKeyResponse {
  key: ApiKeyWithSecret;
}

export interface MeResponse extends AuthMe {}

// Re-export request bodies for symmetry
export type { CapturePayload, ItemPatch, CollectionCreate, DevSignupRequest };
