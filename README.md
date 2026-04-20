# IIIF Atlas — Visual Zotero for IIIF

Capture images from the web, detect existing IIIF resources, and publish
stable IIIF Presentation 3 manifests and collections. MVP built on
Cloudflare (Workers + D1 + R2) with a React web app and a WebExtension MV3
browser extension.

## Repository layout

```
iiif-atlas/
├── packages/
│   └── shared/                # Types, IIIF builders, detection helpers
├── apps/
│   ├── api/                   # Cloudflare Workers backend (D1 + R2)
│   ├── web/                   # React + Vite web app (Mirador viewer)
│   └── extension/             # WebExtension Manifest V3
└── README.md
```

## Features (MVP)

### Extension (Manifest V3)

- Popup detects the primary image, IIIF manifest, or IIIF `info.json` on the current page.
- Multi-select thumbnails to clip several images at once.
- Context menu entries: **Add this image…** and **Add this page…**.
- Options page to configure the backend URL.
- Three ingestion modes:
  - `reference` — just record the URL
  - `cached` — download the image to R2
  - `iiif_reuse` — reference an existing IIIF manifest/info.json

### Backend (Cloudflare Workers)

- `POST /api/captures` — accept a clip from the extension.
- `POST /api/items`, `GET /api/items`, `GET /api/items/:id`, `PATCH /api/items/:id`.
- `POST /api/items/:id/generate-manifest` — regenerate the cached manifest JSON.
- `POST /api/collections`, `GET /api/collections`, `GET /api/collections/:id`, `PATCH /api/collections/:id`.
- `GET /iiif/manifests/:slug` — public, stable IIIF Presentation 3 manifest.
- `GET /iiif/collections/:slug` — public IIIF Collection.
- `GET /r2/<key>` — R2 passthrough for cached images.
- Persistence in Cloudflare D1, binary storage in Cloudflare R2.
- Security: SSRF guard on every outbound fetch, byte-size cap, MIME allow-list, fetch timeout.

### Web app

- Dashboard (recent items + collections).
- Library (search + filter by ingestion mode).
- Item page with editable metadata, provenance view, Mirador viewer.
- Collection editor with drag-free ordering and public-URL preview.
- Settings page (API URL, endpoint documentation).

## Ingestion modes

| Mode          | Downloads image? | Uses source IIIF manifest? | Notes |
|---------------|------------------|----------------------------|-------|
| `reference`   | No               | No                         | Records page + image URL only; the generated manifest references the remote image. |
| `cached`      | Yes (to R2)      | No                         | Image is fetched with SSRF / size / MIME guards and stored immutably in R2. |
| `iiif_reuse`  | No               | Yes                        | Upstream manifest is fetched, validated as IIIF, then re-published under a stable Atlas URL. |

## Business guarantees

- Every item retains `source_page_url` and, when known, `source_image_url`.
- Every published manifest/collection has a stable URL:
  - `https://<api>/iiif/manifests/<slug>`
  - `https://<api>/iiif/collections/<slug>`
- `source_manifest_url` is preserved in item metadata when `iiif_reuse` is used.
- Captures are stored raw in the `captures` table alongside the resulting item for audit.

## Search, tags & exports (Sprint 5)

- **Full-text search**. `GET /api/items?q=…` now runs against a D1 FTS5
  virtual table kept in sync via triggers (`apps/api/migrations/
  0005_fts_tags.sql`). Queries are tokenised with the Porter stemmer
  and each term gets a prefix match (`term*`), so as-you-type search
  "just works". FTS5 reserved characters (`" ( ) * :`) are stripped
  from user input.
- **Tags**. Per-workspace, auto-created by slug. Attach with
  `POST /api/items/:id/tags {name}`, detach with
  `DELETE /api/items/:id/tags/:slug`, enumerate via `GET /api/tags`
  (with item counts). Items carry their tag slugs on every list/get
  response.
