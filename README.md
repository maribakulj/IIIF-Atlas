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

## Security

- SSRF guard blocks loopback, link-local, private, CGNAT, multicast, and IPv6 private ranges,
  plus disallowed schemes and URL userinfo (`apps/api/src/ssrf.ts`).
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
