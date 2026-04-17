#!/usr/bin/env node
// Emit a fixture IIIF Presentation 3 manifest produced by the shared builder.
// Consumed by the CI validation job.

// Requires `pnpm build:shared` to be run first.
import { buildItemManifest } from "../packages/shared/dist/iiif.js";

const item = {
  id: "fixture-01",
  slug: "fixture-one",
  title: "Fixture item",
  description: "A manifest produced by the IIIF Atlas shared builder.",
  mode: "reference",
  sourcePageUrl: "https://example.org/record/1",
  sourcePageTitle: "Record 1",
  sourceImageUrl: "https://example.org/record/1/image.jpg",
  sourceManifestUrl: null,
  r2Key: null,
  mimeType: "image/jpeg",
  width: 2400,
  height: 1600,
  byteSize: null,
  manifestSlug: "fixture-one",
  manifestUrl: null,
  capturedAt: "2026-04-17T10:00:00.000Z",
  createdAt: "2026-04-17T10:00:00.000Z",
  updatedAt: "2026-04-17T10:00:00.000Z",
  metadata: null,
};

const manifest = buildItemManifest({
  item,
  publicBaseUrl: "https://api.iiif-atlas.test",
  imageUrl: item.sourceImageUrl,
  width: item.width,
  height: item.height,
});

process.stdout.write(JSON.stringify(manifest, null, 2));