- **Facets**. Pass `?facets=1` to `GET /api/items` for post-filter
  counts on `mode`, `tag`, and `sourceHost` (a heuristic host
  extraction from `source_page_url`).
- **Sorting**. `?sort=captured_at_desc|captured_at_asc|title_asc`.
- **Rights**. `items.rights` stores a URL (e.g. a Creative Commons
  deed) or an identifier; exposed on every item, settable via PATCH.
- **Export**. `GET /api/export/items?format=json|csv|ris` streams the
  current workspace (honouring the same q/tag/mode/rights filters) in
  one of three shapes. The RIS variant uses `TY - ART` so Zotero
  imports each capture as an "Artwork" record.

## Advanced capture (Sprint 4)

- **Region of interest**. Right-click any image → *Clip region of this
  image…*, or use the popup's *Clip region…* button. The content script
  drops a full-viewport overlay the user can drag a rectangle on.
  Coordinates are converted from CSS pixels to the image's intrinsic
  pixels (`naturalWidth/Height`) and shipped as an `xywh` fragment
  (`"x,y,w,h"`) on the capture. The manifest builder emits a
  non-painting `highlighting` `AnnotationPage` targeting
  `canvas#xywh=…` so viewers like Mirador render a box overlay.
- **Enriched IIIF detection**. Beyond the existing `<link rel="iiif…">`
  / JSON-LD `@context` sniffing, the detector now also picks up
  `[data-iiif-manifest]`, `[data-iiif-manifest-id]`, `[data-manifest]`,
  `[data-iiif]` attributes, and `<meta name="iiif-manifest">` tags
  commonly used by Mirador/UV/OpenSeadragon embeds.
- **Keyboard shortcut**. `Ctrl+Shift+L` (⌘+Shift+L on macOS) runs the
  "capture the primary image of this page" action. Rebind in
  `chrome://extensions/shortcuts`.
- **Per-domain ingestion presets**. The Options page accepts a JSON
  map of `hostname → mode` (reference / cached / iiif_reuse). Hostnames
  inherit from their parent — a preset on `example.org` applies to
  `sub.example.org`.

## IIIF Image API (Sprint 3)

Every cached asset is served through a real IIIF Image API 3 service —
not just as a raw blob. This means viewers (Mirador, Universal Viewer)
discover an `info.json` and treat the image as first-class IIIF content.

| Endpoint                                                                | Behaviour                          |
|-------------------------------------------------------------------------|------------------------------------|
| `GET /iiif/image/<sha256>/info.json`                                    | Level-0 info.json with width/height|
| `GET /iiif/image/<sha256>/full/max/0/default.<native-ext>`              | Streams the asset from R2          |
| Anything else (region / size / rotation / format conversion)            | `501 Not Implemented` (level 0)    |

The asset's `sha256` is the content-addressed identifier we already
mint at ingestion time, so URLs are inherently immutable.

Manifests for `mode = 'cached'` items now embed an `ImageService3`
reference on the canvas annotation body, with `id =
{publicBaseUrl}/iiif/image/{sha256}` and `profile = level0`. Forward
upgrades to level 1+ (with tiles) become invisible to clients —
they just keep working better.

For `mode = 'iiif_reuse'` items we forward the upstream manifest's
canvases and services unchanged (only rewriting the manifest's `id` to
our public URL).

## Ingestion pipeline (Sprint 2)

Cached-mode captures are processed asynchronously via Cloudflare Queues
(or inline when no `INGEST_QUEUE` binding is configured — for tests /
single-instance dev).

Lifecycle:

1. `POST /api/captures` (mode=`cached`) creates the item with
   `status='processing'` and enqueues an `ingest_cached` job.
2. The queue consumer (`queue()` export) downloads via `safeFetch`
   (SSRF + size + MIME guards), computes SHA-256, and:
   - **dedupes** against the `assets` table — a bytewise duplicate already
     in R2 is reused without re-storing.
   - **probes dimensions** via the magic-bytes parser
     (`apps/api/src/image-probe.ts`, supports PNG / JPEG / GIF / WebP) and
     persists `(sha256, mime, byte_size, width, height, r2_key)`.
   - flips the item to `status='ready'` with the resolved `r2Key`,
     `assetSha256`, dimensions, etc.
