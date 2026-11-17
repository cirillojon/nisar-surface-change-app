import { useCallback, useEffect, useRef, useState } from "react";
import { Cartesian2, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium";

import { addPoint, canFinish, lineStatus } from "../../services/drawing.js";
import { boxRing } from "../../services/globe.js";
import { normalizeBbox } from "../../services/regions.js";
import { useStableCallback } from "../../services/useStableCallback.js";
import DrawBar, { LineBarButtons } from "../DrawBar.jsx";
import { latLonToCartesian, lonLatAt } from "./geo.js";
import { setLines, setPoints, useCollections } from "./useGlobeShapes.js";

// Drags shorter than this (screen pixels) don't make a box, as on the 2D map.
const MIN_DRAW_PX = 8;
const DRAFT = "#facc15";
const TOO_LONG = "#ef4444";

/** Spinning and tilting off while a box is dragged out (zooming stays); back on after. */
function freezeCamera(scene) {
  const controls = scene.screenSpaceCameraController;
  controls.enableRotate = false;
  controls.enableTilt = false;
  controls.enableLook = false;
  controls.enableTranslate = false;
  return () => {
    if (scene.isDestroyed()) return;
    controls.enableRotate = true;
    controls.enableTilt = true;
    controls.enableLook = true;
    controls.enableTranslate = true;
  };
}

/** Escape cancels; for a line, Enter finishes and Backspace removes the last point (not in a field or on a button). */
function useDrawKeys(active, { onCancel, onFinish, onUndo }) {
  const cancel = useStableCallback(onCancel);
  const finish = useStableCallback(onFinish);
  const undo = useStableCallback(onUndo);
  useEffect(() => {
    if (!active) return undefined;
    const key = (e) => {
      if (e.key === "Escape") cancel();
      if (e.target instanceof Element && e.target.closest("button, a[href], input, select, textarea")) return;
      if (e.key === "Enter") finish();
      if (e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, cancel, finish, undo]);
}

/** Drag on the globe to draw a box: it opens as an area, as on the 2D map. */
export function GlobeAreaDrawer({ scene, onDraw, onCancel, host }) {
  const draft = useCollections(scene);
  const draw = useStableCallback(onDraw);
  useDrawKeys(true, { onCancel, onFinish: () => {}, onUndo: () => {} });
  useEffect(() => {
    if (!draft) return undefined;
    const thaw = freezeCamera(scene);
    scene.canvas.style.cursor = "crosshair";
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    let start = null;
    const show = (bbox) => {
      setLines(draft.lines, bbox ? [{ coords: boxRing(bbox), color: DRAFT, dashed: true }] : []);
      scene.requestRender();
    };
    handler.setInputAction((e) => {
      const from = lonLatAt(scene, e.position);
      if (from) start = { from, at: Cartesian2.clone(e.position) };
    }, ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction((e) => {
      const to = start && lonLatAt(scene, e.endPosition);
      if (to) show(normalizeBbox([...start.from, ...to]));
    }, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((e) => {
      const to = start && lonLatAt(scene, e.position);
      const dragged = start ? Cartesian2.distance(start.at, e.position) : 0;
      const from = start?.from;
      start = null;
      show(null);
      if (!to || dragged < MIN_DRAW_PX) return;
      const bbox = normalizeBbox([...from, ...to]);
      if (bbox[0] < bbox[2] && bbox[1] < bbox[3]) draw(bbox);
    }, ScreenSpaceEventType.LEFT_UP);
    return () => {
      handler.destroy();
      thaw();
      if (!scene.isDestroyed()) scene.canvas.style.cursor = "";
    };
  }, [scene, draft, draw]);
  return (
    <DrawBar host={host} status="Drag on the globe to draw a box.">
      <button type="button" className="btn btn-small btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </DrawBar>
  );
}

/**
 * Click the globe to add points to a line; double-click, Enter or Finish
 * line ends it. The same rules as the 2D map (services/drawing.js): two
 * points at least, and at most MAX_LINE_KM. Points are [lat, lon] there.
 */
export function GlobeLineDrawer({ scene, onDraw, onCancel, host }) {
  const draft = useCollections(scene);
  const [points, setPointsState] = useState([]);
  const [cursor, setCursor] = useState(null);
  const pointsRef = useRef(points);
  const update = useCallback((next) => {
    pointsRef.current = next;
    setPointsState(next);
  }, []);
  const finish = useStableCallback(() => {
    if (canFinish(pointsRef.current)) onDraw(pointsRef.current.map(([lat, lon]) => [lon, lat]));
  });
  const undo = useCallback(() => update(pointsRef.current.slice(0, -1)), [update]);
  useDrawKeys(true, { onCancel, onFinish: finish, onUndo: undo });

  useEffect(() => {
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    scene.canvas.style.cursor = "crosshair";
    handler.setInputAction((e) => {
      const ll = lonLatAt(scene, e.position);
      if (!ll) return;
      const pts = pointsRef.current;
      const last = pts[pts.length - 1];
      const lastOnScreen = last && scene.cartesianToCanvasCoordinates(latLonToCartesian(last));
      const px = lastOnScreen ? Cartesian2.distance(lastOnScreen, e.position) : Infinity;
      update(addPoint(pts, [ll[1], ll[0]], px));
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(finish, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    handler.setInputAction((e) => {
      const ll = lonLatAt(scene, e.endPosition);
      setCursor(ll ? [ll[1], ll[0]] : null);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    return () => {
      handler.destroy();
      if (!scene.isDestroyed()) scene.canvas.style.cursor = "";
    };
  }, [scene, update, finish]);

  // The line so far, on to the pointer; red while longer than a profile may be.
  useEffect(() => {
    if (!draft) return;
    const preview = cursor && points.length ? [...points, cursor] : points;
    const color = lineStatus(preview).warning ? TOO_LONG : DRAFT;
    setLines(draft.lines, [{ coords: preview.map(([lat, lon]) => [lon, lat]), color, dashed: true }], 3);
    setPoints(draft.points, points.map(([lat, lon]) => ({ lon, lat, color: DRAFT, size: 8 })));
    scene.requestRender();
  }, [scene, draft, points, cursor]);

  const status = lineStatus(points);
  return (
    <DrawBar host={host} status={status.text} warning={status.warning}>
      <LineBarButtons points={points} canFinishLine={canFinish(points)} onUndo={undo} onFinish={finish} onCancel={onCancel} />
    </DrawBar>
  );
}
