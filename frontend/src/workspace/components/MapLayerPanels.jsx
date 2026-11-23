import { useEffect, useState } from "react";

import CoveragePanel from "../../components/CoveragePanel.jsx";
import OrbitPanel from "../../components/OrbitPanel.jsx";

/** The open layers' panels, stacked over the map's corner. */
export default function MapLayerPanels({ layers, globe }) {
  const { open, close, setHeatmap, setOrbit, pointerSink } = layers;
  const [pointer, setPointer] = useState(null);
  useEffect(() => {
    pointerSink.current = setPointer;
    return () => {
      pointerSink.current = null;
    };
  }, [pointerSink]);
  if (!open.coverage && !open.orbit) return null;
  return (
    <div className="map-layer-panels">
      {open.orbit && <OrbitPanel onLayer={setOrbit} onClose={() => close("orbit")} />}
      {open.coverage && (
        <CoveragePanel globe={globe} pointer={pointer} onLayer={setHeatmap} onClose={() => close("coverage")} />
      )}
    </div>
  );
}
