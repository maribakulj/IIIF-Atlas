# Changelog

All notable changes to this project are documented here. This project
follows [Semantic Versioning](https://semver.org/).

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
