import { lazy, Suspense, useEffect, useState } from "react";

import ErrorBoundary from "../components/ErrorBoundary.jsx";

const WorkspaceApp = lazy(() => import("../workspace/WorkspaceApp.jsx"));

// Mounts the map workspace on its first visit and then keeps it mounted,
// hidden and inert, while other pages are shown. Leaflet is lazy-loaded so
// the docs never pay for it until someone opens the workspace.
export default function WorkspaceHost({ active }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);

  useEffect(() => {
    if (!active) return undefined;
    // Leaflet measured a zero-size container while hidden; a resize event
    // makes it re-measure (its trackResize handler calls invalidateSize).
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(frame);
  }, [active]);

  if (!visited) return null;
  return (
    <div
      id={active ? "pf-main" : undefined}
      className="pf-workspace"
      hidden={!active}
      inert={!active ? true : undefined}
    >
      <ErrorBoundary>
        <Suspense fallback={<p className="pf-loading" role="status">Loading the map workspace…</p>}>
          <WorkspaceApp active={active} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
