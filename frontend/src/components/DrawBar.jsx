import { createPortal } from "react-dom";

/**
 * The bar shown over the map while drawing: what to do next, and buttons
 * for it, drawn into `host` (an element over the map, outside the map's own
 * DOM, so clicks on the bar never reach the map). The 2D map and the globe
 * both use it.
 */
export default function DrawBar({ host, status, warning = false, children }) {
  if (!host) return null;
  return createPortal(
    <div className="draw-bar" role="group" aria-label="Drawing">
      <span id="draw-instructions" className={warning ? "draw-status warning" : "draw-status"} role="status">
        {status}
      </span>
      <span className="draw-bar-actions">{children}</span>
    </div>,
    host,
  );
}

/** Undo, Finish line and Cancel, for a line being drawn. */
export function LineBarButtons({ points, canFinishLine, onUndo, onFinish, onCancel }) {
  return (
    <>
      <button type="button" className="btn btn-small btn-secondary" onClick={onUndo} disabled={!points.length}>
        Undo
      </button>
      <button type="button" className="btn btn-small btn-primary" onClick={onFinish} disabled={!canFinishLine}>
        Finish line
      </button>
      <button type="button" className="btn btn-small btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
