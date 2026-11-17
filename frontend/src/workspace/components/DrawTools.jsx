import { Icon } from "../../platform/icons.jsx";
import PlaceSearch from "./PlaceSearch.jsx";

/**
 * The map's tools: find a place by name (it opens as an area to search), the
 * drawing buttons, a box (an area to search) or a line (a height profile),
 * and Clear once something is drawn. `drawing` is the tool in use.
 */
export default function DrawTools({ drawing, onToggle, canClear, onClear, areaButtonRef, lineButtonRef, onPlace }) {
  return (
    <div className="map-draw-tools">
      {onPlace && <PlaceSearch onPick={onPlace} />}
      <div className="map-draw-buttons" role="group" aria-label="Drawing tools">
      <button
        type="button"
        ref={areaButtonRef}
        data-tour="draw-area"
        className="btn map-action draw-action"
        aria-pressed={drawing === "area"}
        aria-describedby={drawing === "area" ? "draw-instructions" : undefined}
        onClick={() => onToggle("area")}
      >
        <Icon name="drawArea" size={16} strokeWidth={2} />
        <span className="map-action-label">Draw area</span>
      </button>
      <button
        type="button"
        ref={lineButtonRef}
        data-tour="draw-line"
        className="btn map-action draw-action"
        aria-pressed={drawing === "line"}
        aria-describedby={drawing === "line" ? "draw-instructions" : undefined}
        title="Draw a line to see a height profile over time"
        onClick={() => onToggle("line")}
      >
        <Icon name="drawLine" size={16} strokeWidth={2} />
        <span className="map-action-label">Draw line</span>
      </button>
      {canClear && (
        <button type="button" className="btn map-action" title="Remove what you drew from the map" onClick={onClear}>
          Clear
        </button>
      )}
      </div>
    </div>
  );
}
