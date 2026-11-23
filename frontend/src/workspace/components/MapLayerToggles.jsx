/**
 * Map-wide layers beside the 2D/3D switch: the global coverage heatmap and
 * NISAR's computed path, each a pressed-or-not button that opens its panel.
 */
export default function MapLayerToggles({ coverage, orbit, onToggle }) {
  return (
    <div className="map-view-toggle map-layer-toggles" role="group" aria-label="Map layers">
      <button
        type="button"
        aria-pressed={coverage}
        aria-controls={coverage ? "coverage-panel" : undefined}
        onClick={() => onToggle("coverage")}
        title="Heatmap of where and how often NISAR has imaged the Earth"
      >
        Coverage
      </button>
      <button
        type="button"
        aria-pressed={orbit}
        aria-controls={orbit ? "orbit-panel" : undefined}
        onClick={() => onToggle("orbit")}
        title="NISAR's path around the Earth, and where it is at any time"
      >
        Orbit
      </button>
    </div>
  );
}
