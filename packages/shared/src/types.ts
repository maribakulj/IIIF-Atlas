/**
 * Core domain types for IIIF Atlas.
 * Shared by the web app, extension, and Cloudflare Workers backend.
 */

export type IngestionMode = "reference" | "cached" | "iiif_reuse";

export interface CapturePayload {
  /** The URL of the page where the image was discovered. ALWAYS required. */
  pageUrl: string;
  /** Title of the source page, if available. */
  pageTitle?: string;
  /** Direct URL to the source image, if known. */
  imageUrl?: string;
  /** A IIIF Presentation 2/3 manifest URL, if the page is already IIIF. */
  manifestUrl?: string;
  /** A IIIF Image API info.json URL, if the page exposes one. */
  infoJsonUrl?: string;
  /** Requested ingestion mode. Server may reject/adjust. */
  mode: IngestionMode;
  /** Freeform user metadata (label, description, tags, rights, ...). */
  metadata?: Record<string, unknown>;
  /** Client timestamp when the capture was made (ISO 8601). */
  capturedAt?: string;
  /** Optional user agent / extension version. */
  clientInfo?: {
    agent?: string;
    version?: string;
  };
}

export interface Item {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  mode: IngestionMode;

  sourcePageUrl: string | null;
  sourcePageTitle: string | null;
  sourceImageUrl: string | null;
  sourceManifestUrl: string | null;

  r2Key: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;

  manifestSlug: string | null;
  manifestUrl: string | null;

  capturedAt: string;
  createdAt: string;
  updatedAt: string;

  metadata: Record<string, unknown> | null;
}

export interface Collection {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
  items?: Item[];
}

export interface ItemPatch {
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  mode?: IngestionMode;
}

export interface CollectionCreate {
  title: string;
  description?: string;
  isPublic?: boolean;
  itemIds?: string[];
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
}

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceMembership {
  workspace: Workspace;
  role: WorkspaceRole;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  workspaceId: string;
  scopes: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Returned only at creation time; never persisted in plaintext. */
export interface ApiKeyWithSecret extends ApiKeySummary {
  /** The raw token, e.g. `iia_…`. Show once, store nowhere. */
  secret: string;
}

export interface DevSignupRequest {
  email: string;
  displayName?: string;
  workspaceName?: string;
}

export interface AuthMe {
  user: User;
  memberships: WorkspaceMembership[];
  /** Workspace the request was authenticated against (from the API key). */
  activeWorkspace: Workspace | null;
  role: WorkspaceRole | null;
}

export interface DetectResult {
  /** Highest-confidence direct image URL on the page. */
  primaryImageUrl?: string;
  /** Candidate image URLs found in DOM (img, og:image, link rel=image_src). */
  imageCandidates: string[];
  /** IIIF Presentation manifest URL if detected. */
  manifestUrl?: string;
  /** IIIF Image API info.json URL if detected. */
  infoJsonUrl?: string;
  /** Detected page title. */
  pageTitle?: string;
}
