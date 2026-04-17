// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { detectFromDocument } from "../src/detect.js";

function makeDocument(html: string, baseUrl = "https://example.com/") {
  const doc = document.implementation.createHTMLDocument();
  const base = doc.createElement("base");
  base.href = baseUrl;
  doc.head.appendChild(base);
  doc.documentElement.innerHTML = html;
  return doc;
}

describe("detectFromDocument", () => {
  it("returns og:image as the primary image", () => {
    const doc = makeDocument(
      `<head><title>Pretty title</title>
       <meta property="og:image" content="https://cdn.example.com/hero.jpg"></head>
       <body><img src="/small.jpg" width="32" height="32"/></body>`,
    );
    const res = detectFromDocument(doc);
    expect(res.primaryImageUrl).toBe("https://cdn.example.com/hero.jpg");
    expect(res.pageTitle).toBe("Pretty title");
  });

  it("detects a link rel=iiif manifest", () => {
    const doc = makeDocument(
      `<head><link rel="iiif" href="https://iiif.example/manifest.json"></head><body></body>`,
    );
    const res = detectFromDocument(doc);
    expect(res.manifestUrl).toBe("https://iiif.example/manifest.json");
  });

  it("detects info.json via looksLikeInfoJson", () => {
    const doc = makeDocument(
      `<head><link rel="alternate" href="https://iiif.example/abc/info.json"></head><body></body>`,
    );
    const res = detectFromDocument(doc);
    expect(res.infoJsonUrl).toBe("https://iiif.example/abc/info.json");
  });

  it("picks inline JSON-LD with a IIIF context", () => {
    const doc = makeDocument(
      `<head></head>
       <body>
         <script type="application/ld+json">
           { "@context": "http://iiif.io/api/presentation/3/context.json",
             "type": "Manifest",
             "id": "https://iiif.example/inline-manifest.json" }
         </script>
       </body>`,
    );
    const res = detectFromDocument(doc);
    expect(res.manifestUrl).toBe("https://iiif.example/inline-manifest.json");
  });

  it("de-duplicates image candidates", () => {
    const doc = makeDocument(
      `<head>
         <meta property="og:image" content="https://example.com/a.jpg">
         <meta name="twitter:image" content="https://example.com/a.jpg">
       </head><body></body>`,
    );
    const res = detectFromDocument(doc);
    const a = res.imageCandidates.filter((u) => u === "https://example.com/a.jpg");
    expect(a.length).toBe(1);
  });
});