3. Failures land as `status='failed'` with an `errorMessage`. The web app
   shows a retry button; `POST /api/items/:id/retry` re-enqueues.

Response codes:

- `201` when ingestion ran inline (sync path: no queue binding).
- `202` when handed off to the queue (async path).

Either way the response carries the freshly-inserted item, and the
client can poll `GET /api/items/:id` until `status === 'ready'`.

## Auth (Sprint 1)

- **API keys** (Bearer tokens) authenticate every mutation and every
  workspace-scoped read. Format: `iia_` + 32 crockford chars; only the
  SHA-256 hex digest is stored at rest.
- **Workspaces** isolate data: every item / collection / capture carries a
  `workspace_id`. Cross-workspace reads return 404, never 200, even when
  hitting an item by direct ID.
- **Roles**: `owner`, `editor`, `viewer`. Viewers can read; owners and
  editors mutate. (Bypassable for the workspace's owner since they own the
  default key on signup.)
- **Bootstrap**: with `ALLOW_DEV_SIGNUP=true` (set in `wrangler.toml` for
  local + staging, off in production), `POST /api/auth/dev-signup` creates
  a user + a workspace + a first API key in one call. The web app's sign-in
  screen calls this in dev. In production, mint keys via `wrangler d1
  execute` or expose your own SSO flow.
- **Public IIIF endpoints stay public**: `GET /iiif/manifests/:slug` and
  `GET /iiif/collections/:slug` (when `is_public = 1`) are reachable
  without a key — the whole point of publishing.

Routes summary:

| Endpoint                                      | Auth      | Notes                  |
|-----------------------------------------------|-----------|------------------------|
| `POST /api/auth/dev-signup`                   | none      | gated by env flag      |
| `GET  /api/auth/me`                           | required  | identity + workspaces  |
| `GET/POST /api/auth/api-keys`                 | required  | list, mint             |
| `DELETE /api/auth/api-keys/:id`               | required  | revoke                 |
| `POST /api/captures`                          | writer    | workspace-scoped       |
| `GET/PATCH /api/items[/:id]`                  | writer*   | workspace-scoped       |
| `POST /api/items/:id/generate-manifest`       | writer    | workspace-scoped       |
| `GET/POST/PATCH /api/collections[/:id]`       | writer*   | workspace-scoped       |
| `GET /iiif/manifests/:slug`                   | none      | public                 |
| `GET /iiif/collections/:slug`                 | none      | only if `is_public`    |
| `GET /r2/<key>`                               | none      | public passthrough     |

`writer*`: GET only requires authentication; PATCH/POST require non-viewer.

## Security

- SSRF guard blocks loopback, link-local, private, CGNAT, multicast, and IPv6 private ranges
  (including IPv4-mapped IPv6 in normalized hex form), plus disallowed schemes and URL
  userinfo (`apps/api/src/ssrf.ts`).
- `safeFetch` enforces a per-request byte cap (`MAX_DOWNLOAD_BYTES`, default 25 MiB),
  an `AbortController` timeout (`FETCH_TIMEOUT_MS`, default 15 s), and a MIME allow-list
  (`ALLOWED_MIME_TYPES`).
- CORS allow-list driven by `ALLOWED_ORIGINS` (supports `chrome-extension://*` and
  `moz-extension://*` patterns).
- Redirect URLs are re-validated after fetch.
- Write endpoints are unauthenticated in the MVP — put the Worker behind
  Cloudflare Access or add an API key before exposing publicly.

## Local development

### 0. Prerequisites

- Node 20+
- pnpm 9+
- Cloudflare account + `wrangler` (installed per-package)
- `wrangler login` once

### 1. Install

```bash
pnpm install
```

### 2. Create the D1 database & R2 bucket (one-off)

