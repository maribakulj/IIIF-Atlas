/**
 * "Open in…" shortcuts to hosted IIIF viewers.
 *
 * The heavy lifting is on the viewer side — we just hand them the
 * manifest URL via their query-string contract and let the user pick a
 * renderer they're already comfortable with.
 */

export function ViewerLinks({ manifestUrl }: { manifestUrl: string }) {
  const encoded = encodeURIComponent(manifestUrl);
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      <a
        className="btn btn-xs btn-ghost"
        href={`https://projectmirador.org/embed/?iiif-content=${encoded}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in Mirador
      </a>
      <a
        className="btn btn-xs btn-ghost"
        href={`https://uv-v4.netlify.app/#?iiifManifestId=${encoded}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in Universal Viewer
      </a>
      <a className="btn btn-xs btn-ghost" href={manifestUrl} target="_blank" rel="noreferrer">
        Manifest JSON
      </a>
    </div>
  );
}
