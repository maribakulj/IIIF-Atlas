import type {
  Facets,
  GenerateManifestResponse,
  ItemPatch,
  ItemResponse,
  ItemSort,
  ListItemsResponse,
} from "@iiif-atlas/shared";
import { recordActivity } from "../activity.js";
import { requireAuth, requireWriter } from "../auth.js";
import { mapItem } from "../db.js";
import type { ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { badRequest, notFound, unprocessable } from "../errors.js";
import { buildManifestForItem } from "../iiif-builder.js";
import { enqueueIngest } from "../queue.js";

const SORTS: Record<ItemSort, string> = {
  captured_at_desc: "i.captured_at DESC",
  captured_at_asc: "i.captured_at ASC",
  title_asc: "COALESCE(i.title, i.slug) COLLATE NOCASE ASC",
};

/** Sanitize a user query for FTS5 MATCH: strip reserved chars, prefix-match each term. */
function toFtsQuery(q: string): string {
  const cleaned = q.replace(/["()*:]/g, " ").trim();
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  // Prefix match on each token — ergonomic as-you-type search.
  return tokens.map((t) => `${t}*`).join(" ");
}

export async function listItems(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const q = url.searchParams.get("q");
  const mode = url.searchParams.get("mode");
  const tag = url.searchParams.get("tag");
  const rights = url.searchParams.get("rights");
  const sortParam = (url.searchParams.get("sort") ?? "captured_at_desc") as ItemSort;
  const sortSql = SORTS[sortParam] ?? SORTS.captured_at_desc;
  const facetsWanted = url.searchParams.get("facets") === "1";

  const joins: string[] = [];
  const where: string[] = ["i.workspace_id = ?"];
  const binds: unknown[] = [auth.workspaceId];

  if (q) {
    const ftsQuery = toFtsQuery(q);
    if (ftsQuery) {
      joins.push("INNER JOIN items_fts f ON f.item_id = i.id");
      where.push("items_fts MATCH ?");
      binds.push(ftsQuery);
    }
  }
  if (mode) {
    where.push("i.mode = ?");
    binds.push(mode);
  }
  if (rights) {
    where.push("i.rights = ?");
    binds.push(rights);
  }
  if (tag) {
    where.push(
      `EXISTS (SELECT 1 FROM item_tags it_f
                 JOIN tags t_f ON t_f.id = it_f.tag_id
                WHERE it_f.item_id = i.id AND t_f.slug = ? AND t_f.workspace_id = i.workspace_id)`,
    );
    binds.push(tag);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const joinSql = joins.join(" ");

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT i.id) AS c FROM items i ${joinSql} ${whereSql}`,
  )
    .bind(...binds)
    .first<{ c: number }>();
  const total = totalRow?.c ?? 0;

  // LEFT-join tags for display. GROUP_CONCAT keeps tags in one row per item.
  const rows = await env.DB.prepare(
    `SELECT i.*, GROUP_CONCAT(DISTINCT t.slug) AS tag_slugs
       FROM items i
       ${joinSql}
       LEFT JOIN item_tags it ON it.item_id = i.id
       LEFT JOIN tags t ON t.id = it.tag_id
       ${whereSql}
      GROUP BY i.id
      ORDER BY ${sortSql}
      LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<ItemRow>();

  const payload: ListItemsResponse = {
    items: (rows.results ?? []).map((r) => mapItem(r, env.PUBLIC_BASE_URL)),
    total,
    limit,
    offset,
  };

  if (facetsWanted) {
    payload.facets = await computeFacets(env, joinSql, whereSql, binds);
  }
  return Response.json(payload);
}

async function computeFacets(
  env: Env,
  joinSql: string,
  whereSql: string,
  binds: unknown[],
): Promise<Facets> {
  const modeRows = await env.DB.prepare(
    `SELECT i.mode AS value, COUNT(DISTINCT i.id) AS count
       FROM items i ${joinSql} ${whereSql}
      GROUP BY i.mode
      ORDER BY count DESC`,
  )
    .bind(...binds)
    .all<{ value: string; count: number }>();

  const tagRows = await env.DB.prepare(
    `SELECT t.slug AS value, COUNT(DISTINCT it.item_id) AS count
       FROM item_tags it
       JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id IN (SELECT DISTINCT i.id FROM items i ${joinSql} ${whereSql})
      GROUP BY t.slug
      ORDER BY count DESC
      LIMIT 50`,
  )
    .bind(...binds)
    .all<{ value: string; count: number }>();

  const hostRows = await env.DB.prepare(
    // Extract "host" by taking everything after "://" up to the next "/".
    // Poor man's URL parse — sufficient for a facet display.
    `SELECT LOWER(SUBSTR(
              i.source_page_url,
              INSTR(i.source_page_url, '://') + 3,
              CASE
                WHEN INSTR(SUBSTR(i.source_page_url, INSTR(i.source_page_url, '://') + 3), '/') > 0
                  THEN INSTR(SUBSTR(i.source_page_url, INSTR(i.source_page_url, '://') + 3), '/') - 1
                ELSE 1000
              END)) AS value,
            COUNT(DISTINCT i.id) AS count
       FROM items i ${joinSql} ${whereSql} AND i.source_page_url IS NOT NULL
      GROUP BY value
      ORDER BY count DESC
      LIMIT 25`,
  )
    .bind(...binds)
    .all<{ value: string; count: number }>();

  return {
    mode: (modeRows.results ?? []).map((r) => ({ value: r.value, count: r.count })),
    tag: (tagRows.results ?? []).map((r) => ({ value: r.value, count: r.count })),
    sourceHost: (hostRows.results ?? [])
      .filter((r) => r.value)
      .map((r) => ({ value: r.value, count: r.count })),
  };
}

export async function getItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  const row = await env.DB.prepare(
    `SELECT i.*, GROUP_CONCAT(DISTINCT t.slug) AS tag_slugs
       FROM items i
       LEFT JOIN item_tags it ON it.item_id = i.id
       LEFT JOIN tags t ON t.id = it.tag_id
      WHERE (i.id = ? OR i.slug = ?) AND i.workspace_id = ?
      GROUP BY i.id`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
  if (!row) throw notFound();
  const payload: ItemResponse = { item: mapItem(row, env.PUBLIC_BASE_URL) };
  return Response.json(payload);
}

export async function patchItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as ItemPatch | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ?`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
  if (!row) throw notFound();

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(body.title);
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    binds.push(body.description);
  }
  if (body.metadata !== undefined) {
    sets.push("metadata_json = ?");
    binds.push(body.metadata === null ? null : JSON.stringify(body.metadata));
  }
  if (body.mode !== undefined) {
    if (!["reference", "cached", "iiif_reuse"].includes(body.mode)) {
      throw badRequest("Invalid mode");
    }
    sets.push("mode = ?");
    binds.push(body.mode);
  }
  if (body.rights !== undefined) {
    sets.push("rights = ?");
    binds.push(body.rights);
  }
  if (sets.length === 0) throw badRequest("No fields to update");
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  // Invalidate cached manifest so it gets regenerated next time.
  sets.push("manifest_json = NULL");

  await env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, row.id)
    .run();

  const updated = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(row.id)
    .first<ItemRow>();
  if (!updated) throw notFound();
  if (updated.manifest_slug) {
    await recordActivity(env, "Update", "Manifest", updated.manifest_slug);
  }
  const payload: ItemResponse = { item: mapItem(updated, env.PUBLIC_BASE_URL) };
  return Response.json(payload);
}

export async function generateManifest(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ?`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
  if (!row) throw notFound();

  const item = mapItem(row, env.PUBLIC_BASE_URL);
  const manifest = await buildManifestForItem(env, item);

  await env.DB.prepare(
    `UPDATE items
     SET manifest_json = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
  )
    .bind(JSON.stringify(manifest), row.id)
    .run();

  const refreshed = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(row.id)
    .first<ItemRow>();
  const updated = mapItem(refreshed!, env.PUBLIC_BASE_URL);
  const payload: GenerateManifestResponse = {
    item: updated,
    manifestUrl: updated.manifestUrl!,
  };
  return Response.json(payload);
}

/**
 * Re-enqueue a failed cached-mode item for ingestion. Only mutates the
 * lifecycle fields (status, error_message) — the source URLs are
 * immutable, so there's nothing else to change.
 */
export async function retryItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ?`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
  if (!row) throw notFound();
  if (row.mode !== "cached") {
    throw unprocessable("Only cached items can be retried");
  }
  if (row.status === "processing") {
    throw unprocessable("Item is already being processed");
  }

  await env.DB.prepare(
    `UPDATE items SET status = 'processing', error_message = NULL,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
  )
    .bind(row.id)
    .run();
  await enqueueIngest(env, row.id);

  const refreshed = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(row.id)
    .first<ItemRow>();
  return Response.json({ item: mapItem(refreshed!, env.PUBLIC_BASE_URL) });
}
