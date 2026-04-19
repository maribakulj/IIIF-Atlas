/**
 * Minimal IIIF Presentation 3 builders.
 * Spec: https://iiif.io/api/presentation/3.0/
 */

import type { Collection, Item } from "./types.js";

export interface IIIFLabel {
  [lang: string]: string[];
}

export interface IIIFMetadataEntry {
  label: IIIFLabel;
  value: IIIFLabel;
}

export interface IIIFManifest {
  "@context": string | string[];
  id: string;
  type: "Manifest";
  label: IIIFLabel;
  summary?: IIIFLabel;
  metadata?: IIIFMetadataEntry[];
  requiredStatement?: IIIFMetadataEntry;
  homepage?: Array<{ id: string; type: "Text"; label: IIIFLabel; format: string }>;
  thumbnail?: Array<{
    id: string;
    type: "Image";
    format?: string;
    width?: number;
    height?: number;
  }>;
  items: IIIFCanvas[];
}

export interface IIIFCanvas {
  id: string;
  type: "Canvas";
  label?: IIIFLabel;
  height: number;
  width: number;
  items: IIIFAnnotationPage[];
  /** Non-painting annotations (highlights, comments, …). */
  annotations?: IIIFAnnotationPage[];
}

export interface IIIFAnnotationPage {
  id: string;
  type: "AnnotationPage";
  items: IIIFAnnotation[];
}

export interface IIIFAnnotation {
  id: string;
  type: "Annotation";
  motivation: "painting" | "highlighting" | "tagging" | "commenting";
  target: string;
  body?: IIIFImageBody | { type: string; value?: string };
}

export interface IIIFImageBody {
  id: string;
  type: "Image";
  format: string;
  width: number;
  height: number;
  service?: Array<{ id: string; type: string; profile?: string }>;
}

export interface IIIFCollection {
  "@context": string | string[];
  id: string;
  type: "Collection";
  label: IIIFLabel;
  summary?: IIIFLabel;
  items: Array<{
    id: string;
    type: "Manifest" | "Collection";
    label: IIIFLabel;
    thumbnail?: IIIFManifest["thumbnail"];
  }>;
}

export const IIIF_CONTEXT = "http://iiif.io/api/presentation/3/context.json";
export const IIIF_IMAGE_CONTEXT = "http://iiif.io/api/image/3/context.json";

/** Image API 3 info.json shape (minimal — level 0 today). */
export interface IIIFImageInfo3 {
  "@context": string;
  id: string;
  type: "ImageService3";
  protocol: "http://iiif.io/api/image";
  profile: "level0" | "level1" | "level2";
  width: number;
  height: number;
  /** Optional tile pyramid; absent at level 0. */
  tiles?: Array<{ width: number; height?: number; scaleFactors: number[] }>;
  /** Mime types the service can return. */
  extraFormats?: string[];
}

export function label(value: string, lang = "none"): IIIFLabel {
  return { [lang]: [value] };
}

export interface BuildManifestParams {
  item: Item;
  publicBaseUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  format?: string;
  /** If the source already exposed a IIIF Image API service, forward it. */
  imageService?: { id: string; type?: string; profile?: string };
}

/**
 * Build a minimal Presentation 3 manifest for a single-image item.
 */
export function buildItemManifest(params: BuildManifestParams): IIIFManifest {
  const {
    item,
    publicBaseUrl,
    imageUrl,
    width,
    height,
    format = "image/jpeg",
    imageService,
  } = params;
  const manifestId = `${publicBaseUrl}/iiif/manifests/${item.manifestSlug ?? item.slug}`;
  const canvasId = `${manifestId}/canvas/1`;
  const pageId = `${canvasId}/page/1`;
  const annoId = `${canvasId}/annotation/1`;

  const body: IIIFImageBody = {
    id: imageUrl,
    type: "Image",
    format,
    width,
    height,
  };
  if (imageService) {
    body.service = [
      {
        id: imageService.id,
        type: imageService.type ?? "ImageService2",
        profile: imageService.profile ?? "level1",
      },
    ];
  }

  const metadata: IIIFMetadataEntry[] = [];
  if (item.sourcePageUrl) {
    metadata.push({
      label: label("Source page"),
      value: label(item.sourcePageUrl),
    });
  }
  if (item.sourceImageUrl) {
    metadata.push({
      label: label("Source image"),
      value: label(item.sourceImageUrl),
    });
  }
  if (item.sourceManifestUrl) {
    metadata.push({
      label: label("Source IIIF manifest"),
      value: label(item.sourceManifestUrl),
    });
  }
  metadata.push({
    label: label("Captured"),
    value: label(item.capturedAt),
  });
  metadata.push({
    label: label("Ingestion mode"),
    value: label(item.mode),
  });
  if (item.regionXywh) {
    metadata.push({
      label: label("Region of interest"),
      value: label(item.regionXywh),
    });
  }

  const manifest: IIIFManifest = {
    "@context": IIIF_CONTEXT,
    id: manifestId,
    type: "Manifest",
    label: label(item.title ?? item.sourcePageTitle ?? item.slug),
    ...(item.description ? { summary: label(item.description) } : {}),
    metadata,
    ...(item.sourcePageUrl
      ? {
          homepage: [
            {
              id: item.sourcePageUrl,
              type: "Text" as const,
              label: label(item.sourcePageTitle ?? "Source page"),
              format: "text/html",
            },
          ],
        }
      : {}),
    thumbnail: [
      {
        id: imageUrl,
        type: "Image",
        format,
      },
    ],
    items: [
      {
        id: canvasId,
        type: "Canvas",
        height,
        width,
        items: [
          {
            id: pageId,
            type: "AnnotationPage",
            items: [
              {
                id: annoId,
                type: "Annotation",
                motivation: "painting",
                target: canvasId,
                body,
              },
            ],
          },
        ],
        // Surface a region-of-interest as a non-painting highlighting
        // annotation; viewers like Mirador render a box overlay, and
        // the fragment target makes the xywh machine-readable.
        ...(item.regionXywh
          ? {
              annotations: [
                {
                  id: `${canvasId}/annotations`,
                  type: "AnnotationPage" as const,
                  items: [
                    {
                      id: `${canvasId}/annotations/region`,
                      type: "Annotation" as const,
                      motivation: "highlighting" as const,
                      target: `${canvasId}#xywh=${item.regionXywh}`,
                    },
                  ],
                },
              ],
            }
          : {}),
      },
    ],
  };
  return manifest;
}

export interface BuildCollectionParams {
  collection: Collection;
  publicBaseUrl: string;
  items: Item[];
}

export function buildCollection(params: BuildCollectionParams): IIIFCollection {
  const { collection, publicBaseUrl, items } = params;
  const collectionId = `${publicBaseUrl}/iiif/collections/${collection.slug}`;
  return {
    "@context": IIIF_CONTEXT,
    id: collectionId,
    type: "Collection",
    label: label(collection.title),
    ...(collection.description ? { summary: label(collection.description) } : {}),
    items: items
      .filter((it) => it.manifestSlug)
      .map((it) => ({
        id: `${publicBaseUrl}/iiif/manifests/${it.manifestSlug}`,
        type: "Manifest" as const,
        label: label(it.title ?? it.sourcePageTitle ?? it.slug),
        ...(it.r2Key || it.sourceImageUrl
          ? {
              thumbnail: [
                {
                  id: it.r2Key ? `${publicBaseUrl}/r2/${it.r2Key}` : (it.sourceImageUrl as string),
                  type: "Image" as const,
                  ...(it.mimeType ? { format: it.mimeType } : {}),
                },
              ],
            }
          : {}),
      })),
  };
}
