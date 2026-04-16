/**
 * SSRF guards. Blocks requests to private / loopback / link-local addresses
 * and disallowed URL schemes. Runs before any outbound fetch.
 *
 * Note: Cloudflare Workers' fetch does not let us force a resolved IP, so we
 * do hostname-based filtering. We block bare IP literals in private ranges
 * and common metadata endpoints. For full protection in production, put the
 * Worker behind a proxy that enforces egress rules, or use Cloudflare's
 * Egress policies.
 */

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const octets = [1, 2, 3, 4].map((i) => Number(m[i]));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const stripped = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (stripped === "::" || stripped === "::1") return true;
  if (stripped.startsWith("fc") || stripped.startsWith("fd")) return true; // ULA
  if (stripped.startsWith("fe80:")) return true; // link-local
  if (stripped.startsWith("::ffff:")) {
    // IPv4-mapped
    const v4 = stripped.slice("::ffff:".length);
    return isPrivateIPv4(v4);
  }
  return false;
}

/** Returns null if the URL is allowed, or a string reason if it's blocked. */
export function validateOutboundUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return "blocked_scheme";
  const host = url.hostname.toLowerCase();
  if (!host) return "empty_host";
  if (PRIVATE_HOSTNAMES.has(host)) return "blocked_private_host";
  if (host.endsWith(".localhost") || host.endsWith(".local")) return "blocked_private_host";
  if (isPrivateIPv4(host)) return "blocked_private_ip";
  if (host.includes(":") && isPrivateIPv6(host)) return "blocked_private_ip";
  // Block URL userinfo (can be used to smuggle headers into some clients)
  if (url.username || url.password) return "blocked_userinfo";
  return null;
}

export function assertOutboundUrl(raw: string): URL {
  const reason = validateOutboundUrl(raw);
  if (reason) {
    const err = new Error(`Outbound URL rejected: ${reason}`);
    (err as Error & { code: string }).code = reason;
    throw err;
  }
  return new URL(raw);
}
