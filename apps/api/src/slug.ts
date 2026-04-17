/**
 * Tiny ULID + slug helpers. We avoid external deps to keep the worker lean.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(): string {
  const time = Date.now();
  let timeChars = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    timeChars = CROCKFORD[t % 32] + timeChars;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  let randChars = "";
  for (let i = 0; i < 16; i++) {
    const b = rand[i] ?? 0;
    randChars += CROCKFORD[b % 32];
  }
  return timeChars + randChars;
}

export function slugify(input: string, fallback = ""): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || fallback;
}

export function shortId(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CROCKFORD[(bytes[i] ?? 0) % 32];
  }
  return out.toLowerCase();
}

export function itemSlug(title: string | undefined | null): string {
  const base = slugify(title ?? "", "item");
  return `${base}-${shortId(6)}`;
}
