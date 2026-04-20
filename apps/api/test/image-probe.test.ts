import { describe, expect, it } from "vitest";
import { probeImage } from "../src/image-probe.js";

// Minimal hand-crafted image headers — no actual encoder needed, just
// enough bytes for the magic-byte parser to read width/height.

function makePng(width: number, height: number): Uint8Array {
  // 8-byte signature + IHDR chunk header + IHDR payload (13 bytes).
  const b = new Uint8Array(8 + 8 + 13);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length = 13 (big-endian uint32) — bytes 8..11
  b.set([0, 0, 0, 13], 8);
  // "IHDR" — bytes 12..15
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  // width (BE u32) — bytes 16..19
  b.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
  // height (BE u32) — bytes 20..23
  b.set([(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff], 20);
  return b;
}

function makeGif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  b[6] = width & 0xff;
  b[7] = (width >>> 8) & 0xff;
  b[8] = height & 0xff;
  b[9] = (height >>> 8) & 0xff;
  return b;
}

function makeWebpVp8(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  b.set([0, 0, 0, 0], 4); // file size (don't care)
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  // VP8 chunk size + bitstream — skip past to bytes 26..29 for w/h.
  b[26] = width & 0xff;
  b[27] = (width >>> 8) & 0xff;
  b[28] = height & 0xff;
  b[29] = (height >>> 8) & 0xff;
  return b;
}

function makeJpeg(width: number, height: number): Uint8Array {
  // SOI + SOF0 segment with width/height in the payload.
  // [FFD8] [FFC0] [00 11] [08] [HH HH] [WW WW] [03] [01 22 00 02 11 01 03 11 01]
  const b = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11, // segment length = 17
    0x08, // precision
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  return b;
}

describe("probeImage", () => {
  it("PNG: reads big-endian width/height from IHDR", () => {
    expect(probeImage(makePng(2400, 1600))).toEqual({
      width: 2400,
      height: 1600,
      format: "png",
    });
  });

  it("GIF: reads little-endian uint16 width/height", () => {
    expect(probeImage(makeGif(640, 480))).toEqual({
      width: 640,
      height: 480,
      format: "gif",
    });
  });

  it("WebP (VP8 lossy): reads 14-bit width/height", () => {
    expect(probeImage(makeWebpVp8(800, 600))).toEqual({
      width: 800,
      height: 600,
      format: "webp",
    });
  });

  it("JPEG: scans markers and reads SOF0 dimensions", () => {
    expect(probeImage(makeJpeg(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
      format: "jpeg",
    });
  });

  it("returns null for unrecognized bytes", () => {
    expect(
      probeImage(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])),
    ).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(probeImage(new Uint8Array())).toBeNull();
  });
});
