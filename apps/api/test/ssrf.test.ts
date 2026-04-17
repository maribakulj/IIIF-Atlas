import { describe, expect, it } from "vitest";
import { assertOutboundUrl, validateOutboundUrl } from "../src/ssrf.js";

describe("validateOutboundUrl — allow list", () => {
  it.each([
    "https://example.com/image.jpg",
    "http://example.com",
    "https://iiif.bodleian.ox.ac.uk/iiif/manifest/abc.json",
    "https://sub.domain.tld:443/path?q=1",
  ])("allows %s", (url) => {
    expect(validateOutboundUrl(url)).toBeNull();
  });
});

describe("validateOutboundUrl — schemes", () => {
  it.each([
    ["file:///etc/passwd", "blocked_scheme"],
    ["ftp://example.com", "blocked_scheme"],
    ["gopher://example.com", "blocked_scheme"],
    ["data:image/png;base64,AAAA", "blocked_scheme"],
    ["javascript:alert(1)", "blocked_scheme"],
  ])("rejects %s", (url, reason) => {
    expect(validateOutboundUrl(url)).toBe(reason);
  });
});

describe("validateOutboundUrl — IPv4 private ranges", () => {
  it.each([
    "http://127.0.0.1",
    "http://127.0.0.1:8080",
    "http://0.0.0.0",
    "http://10.0.0.1",
    "http://10.255.255.255",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254", // AWS/GCP metadata
    "http://100.64.1.1", // CGNAT
    "http://224.0.0.1", // multicast
    "http://255.255.255.255", // broadcast / reserved
  ])("blocks %s", (url) => {
    expect(validateOutboundUrl(url)).toBe("blocked_private_ip");
  });

  it.each([
    "http://172.15.0.1", // just outside 172.16/12
    "http://172.32.0.1", // just outside 172.16/12
    "http://11.0.0.1", // not 10/8
    "http://8.8.8.8", // public
  ])("allows %s", (url) => {
    expect(validateOutboundUrl(url)).toBeNull();
  });
});

describe("validateOutboundUrl — IPv6 private ranges", () => {
  it.each([
    "http://[::1]/foo",
    "http://[::]/foo",
    "http://[fc00::1]",
    "http://[fd12:3456:789a::1]",
    "http://[fe80::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:10.0.0.1]",
  ])("blocks %s", (url) => {
    expect(validateOutboundUrl(url)).toBe("blocked_private_ip");
  });

  it("allows a public IPv6", () => {
    expect(validateOutboundUrl("http://[2606:4700:4700::1111]")).toBeNull();
  });
});

describe("validateOutboundUrl — hostnames", () => {
  it.each([
    "http://localhost",
    "http://localhost:8787",
    "http://foo.localhost",
    "http://router.local",
    "http://metadata.google.internal",
  ])("blocks %s", (url) => {
    expect(validateOutboundUrl(url)).toBe("blocked_private_host");
  });
});

describe("validateOutboundUrl — userinfo", () => {
  it("blocks URLs with credentials", () => {
    expect(validateOutboundUrl("https://user:pass@example.com")).toBe("blocked_userinfo");
    expect(validateOutboundUrl("https://user@example.com")).toBe("blocked_userinfo");
  });
});

describe("validateOutboundUrl — invalid", () => {
  it.each(["not a url", "://missing-scheme", "http://"])("rejects invalid %s", (url) => {
    // "http://" technically parses with empty host; empty host is its own code.
    expect(validateOutboundUrl(url)).not.toBeNull();
  });
});

describe("assertOutboundUrl", () => {
  it("throws on blocked URL", () => {
    expect(() => assertOutboundUrl("http://127.0.0.1")).toThrow(/blocked_private_ip/);
  });

  it("returns a URL on allowed input", () => {
    expect(assertOutboundUrl("https://example.com").toString()).toBe("https://example.com/");
  });
});
