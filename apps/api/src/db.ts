import type { Collection, IngestionMode, Item, ItemStatus } from "@iiif-atlas/shared";

/** D1 row shapes. */
export interface ItemRow {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  mode: IngestionMode;
  status: ItemStatus;
  error_message: string | null;
  asset_sha256: string | null;
  source_page_url: string | null;
  source_page_title: string | null;
  source_image_url: string | null;
  source_manifest_url: string | null;
  r2_key: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  manifest_slug: string | null;
  manifest_json: string | null;
  captured_at: string;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

export interface CollectionRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

export function mapItem(row: ItemRow, publicBaseUrl: string): Item {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    mode: row.mode,
    sourcePageUrl: row.source_page_url,
    sourcePageTitle: row.source_page_title,
    sourceImageUrl: row.source_image_url,
    sourceManifestUrl: row.source_manifest_url,
    r2Key: row.r2_key,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    manifestSlug: row.manifest_slug,
    manifestUrl: row.manifest_slug ? `${publicBaseUrl}/iiif/manifests/${row.manifest_slug}` : null,
    status: row.status,
    errorMessage: row.error_message,
    assetSha256: row.asset_sha256,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata_json ? safeJson(row.metadata_json) : null,
  };
}

export function mapCollection(row: CollectionRow, itemCount = 0, items?: Item[]): Collection {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    isPublic: Boolean(row.is_public),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount,
    ...(items ? { items } : {}),
  };
}

export function safeJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
