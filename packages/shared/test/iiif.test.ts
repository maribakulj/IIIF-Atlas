import { describe, expect, it } from "vitest";
import {
  IIIF_CONTEXT,
  buildCollection,
  buildItemManifest,
  classifyIIIFJson,
  label,
} from "../src/index.js";
import type { Collection, Item } from "../src/types.js";

const baseItem: Item = {
  id: "01J9ABCDE",
  slug: "test-item-abc123",
  title: "Test item",
  description: "A description",
  mode: "reference",
  sourcePageUrl: "https://example.com/some-page",
  sourcePageTitle: "Some page",
  sourceImageUrl: "https://example.com/big.jpg",
  sourceManifestUrl: null,
  r2Key: null,
  mimeType: "image/jpeg",
  width: 2400,
  height: 1600,
  byteSize: null,
  manifestSlug: "test-item-abc123",
  manifestUrl: null,
  capturedAt: "2026-04-17T10:00:00.000Z",
  createdAt: "2026-04-17T10:00:00.000Z",
  updatedAt: "2026-04-17T10:00:00.000Z",
  metadata: null,
};

describe("label()", () => {
  it("produces IIIF language map shape", () => {
    expect(label("hello")).toEqual({ none: ["hello"] });
    expect(label("bonjour", "fr")).toEqual({ fr: ["bonjour"] });
  });
});

describe("buildItemManifest", () => {
  it("builds a valid Presentation 3 skeleton for reference mode", () => {
    const m = buildItemManifest({
      item: baseItem,
      publicBaseUrl: "https://api.iiif-atlas.test",
      imageUrl: "https://example.com/big.jpg",
      width: 2400,
      height: 1600,
    });

    expect(m["@context"]).toBe(IIIF_CONTEXT);
    expect(m.type).toBe("Manifest");
    expect(m.id).toBe("https://api.iiif-atlas.test/iiif/manifests/test-item-abc123");
    expect(m.label).toEqual({ none: ["Test item"] });
    expect(m.summary).toEqual({ none: ["A description"] });

    // metadata entries carry provenance
    const flatLabels = m.metadata?.map((e) => e.label.none?.[0]);
    expect(flatLabels).toContain("Source page");
    expect(flatLabels).toContain("Source image");
    expect(flatLabels).toContain("Captured");
    expect(flatLabels).toContain("Ingestion mode");

    // homepage preserved
    expect(m.homepage?.[0]?.id).toBe("https://example.com/some-page");

    // Canvas + AnnotationPage + Annotation painting
    const canvas = m.items[0];
    expect(canvas?.type).toBe("Canvas");
    expect(canvas?.width).toBe(2400);
    expect(canvas?.height).toBe(1600);
    const anno = canvas?.items[0]?.items[0];
    expect(anno?.motivation).toBe("painting");
    expect(anno?.body.id).toBe("https://example.com/big.jpg");
    expect(anno?.body.format).toBe("image/jpeg");
    expect(anno?.target).toBe(canvas?.id);
  });

  it("attaches IIIF image service when provided", () => {
    const m = buildItemManifest({
      item: baseItem,
      publicBaseUrl: "https://api.iiif-atlas.test",
      imageUrl: "https://iiif.example/iiif/2/abc/full/max/0/default.jpg",
      width: 2000,
      height: 1000,
      imageService: {
        id: "https://iiif.example/iiif/2/abc",
        type: "ImageService2",
        profile: "level1",
      },
    });
    const body = m.items[0]?.items[0]?.items[0]?.body;
    expect(body?.service?.[0]?.id).toBe("https://iiif.example/iiif/2/abc");
    expect(body?.service?.[0]?.type).toBe("ImageService2");
  });

  it("falls back to slug as label when title is null", () => {
    const m = buildItemManifest({
      item: { ...baseItem, title: null, sourcePageTitle: null },
      publicBaseUrl: "https://api.iiif-atlas.test",
      imageUrl: "https://example.com/big.jpg",
      width: 100,
      height: 100,
    });
    expect(m.label).toEqual({ none: ["test-item-abc123"] });
  });
});

describe("buildCollection", () => {
  const collection: Collection = {
    id: "col-1",
    slug: "my-collection",
    title: "My collection",
    description: null,
    isPublic: true,
    createdAt: "2026-04-17T10:00:00.000Z",
    updatedAt: "2026-04-17T10:00:00.000Z",
  };

  it("lists only items with a manifest slug", () => {
    const c = buildCollection({
      collection,
      publicBaseUrl: "https://api.iiif-atlas.test",
      items: [baseItem, { ...baseItem, id: "x", slug: "x", manifestSlug: null }],
    });
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.id).toBe("https://api.iiif-atlas.test/iiif/manifests/test-item-abc123");
    expect(c.items[0]?.type).toBe("Manifest");
  });
});

describe("classifyIIIFJson", () => {
  it.each([
    [
      { "@context": "http://iiif.io/api/presentation/3/context.json", type: "Manifest" },
      "manifest",
      3,
    ],
    [
      { "@context": "http://iiif.io/api/presentation/2/context.json", "@type": "sc:Manifest" },
      "manifest",
      2,
    ],
    [
      { "@context": "http://iiif.io/api/presentation/3/context.json", type: "Collection" },
      "collection",
      3,
    ],
    [
      { "@context": "http://iiif.io/api/image/3/context.json", type: "ImageService3" },
      "image-info",
      3,
    ],
    [{ "@context": "http://iiif.io/api/image/2/context.json" }, "image-info", 2],
    [{}, "unknown", undefined],
    [null, "unknown", undefined],
  ])("classifies %j as %s (v%s)", (input, kind, version) => {
    const res = classifyIIIFJson(input);
    expect(res.kind).toBe(kind);
    if (version) expect(res.version).toBe(version);
  });
});
