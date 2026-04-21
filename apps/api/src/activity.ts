/**
 * Activity recording.
 *
 * We append one row per public mutation that a IIIF consumer might care
 * about: manifest create/update, public collection create/update. Private
 * collections do not produce events — the feed itself is public.
 *
 * Callers do not block on activity writes: failures are swallowed so a
 * hiccup here never stops a capture from succeeding.
 */

import type { Env } from "./env.js";
import { ulid } from "./slug.js";

export type ActivityVerb = "Create" | "Update" | "Delete";
export type ActivityObjectType = "Manifest" | "Collection";

export async function recordActivity(
  env: Env,
  verb: ActivityVerb,
  objectType: ActivityObjectType,
  objectSlug: string,
): Promise<void> {
  if (!objectSlug) return;
  try {
    await env.DB.prepare(
      `INSERT INTO activity_events (id, verb, object_type, object_slug) VALUES (?,?,?,?)`,
    )
      .bind(ulid(), verb, objectType, objectSlug)
      .run();
  } catch (err) {
    console.warn("[activity] record failed", err);
  }
}
