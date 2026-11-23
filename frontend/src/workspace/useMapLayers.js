import { useCallback, useRef, useState } from "react";

/**
 * The map-wide layers (coverage heatmap, NISAR's path): which are open and
 * what each puts on the map. The pointer's position, which only the
 * heatmap's readout needs, is kept in the panels so the map isn't redrawn
 * on every mouse move.
 */
export function useMapLayers() {
  const [open, setOpen] = useState({ coverage: false, orbit: false });
  const [heatmap, setHeatmap] = useState(null);
  const [orbit, setOrbit] = useState(null);
  const pointerSink = useRef(null);
  const toggle = useCallback((name) => setOpen((o) => ({ ...o, [name]: !o[name] })), []);
  const close = useCallback((name) => setOpen((o) => ({ ...o, [name]: false })), []);
  const onPointerMove = useCallback((p) => pointerSink.current?.(p), []);
  return { open, toggle, close, heatmap, setHeatmap, orbit, setOrbit, pointerSink, onPointerMove };
}
