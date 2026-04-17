import { detectFromDocument } from "@iiif-atlas/shared";
import type { DetectResult } from "@iiif-atlas/shared";

/** Runs in content script context; re-exports the shared detector. */
export function detectCurrentPage(): DetectResult {
  return detectFromDocument(document);
}
