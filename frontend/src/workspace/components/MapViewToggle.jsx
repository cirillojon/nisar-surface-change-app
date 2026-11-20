/**
 * 2D map or 3D globe, as two pressed-or-not buttons in the map's corner. The
 * 3D one is disabled, and says why, where the browser can't draw a globe.
 */
export default function MapViewToggle({ view, globeUnavailable = false, onChange }) {
  return (
    <div className="map-view-toggle" role="group" aria-label="Map view">
      <button type="button" aria-pressed={view !== "3d" || globeUnavailable} onClick={() => onChange("2d")} title="Flat map, with the drawing tools">
        2D
      </button>
      <button
        type="button"
        aria-pressed={view === "3d" && !globeUnavailable}
        onClick={() => onChange("3d")}
        disabled={globeUnavailable}
        title={globeUnavailable ? "This browser can't draw the 3D globe (it needs WebGL)." : "A globe you can spin and tilt; zoom in for a flat view"}
      >
        3D
      </button>
    </div>
  );
}
