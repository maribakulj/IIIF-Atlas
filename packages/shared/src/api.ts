import type {
  CapturePayload,
  Item,
  Collection,
  ItemPatch,
  CollectionCreate,
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

// Re-export request bodies for symmetry
export type { CapturePayload, ItemPatch, CollectionCreate };
