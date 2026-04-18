/**
 * Magic-bytes image dimension probing for the formats we accept in the
 * ingestion allow-list. Pure-TS, no external deps, no decoder — just
 * enough header parsing to extract width × height.
 *
 * Supported (Sprint 2): PNG, JPEG, GIF, WebP (VP8 / VP8L / VP8X variants).
 * Returns null when the format isn't recognized; callers fall back to the
 * "no probed dimensions" branch.
 */

export interface ProbedDimensions {
  width: number;
  height: number;
  /** The detected format, in case the caller wants to cross-check MIME. */
  format: "png" | "jpeg" | "gif" | "webp";
}

export function probeImage(bytes: Uint8Array): ProbedDimensions | null {
  if (bytes.length >= 24 && isPng(bytes)) return probePng(bytes);
  if (bytes.length >= 6 && isGif(bytes)) return probeGif(bytes);
  if (bytes.length >= 30 && isWebp(bytes)) return probeWebp(bytes);
  if (bytes.length >= 4 && isJpeg(bytes)) return probeJpeg(bytes);
  return null;
}

// ---- PNG ----------------------------------------------------------------
//
// Bytes 0..7 are the PNG signature, then an IHDR chunk that always lives
// right after, with width/height as big-endian uint32 at offsets 16 / 20.
function isPng(b: Uint8Array): boolean {
  return (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}
function probePng(b: Uint8Array): ProbedDimensions {
  return {
    width: readU32BE(b, 16),
    height: readU32BE(b, 20),
    format: "png",
  };
}

// ---- GIF ----------------------------------------------------------------
//
// "GIF87a" or "GIF89a" then little-endian uint16 width / height.
function isGif(b: Uint8Array): boolean {
  return (
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  );
}
function probeGif(b: Uint8Array): ProbedDimensions {
  return {
    width: readU16LE(b, 6),
    height: readU16LE(b, 8),
    format: "gif",
  };
}

// ---- WebP ---------------------------------------------------------------
//
// RIFF container: "RIFF" .... "WEBP" then a chunk header for one of:
//   "VP8 " (lossy), "VP8L" (lossless), "VP8X" (extended).
function isWebp(b: Uint8Array): boolean {
  return (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  );
}
function probeWebp(b: Uint8Array): ProbedDimensions | null {
  const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (tag === "VP8 ") {
    // Lossy: width/height at offset 26..29 as 14-bit little-endian halves.
    return {
      width: readU16LE(b, 26) & 0x3fff,
      height: readU16LE(b, 28) & 0x3fff,
      format: "webp",
    };
  }
  if (tag === "VP8L") {
    // Lossless: 4 bytes starting at offset 21 encode w-1 (14 bits) | h-1 (14 bits).
    const sig = b[20];
    if (sig !== 0x2f) return null;
    const v = readU32LE(b, 21);
    return {
      width: (v & 0x3fff) + 1,
      height: ((v >> 14) & 0x3fff) + 1,
      format: "webp",
    };
  }
  if (tag === "VP8X") {
    // Extended: 24-bit little-endian (w-1, h-1) at offset 24 / 27.
    return {
      width: readU24LE(b, 24) + 1,
      height: readU24LE(b, 27) + 1,
      format: "webp",
    };
  }
  return null;
}

// ---- JPEG ---------------------------------------------------------------
//
// JPEG is segment-based. We walk markers until we find a SOF (Start Of
// Frame) marker, then read width/height from its payload.
function isJpeg(b: Uint8Array): boolean {
  return b[0] === 0xff && b[1] === 0xd8;
}
function probeJpeg(b: Uint8Array): ProbedDimensions | null {
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1] ?? 0;
    // Skip fill bytes 0xFF.
    while (marker === 0xff && i + 1 < b.length) {
      i += 1;
      marker = b[i + 1] ?? 0;
    }
    if (marker === 0xd8 || marker === 0xd9) return null; // SOI/EOI
    if (marker === 0xda) return null; // SOS — past the headers
    const len = readU16BE(b, i + 2);
    if (isSofMarker(marker)) {
      // SOF payload: [length(2) | precision(1) | height(2) | width(2) | ...]
      const height = readU16BE(b, i + 5);
      const width = readU16BE(b, i + 7);
      return { width, height, format: "jpeg" };
    }
    i += 2 + len;
  }
  return null;
}
function isSofMarker(m: number): boolean {
  // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC).
  if (m < 0xc0 || m > 0xcf) return false;
  return m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

// ---- byte helpers -------------------------------------------------------
function readU16BE(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
}
function readU16LE(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}
function readU24LE(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);
}
function readU32BE(b: Uint8Array, o: number): number {
  return (
    (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0
  );
}
function readU32LE(b: Uint8Array, o: number): number {
  return (
    ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0
  );
}