```bash
cd apps/api
npx wrangler d1 create iiif_atlas
# Copy the returned database_id into apps/api/wrangler.toml

npx wrangler r2 bucket create iiif-atlas-media
npx wrangler r2 bucket create iiif-atlas-media-preview   # for `wrangler dev`
```

### 3. Apply migrations

```bash
pnpm --filter @iiif-atlas/api migrate:local       # local miniflare D1
pnpm --filter @iiif-atlas/api migrate:remote      # production D1 (when ready)
```

### 4. Run the backend

```bash
pnpm dev:api    # starts wrangler dev on http://localhost:8787
```

### 5. Run the web app

```bash
# In a second terminal:
VITE_API_BASE_URL=http://localhost:8787 pnpm dev:web
# Open http://localhost:5173
```

### 6. Build the extension

```bash
pnpm dev:extension   # watch mode, outputs to apps/extension/dist
```

Load `apps/extension/dist` as an **unpacked extension** in Chrome/Edge
(`chrome://extensions` → *Load unpacked*) or via `about:debugging` in Firefox.
Open the extension options page and point it at `http://localhost:8787`.

### 7. Try a capture

1. Browse to any page with an image.
2. Click the IIIF Atlas extension icon → select images → **Add to library**.
3. Open the web app — the item appears in the Library.
4. Open the item, click **Regenerate manifest**, and view it in Mirador.
5. The public manifest URL is printed in the item's *Provenance* panel.

## Deployment (Cloudflare)

### Backend (Workers)

```bash
cd apps/api
# ensure D1 id and R2 bucket names in wrangler.toml are correct
pnpm --filter @iiif-atlas/api migrate:remote --env production
pnpm --filter @iiif-atlas/api deploy -- --env production
```

Bind a custom domain (e.g. `api.iiif-atlas.example.com`) and set it as
`PUBLIC_BASE_URL` in `wrangler.toml` under `[env.production.vars]`.

### Web app (Cloudflare Pages)

```bash
cd apps/web
VITE_API_BASE_URL=https://api.iiif-atlas.example.com pnpm build
npx wrangler pages deploy dist --project-name=iiif-atlas-web
```

Create the Pages project in the Cloudflare dashboard the first time, and
set `VITE_API_BASE_URL` as a build-time variable.

### Extension

Extensions cannot be hosted on Cloudflare; they ship through the browser
stores. For the MVP, distribute the `apps/extension/dist` folder as:

- Chrome Web Store — zip `dist/` and upload.
- Firefox Add-ons — zip `dist/` and submit to AMO.
- Edge Add-ons — zip `dist/` and submit to Partner Center.

Each store review will take a few days; during development, load the
unpacked folder directly.

## Deployment plan — summary

| Component | Hosting           | Build artifact                          | Env vars |
|-----------|-------------------|-----------------------------------------|----------|
| API       | Cloudflare Workers | `apps/api/src/index.ts` bundled by Wrangler | `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `MAX_DOWNLOAD_BYTES`, `FETCH_TIMEOUT_MS`, `ALLOWED_MIME_TYPES`, D1 binding `DB`, R2 binding `BUCKET` |
| Web       | Cloudflare Pages   | `apps/web/dist/` (Vite SPA)             | `VITE_API_BASE_URL` |
| Extension | Chrome / Firefox / Edge stores | `apps/extension/dist/` zipped   | `chrome.storage.sync.apiBase` (set from Options page) |

## Roadmap beyond the MVP

- Server-side image probing (width / height) via `info.json` or a WASM
  image decoder so generated manifests carry real dimensions.
- Authentication (Cloudflare Access, API keys, or OAuth).
- Multi-image items (paged IIIF manifests).
- Full-text search via D1 FTS5 or Vectorize.
- Annotation layer (IIIF Web Annotations) backed by D1.
- Drag-and-drop reordering in the collection editor.
- Background job queue via Cloudflare Queues for large cached imports.

## License

See [LICENSE](./LICENSE).
