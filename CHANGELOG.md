# Changelog

All notable changes to this project are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## 1.0.1 — 2026-04-22

Post-review hardening pass. No behaviour changes, no new features —
only fixes driven by the multi-agent code review of 1.0.0.

### Fixed
- **Query bounds**: annotations, API-key listing, workspace memberships
  and tags all carry explicit `LIMIT`s now; tag listing replaces its
  per-row `COUNT(*)` subquery with a single `LEFT JOIN … GROUP BY`
  that also excludes soft-deleted items from the count.
- **Ingest scoping**: `processIngestJob` now `UPDATE`s items with an
  `AND workspace_id IS ?` guard so a forged or stale queue message
  can't touch another tenant's row. Status transitions write
  `item.ingest.ready` / `item.ingest.failed` audit rows with a null
  actor (system).
- **Dedup race**: `INSERT OR IGNORE` + re-SELECT on the assets table —
  two parallel ingests of the same bytes converge on one row.
- **Auto-revoke shares on soft-delete**: deleting an item or collection
  now flips every targeting `share_tokens.revoked_at`. Audit rows
  carry `revokedShares` when any were touched.
- **Extension storage**: API key moves from `chrome.storage.sync`
  (roams across Chrome profiles) to `chrome.storage.local`. One-shot
  migration reads the legacy location once and clears it.
- **Extension messaging**: `sendToContent` retries once after 250 ms
  when the content-script wasn't ready, then surfaces a user-visible
  error with a reload hint. Failure badges distinguish rate-limit
  (orange) from other errors (red) and carry the message as the
  action tooltip.
- **Extension permissions**: `<all_urls>` narrowed to `https://*/*` +
  `http://*/*` for host permissions and the content-script match.
- **Detector schemes**: `detectFromDocument` now passes every URL
  through an `http:`/`https:` whitelist before emitting it — hostile
  `javascript:`, `data:`, `blob:` URIs are dropped instead of
  surfacing in `imageCandidates` / `manifestUrl` / `infoJsonUrl` /
  `primaryImageUrl`.
- **Web 429 handling**: `ApiError` now carries `retryAfter` (seconds)
  and an `isRateLimited` helper; default message surfaces
  `"Too many requests — retry in Xs"` from the `Retry-After` header.
- **Options form**: `setApiBase` validates the URL is a real
  `http(s):` origin before writing it; options page surfaces the
  error instead of silently accepting `ftp://` / relative paths.

### Added
- **Migration 0009**: composite indexes `(workspace_id, deleted_at)`
  on items & collections, and `(workspace_id, captured_at DESC)` on
  items for the Library list. Triggers enforce the `items.status`
  enum (`processing|ready|failed`) at the DB level — SQLite doesn't
  allow `ALTER TABLE ADD CHECK`, so triggers are the equivalent.
- **`apps/api/src/fts.ts`**: single `toFtsQuery` helper shared between
  `items.ts` and `export.ts` — one place to evolve the FTS sanitiser.
- **`apps/api/src/shares-revoke.ts`**: `revokeSharesFor(env, type, id)`
  helper used by both item and collection soft-delete paths.
- **`audit.ts`**: `AuditContext` type now admits `userId: null` for
  system actors; documents the `item.ingest.*` verbs.
- **Tests**: viewer role enforcement (403 on captures/collections) and
  share-token auto-revoke on soft-delete (verifies `revoked_at`
  stamp on the row, not just resolve behaviour).

## 1.0.0 — 2026-04-21

First production release. Eight-sprint journey from MVP to v1; headline
capabilities summarized below.

### Added
- **Sprint 0 — Test foundations.** Cloudflare `vitest-pool-workers` with
  Miniflare D1 + R2, repo-wide typecheck, Biome lint, router unit tests.
- **Sprint 1 — Auth & tenants.** Users, workspaces, workspace_members,
  API keys (SHA-256 at rest, Crockford base32 bodies), role-based
  writers, `/api/auth/dev-signup`.
- **Sprint 2 — Async ingestion.** Cloudflare Queues producer/consumer
  for cached-mode items, SHA-256 dedup into R2, image probing, sync
  fallback for single-instance dev.
- **Sprint 3 — IIIF Image API 3.** Level-0 canonical URIs + info.json,
  served from R2.
- **Sprint 4 — Advanced capture.** Region overlay, IIIF reuse mode,
  metadata overrides, retry flow.
- **Sprint 5 — Search / tags / exports.** FTS5 item search with facets,
  workspace-scoped tags, JSON/CSV/RIS export.
- **Sprint 6 — Annotations & shares.** IIIF Web Annotations (one row
  per annotation, public AnnotationPage), revocable share tokens.
- **Sprint 7 — Publication & interop.** IIIF Change Discovery 1
  feed, sitemap, oEmbed, public IIIF collections.
- **Sprint 8 — Hardening & v1.**
  - Append-only audit log (`audit_log`) for every mutation we care
    about: `item.{create,update,delete,restore}`,
    `collection.{create,update,delete,restore}`,
    `annotation.{create,delete}`, `share.{create,revoke}`,
    `apikey.{create,revoke}`.
  - Soft delete for items & collections. `DELETE` on
    `/api/items/:id` / `/api/collections/:id` sets `deleted_at`; every
    read (API + public IIIF + discovery + sitemap + export + share
    resolve) adds `deleted_at IS NULL`.
  - `GET /api/trash` — tombstones for the caller's workspace.
  - `POST /api/items/:id/restore`, `POST /api/collections/:id/restore` —
    undelete.
  - D1-backed token-bucket rate limiter. `POST /api/captures` is
    capped at 30 captures burst / 0.5 per second sustained per API key;
    returns `429` + `Retry-After` when exhausted.
  - `GET /api/workspaces/current/usage` — items / trash / collections /
    annotations / active shares / asset bytes rollup.

### Security
- SSRF guard on every outbound URL (IPv4 private ranges + IPv6
  private/IPv4-mapped + userinfo + scheme filtering).
- API keys stored as SHA-256 digests; share tokens likewise.
- All public endpoints (`/iiif/*`, `/sitemap.xml`, `/oembed`) filter
  `deleted_at IS NULL` and gate collections by `is_public`.
