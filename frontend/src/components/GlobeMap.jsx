import { useEffect, useRef, useState } from "react";
import { Cartesian3, Math as CesiumMath, Rectangle, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium";

import { GLOBE_HOME, cameraBox, focusLines, markersOf, overlayShapes, spanAtZoom } from "../services/globe.js";
import { useStableCallback } from "../services/useStableCallback.js";
import GlobeControls from "./globe/GlobeControls.jsx";
import { lonLatAt } from "./globe/geo.js";
import { GlobeAreaDrawer, GlobeLineDrawer } from "./globe/GlobeDrawing.jsx";
import { GlobeImage, GlobeRegionTile } from "./globe/GlobeImage.jsx";
import { useCesiumGlobe } from "./globe/useCesiumGlobe.js";
import { usePlaceNames } from "./globe/usePlaceNames.js";
import { useShapes } from "./globe/useGlobeShapes.js";

// What a pick returns for the app's own markers and named lines (not place names or images).
const isItem = (id) => Boolean(id?.kind) || typeof id?.label === "string";

/** The marker or named line at `position`, looking under a place name that covers it. */
function itemAt(scene, position) {
  const top = scene.pick(position);
  if (!top) return null;
  if (isItem(top.id)) return top.id;
  return scene.drillPick(position, 4).map((p) => p.id).find(isItem) ?? null;
}

const prefersReducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Clicks and hovering: a marker opens its place, anywhere else on the Earth
 * is a map click (not while drawing); hovering a marker or a labelled line
 * names it.
 */
function useGlobePointer(scene, { drawing, onSelectSite, onSelectPlace, onMapClick }) {
  const [tip, setTip] = useState(null);
  const drawingRef = useRef(drawing);
  useEffect(() => {
    drawingRef.current = drawing;
  });
  const click = useStableCallback((e) => {
    if (drawingRef.current) return;
    const item = itemAt(scene, e.position);
    if (item?.kind === "site") onSelectSite?.(item.ref);
    else if (item?.kind === "place") onSelectPlace?.(item.ref);
    else {
      const ll = lonLatAt(scene, e.position);
      if (ll) onMapClick?.({ latitude: ll[1], longitude: ll[0] });
    }
  });
  useEffect(() => {
    if (!scene) return undefined;
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction(click, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((e) => {
      const item = itemAt(scene, e.endPosition);
      const label = typeof item?.label === "string" ? item.label : null;
      if (!drawingRef.current) scene.canvas.style.cursor = item?.kind ? "pointer" : "";
      setTip(label ? { label, x: e.endPosition.x, y: e.endPosition.y } : null);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    return () => handler.destroy();
  }, [scene, click]);
  return tip;
}

/** Flies the camera to a box (no closer than the 2D map would zoom, clear of the evidence card). */
function flyToBox(scene, box, { maxZoom, card }) {
  const width = scene.canvas.clientWidth || 1;
  const covered = card?.offsetParent ? card.offsetWidth / width : 0;
  const [w, s, e, n] = cameraBox(box.split(",").map(Number), { minSpan: spanAtZoom(maxZoom, width), covered });
  scene.camera.flyTo({ destination: Rectangle.fromDegrees(w, s, e, n), duration: prefersReducedMotion() ? 0 : 2.5 });
}

/** Flies the camera back out to the whole Earth, north up. */
function flyHome(scene) {
  scene.camera.flyTo({
    destination: Cartesian3.fromDegrees(GLOBE_HOME.lon, GLOBE_HOME.lat, GLOBE_HOME.height),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
    duration: prefersReducedMotion() ? 0 : 2,
  });
}

/** Flies to the selection (again when `fitKey` changes); back to the whole Earth when `homeKey` changes. */
function useGlobeCamera(scene, { focusBbox, focusMaxZoom, fitKey, homeKey, obstructionRef }) {
  const box = focusBbox ? focusBbox.join(",") : "";
  useEffect(() => {
    if (scene && box) flyToBox(scene, box, { maxZoom: focusMaxZoom, card: obstructionRef?.current });
  }, [scene, box, fitKey, focusMaxZoom, obstructionRef]);
  const shownHome = useRef(homeKey);
  useEffect(() => {
    if (!scene || shownHome.current === homeKey) return;
    shownHome.current = homeKey;
    flyHome(scene);
  }, [scene, homeKey]);
}

/** The NISAR images: the selection's pass (or change map), the catalog's tiles, and the hatched gaps. */
function GlobeImages({ globe, sceneOverlay, regionLayers, footprintOverlay }) {
  const regionOpacity = regionLayers?.opacity ?? 0.85;
  return (
    <>
      {sceneOverlay && <GlobeImage globe={globe} url={sceneOverlay.url} bbox={sceneOverlay.bbox} opacity={sceneOverlay.opacity ?? 1} />}
      {regionLayers?.tiles?.map((tile) => <GlobeRegionTile key={tile.key} globe={globe} tile={tile} opacity={regionOpacity} />)}
      {footprintOverlay && <GlobeImage globe={globe} url={footprintOverlay.url} bbox={footprintOverlay.bbox} />}
    </>
  );
}

/**
 * The 3D globe (CesiumJS), Google Earth-style: the Earth among the stars,
 * which you can spin any way, tilt to the horizon and zoom down to a flat
 * view. It shows the same places, selection, NISAR images and outlines as
 * the 2D map (ChangeMap.jsx), and areas and lines can be drawn on it.
 */
export default function GlobeMap({
  sites = [],
  changeTypes = [],
  places = [],
  focusBbox = null,
  focusObstructionRef = null,
  sceneOverlay = null,
  footprintOverlay = null,
  referencePoint = null,
  regionLayers = null,
  studyLayers = null,
  showFocusOutline = true,
  focusMaxZoom = 11,
  fitKey = 0,
  homeKey = 0,
  drawing = null,
  drawHost = null,
  onDrawArea,
  onDrawLine,
  onCancelDraw,
  onSelectSite,
  onSelectPlace,
  onMapClick,
  onUnavailable,
}) {
  const container = useRef(null);
  const globe = useCesiumGlobe(container, onUnavailable);
  const scene = globe?.widget.scene ?? null;
  const [namesShown, setNamesShown] = useState(true);
  usePlaceNames(scene, namesShown);
  const colorOf = Object.fromEntries(changeTypes.map((ct) => [ct.id, ct.color]));
  const overlay = overlayShapes({ outlines: regionLayers?.outlines, lines: studyLayers?.lines, points: studyLayers?.points, referencePoint });
  const points = [...overlay.points, ...markersOf({ sites, places, colorOf })];
  const lines = [...(showFocusOutline ? focusLines(focusBbox) : []), ...overlay.lines];
  useShapes(scene, points, lines);
  const tip = useGlobePointer(scene, { drawing, onSelectSite, onSelectPlace, onMapClick });
  useGlobeCamera(scene, { focusBbox, focusMaxZoom, fitKey, homeKey, obstructionRef: focusObstructionRef });
  return (
    <div className="map globe-map" data-testid="globe">
      <div ref={container} className="globe-canvas" />
      {!globe && <div className="map-loading" aria-hidden="true">Loading the globe…</div>}
      {globe && (
        <>
          <GlobeImages globe={globe} sceneOverlay={sceneOverlay} regionLayers={regionLayers} footprintOverlay={footprintOverlay} />
          <GlobeControls scene={scene} reducedMotion={prefersReducedMotion()} namesShown={namesShown} onToggleNames={() => setNamesShown((v) => !v)} />
          {drawing === "area" && <GlobeAreaDrawer scene={scene} onDraw={onDrawArea} onCancel={onCancelDraw} host={drawHost} />}
          {drawing === "line" && <GlobeLineDrawer scene={scene} onDraw={onDrawLine} onCancel={onCancelDraw} host={drawHost} />}
        </>
      )}
      {tip && (
        <div className="globe-tooltip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          {tip.label}
        </div>
      )}
    </div>
  );
}
