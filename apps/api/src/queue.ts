import type { Env } from "./env.js";
import { processIngestJob } from "./ingest.js";

export interface IngestMessage {
  type: "ingest_cached";
  itemId: string;
}

/**
 * Enqueue a cached-mode ingestion. Falls back to inline execution when no
 * `INGEST_QUEUE` binding is configured (tests, local single-instance dev).
 * In both cases the caller observes the same eventual state.
 */
export async function enqueueIngest(env: Env, itemId: string): Promise<void> {
  if (env.INGEST_QUEUE) {
    await env.INGEST_QUEUE.send({ type: "ingest_cached", itemId } satisfies IngestMessage);
    return;
  }
  await processIngestJob(env, itemId);
}
