/**
 * Sanitize a user-provided query string for a D1 FTS5 `MATCH` clause.
 *
 * Strips FTS5 reserved characters, splits into whitespace-separated
 * tokens, and appends a `*` prefix-match suffix on each — the ergonomic
 * as-you-type behaviour the UI relies on.
 *
 * Returns an empty string if the query is empty after sanitisation,
 * which callers should treat as "no FTS filter".
 */
export function toFtsQuery(q: string): string {
  const tokens = q
    .replace(/["()*:]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" ");
}
