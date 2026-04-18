import type { ItemStatus } from "@iiif-atlas/shared";

const LABELS: Record<ItemStatus, string> = {
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === "ready") return null; // ready is the default; no chrome
  return <span className={`badge status-${status}`}>{LABELS[status]}</span>;
}
