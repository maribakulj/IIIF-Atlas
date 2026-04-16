import { useEffect, useRef } from "react";

/**
 * Thin wrapper around Mirador 3. We dynamically import to avoid loading
 * ~1.5 MB of JS on pages that don't need it.
 */
export function MiradorViewer({ manifestUrl }: { manifestUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ unmount?: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mirador-${Math.random().toString(36).slice(2, 10)}`;
    if (containerRef.current) containerRef.current.id = id;

    (async () => {
      const mod = await import("mirador");
      const mirador = (mod as unknown as { default: { viewer: (config: unknown) => unknown } }).default;
      if (cancelled || !containerRef.current) return;
      viewerRef.current = mirador.viewer({
        id,
        windows: [{ manifestId: manifestUrl }],
        window: { sideBarPanel: "info" },
        workspace: { type: "mosaic" },
        workspaceControlPanel: { enabled: false },
      }) as { unmount?: () => void };
    })().catch((err) => {
      console.error("[Mirador] failed to load", err);
    });

    return () => {
      cancelled = true;
      try {
        viewerRef.current?.unmount?.();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
  }, [manifestUrl]);

  return <div ref={containerRef} className="mirador-container" />;
}
