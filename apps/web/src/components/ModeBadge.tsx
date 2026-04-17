import type { IngestionMode } from "@iiif-atlas/shared";

const LABELS: Record<IngestionMode, string> = {
  reference: "Reference",
  cached: "Cached in R2",
  iiif_reuse: "IIIF reuse",
};

export function ModeBadge({ mode }: { mode: IngestionMode }) {
  return <span className={`badge badge-${mode}`}>{LABELS[mode]}</span>;
}
