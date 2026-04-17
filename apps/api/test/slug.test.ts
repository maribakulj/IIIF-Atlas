import { describe, expect, it } from "vitest";
import { itemSlug, shortId, slugify, ulid } from "../src/slug.js";

describe("slugify", () => {
  it("lowercases and strips diacritics", () => {
    expect(slugify("Œuvre d'Été — Cliché")).toMatch(/^[a-z0-9-]+$/);
    expect(slugify("Café Noir")).toBe("cafe-noir");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("  !!! hello !!!  ")).toBe("hello");
  });

  it("returns fallback when everything gets stripped", () => {
    expect(slugify("!!!", "fallback")).toBe("fallback");
    expect(slugify("", "x")).toBe("x");
  });

  it("caps length", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("ulid", () => {
  it("produces 26-char crockford base32 strings", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it("is monotonically sortable by time prefix", () => {
    const a = ulid();
    // force a small delay by looping; time prefix is ms-resolution
    let b = ulid();
    for (let i = 0; i < 5; i++) b = ulid();
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });
});

describe("itemSlug + shortId", () => {
  it("suffixes a random id to avoid collisions", () => {
    const a = itemSlug("My Title");
    const b = itemSlug("My Title");
    expect(a).not.toBe(b);
    expect(a.startsWith("my-title-")).toBe(true);
  });

  it("returns a fallback prefix on empty input", () => {
    const s = itemSlug(null);
    expect(s.startsWith("item-")).toBe(true);
  });

  it("shortId produces the requested length", () => {
    expect(shortId(4)).toHaveLength(4);
    expect(shortId(12)).toHaveLength(12);
  });
});
