import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  CircleMarker,
  ImageOverlay,
  LayersControl,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Rectangle,
  SVGOverlay,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { MAX_LINE_KM, addPoint, canFinish, lineKm, lineStatus } from "../services/drawing.js";
import DrawBar, { LineBarButtons } from "./DrawBar.jsx";
import { LABELS_URL } from "../services/globe.js";
import { loadImage } from "../services/imageCache.js";
import { splitAtAntimeridian } from "../services/orbit.js";
import { mercY, normalizeBbox } from "../services/regions.js";
import { useStableCallback } from "../services/useStableCallback.js";

const DEFAULT_CENTER = [20, 0];
const DEFAULT_ZOOM = 2;
// A phone-width map shows only part of the world at zoom 2, and with it
// only a few of the places: zoom out one more step there.
const worldZoom = (width) => (width < 700 ? DEFAULT_ZOOM - 1 : DEFAULT_ZOOM);
// Drags shorter than this (screen pixels) don't make a rectangle.
const MIN_DRAW_PX = 8;
// Color of the before & after places' markers (see .dot-gallery).
const GALLERY_COLOR = "#f59e0b";
const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Two days back: the most recent day GIBS has imaged completely.
const GIBS_DATE = new Date(Date.now() - 2 * 86400000)
  .toISOString()
  .slice(0, 10);
// NOAA-20, not Suomi NPP: GIBS stopped updating the SNPP layer in Nov 2026.
const GIBS_LAYER = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";

const toBounds = ([minLon, minLat, maxLon, maxLat]) => [
  [minLat, minLon],
  [maxLat, maxLon],
];

// Map clicks are ignored while drawing and briefly after: the click that
// ends a drag would otherwise replace the drawn area with a click search.
const CLICK_GRACE_MS = 400;

function ClickHandler({ onMapClick, drawingRef }) {
  useMapEvents({
    click: (e) => {
      if (performance.now() < drawingRef.current) return;
      onMapClick({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
  });
  return null;
}

function FitTo({ bbox, maxZoom = 11, refitKey = 0, obstructionRef }) {
  const map = useMap();
  const [minLon, minLat, maxLon, maxLat] = bbox ?? [];
  useEffect(() => {
    if (minLon === undefined) return;
    const bounds = toBounds([minLon, minLat, maxLon, maxLat]);
    map.invalidateSize({ animate: false });

    const padding = { maxZoom };
    // Reserve the card's layout space only when fitting a new selection.
    // Opening or closing the card leaves the camera where the viewer put it.
    const obstruction = obstructionRef?.current;
    if (obstruction && !obstruction.hidden && obstruction.dataset.tourActive !== "true") {
      const mapRect = map.getContainer().getBoundingClientRect();
      const cardRect = obstruction.getBoundingClientRect();
      const anchor = getComputedStyle(obstruction).getPropertyValue("--evidence-anchor").trim();
      if (anchor === "bottom") {
        padding.paddingTopLeft = [16, 54];
        padding.paddingBottomRight = [16, Math.round(mapRect.bottom - cardRect.top) + 12];
      } else {
        padding.paddingTopLeft = [48, 48];
        padding.paddingBottomRight = [Math.round(mapRect.right - cardRect.left) + 12, 20];
      }
    }
    if (prefersReducedMotion()) {
      map.fitBounds(bounds, { ...padding, animate: false });
    } else {
      map.flyToBounds(bounds, { ...padding, duration: 0.4 });
    }
  }, [map, minLon, minLat, maxLon, maxLat, maxZoom, refitKey, obstructionRef]);
  return null;
}

/** Sends the map back to the whole world each time `homeKey` changes. */
function HomeView({ homeKey }) {
  const map = useMap();
  const last = useRef(homeKey);
  useEffect(() => {
    if (last.current === homeKey) return;
    last.current = homeKey;
    const zoom = worldZoom(map.getSize().x);
    if (prefersReducedMotion()) map.setView(DEFAULT_CENTER, zoom, { animate: false });
    else map.flyTo(DEFAULT_CENTER, zoom, { duration: 0.4 });
  }, [map, homeKey]);
  return null;
}

// Guided-tour drawings: a pulsing pin, and the box / line to trace.
const tourIcon = (className, html, size) =>
  L.divIcon({ className, html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
// A numbered badge; the one to start from pulses.
const badge = (label, start = false) =>
  tourIcon(`tour-corner${start ? " tour-corner-start" : ""}`, `<span>${label}</span>`, [28, 28]);
const PIN_ICON = L.divIcon({
  className: "tour-pin",
  html: '<span class="tour-pin-pulse"></span><span class="tour-pin-head"></span>',
  iconSize: [36, 48],
  iconAnchor: [18, 44],
});

function TourMarks({ marks }) {
  if (!marks) return null;
  const { pin, box, line } = marks;
  return (
    <>
      {box && (
        <Rectangle
          bounds={toBounds(box)}
          pathOptions={{ color: "#ffd34d", weight: 3, dashArray: "10 8", fillOpacity: 0.08, className: "tour-ghost" }}
          interactive={false}
        />
      )}
      {box && (
        <>
          <Marker position={[box[3], box[0]]} icon={badge("1", true)} interactive={false} />
          <Marker position={[box[1], box[2]]} icon={badge("2")} interactive={false} />
        </>
      )}
      {line && (
        <>
          <Polyline
            positions={line.map(([lon, lat]) => [lat, lon])}
            pathOptions={{ color: "#ffd34d", weight: 4, dashArray: "10 8", className: "tour-ghost" }}
            interactive={false}
          />
          <Marker position={[line[0][1], line[0][0]]} icon={badge("A", true)} interactive={false} />
          <Marker
            position={[line[line.length - 1][1], line[line.length - 1][0]]}
            icon={badge("B")}
            interactive={false}
          />
        </>
      )}
      {pin && (
        <Marker position={[pin.lat, pin.lon]} icon={PIN_ICON} interactive={false} title={pin.label} />
      )}
    </>
  );
}

const LOCKABLE = ["dragging", "scrollWheelZoom", "doubleClickZoom", "touchZoom", "boxZoom", "keyboard"];

/**
 * While `locked` (the guided tour), the user can't pan or zoom the map, so
 * a stray drag doesn't lose the place the tour is showing. `drawing` re-runs
 * the lock after a drawer re-enables the handlers it borrowed.
 */
function MapLock({ locked, drawing }) {
  const map = useMap();
  useEffect(() => {
    if (!locked) return undefined;
    const container = map.getContainer();
    LOCKABLE.forEach((name) => map[name]?.disable());
    container.classList.add("map-locked");
    return () => {
      LOCKABLE.forEach((name) => map[name]?.enable());
      container.classList.remove("map-locked");
    };
  }, [map, locked, drawing]);
  return null;
}

/**
 * `value`, but only once every image in `urls` has loaded: until then the
 * last ready value stays on the map, so a frame never blinks out while the
 * next one downloads. `key` says when `value` really changed.
 */
function useWhenLoaded(value, urls, key) {
  const [shown, setShown] = useState(value);
  // What to show once loaded: the value and images of the latest render.
  const latest = useRef({ value, urls });
  useLayoutEffect(() => {
    latest.current = { value, urls };
  });
  useEffect(() => {
    let canceled = false;
    const { value: wanted, urls: needed } = latest.current;
    Promise.all(needed.map(loadImage)).then(() => {
      if (!canceled) setShown(wanted);
    });
    return () => {
      canceled = true;
    };
  }, [key]);
  return shown;
}

// How long a new map frame fades in over the one before it (see index.css).
const FRAME_FADE_MS = 200;

/**
 * Stacks the frames `value` takes (each named by `id`) so the previous one
 * stays on the map until the newest has painted on top of it; a time-lapse
 * then never blinks between frames. Returns [frames, onPainted]: draw
 * `frames` in order (newest last) and call onPainted(id, value) once a frame
 * is drawn. The frames behind are those painted before (at most two), with
 * what they showed; mount the stack only while there is something to show,
 * so clearing the map starts it afresh.
 */
function useFrameStack(value, id) {
  const [painted, setPainted] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  // Only the newest frame's paint counts: an older frame behind it can fire
  // its load event again, and mustn't come back on top.
  const newest = useRef(id);
  useLayoutEffect(() => {
    newest.current = id;
  });
  const onPainted = useCallback((done, shown) => {
    if (done !== newest.current) return;
    setPainted((ps) => [...ps.filter((f) => f.id !== done).slice(-2), { id: done, value: shown }]);
    // Older frames go once the new one has fully faded in.
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setPainted((ps) => {
        const i = ps.findIndex((f) => f.id === done);
        return i > 0 ? ps.slice(i) : ps;
      });
    }, FRAME_FADE_MS);
    timers.current.add(timer);
  }, []);
  const behind = painted.filter((f) => f.id !== id).slice(-2).map((f) => ({ ...f, painted: true }));
  const current = { id, value, painted: painted.some((f) => f.id === id) };
  return [[...behind, current], onPainted];
}

/** Calls `done` once `el` (an image) is decoded and on screen. */
function whenPainted(el, done) {
  const decoded = el?.decode ? el.decode().catch(() => {}) : Promise.resolve();
  decoded.then(() => requestAnimationFrame(() => done()));
}

/** Sets the opacity of the map pane named `pane`. */
function PaneOpacity({ pane, value }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getPane(pane);
    if (el) el.style.opacity = String(value);
  }, [map, pane, value]);
  return null;
}

/** One frame of the scene image; fades in over the last once it's painted. */
function OverlayFrame({ url, bounds, onPainted }) {
  const painted = useStableCallback(onPainted);
  // Leaflet keeps the handlers it was given, so they never change.
  const [eventHandlers] = useState(() => ({
    load: (e) => {
      const el = e.target.getElement();
      whenPainted(el, () => {
        el?.classList.add("is-painted");
        painted();
      });
    },
    error: (e) => {
      e.target.getElement()?.classList.add("is-painted");
      painted();
    },
  }));
  return <ImageOverlay url={url} bounds={bounds} className="scene-frame" eventHandlers={eventHandlers} />;
}

/** One frame of region tiles; counts as painted once all its images are. */
function RegionFrame({ tiles, painted, onPainted }) {
  const [pending] = useState(() => new Set(tiles.map((t) => t.key)));
  const reported = useRef(false);
  const report = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    onPainted();
  }, [onPainted]);
  useEffect(() => {
    if (!tiles.length) report();
  }, [tiles.length, report]);
  const onTileLoad = (key, el) => {
    if (!pending.delete(key) || pending.size) return;
    whenPainted(el, report);
  };
  return tiles.map((tile) => (
    <ClippedImage
      key={tile.key}
      tile={tile}
      painted={painted}
      onLoad={(el) => onTileLoad(tile.key, el)}
    />
  ));
}

/** The scene image's frames, stacked so a time-lapse never blinks. */
function SceneFrames({ overlay }) {
  const [frames, onPainted] = useFrameStack(overlay, JSON.stringify([overlay.url, overlay.bbox]));
  return frames.map((f) => (
    <OverlayFrame key={f.id} url={f.value.url} bounds={toBounds(f.value.bbox)} onPainted={() => onPainted(f.id, f.value)} />
  ));
}

/** The data explorer's tiles, a frame per set, stacked the same way. */
function RegionFrames({ region }) {
  const [frames, onPainted] = useFrameStack(region, JSON.stringify(region.tiles.map((t) => [t.key, t.url, t.bounds])));
  return frames.map((f) => (
    <RegionFrame key={f.id} tiles={f.value.tiles} painted={f.painted} onPainted={() => onPainted(f.id, f.value)} />
  ));
}

function KeepMapSized() {
  const map = useMap();
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() =>
      map.invalidateSize({ animate: false, pan: true, debounceMoveend: true })
    );
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// Leaflet renders these three controls outside React.
const mapControlIcon = (path) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const zoomInIcon = mapControlIcon("M5 12h14M12 5v14");
const zoomOutIcon = mapControlIcon("M5 12h14");
const resetViewIcon = mapControlIcon("m3 11 9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6");

function ResetViewControl() {
  const map = useMap();
  useEffect(() => {
    const control = L.control({ position: "topleft" });
    control.onAdd = () => {
      const bar = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const btn = L.DomUtil.create("button", "map-btn", bar);
      btn.type = "button";
      btn.title = "Reset map view";
      btn.setAttribute("aria-label", "Reset map view");
      btn.dataset.tour = "reset-view";
      btn.innerHTML = resetViewIcon;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(btn, "click", () => {
        map.setView(DEFAULT_CENTER, worldZoom(map.getSize().x), { animate: false });
      });
      return bar;
    };
    control.addTo(map);
    return () => control.remove();
  }, [map]);
  return null;
}

/**
 * While `active`, dragging on the map draws a rectangle instead of
 * panning. Pointer events, so mouse, pen and touch all work.
 */
function RectangleDrawer({ active, drawingRef, onDraw, onCancel, host }) {
  const map = useMap();
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    // "Ignore map clicks until" timestamp, read by ClickHandler.
    drawingRef.current = Infinity;
    const container = map.getContainer();
    container.classList.add("map-drawing");
    map.dragging.disable();
    map.boxZoom.disable();
    map.doubleClickZoom.disable();
    let start = null;

    const latLng = (e) => map.mouseEventToLatLng(e);
    const down = (e) => {
      if (start || (e.button !== 0 && e.pointerType === "mouse")) return;
      if (e.target.closest?.(".leaflet-control")) return;
      start = {
        pointerId: e.pointerId,
        latlng: latLng(e),
        point: L.point(e.clientX, e.clientY),
      };
      container.setPointerCapture?.(e.pointerId);
      setDraft(L.latLngBounds(start.latlng, start.latlng));
      e.preventDefault();
    };
    const move = (e) => {
      if (start?.pointerId !== e.pointerId) return;
      setDraft(L.latLngBounds(start.latlng, latLng(e)));
    };
    const up = (e) => {
      if (start?.pointerId !== e.pointerId) return;
      const end = latLng(e);
      const dragged = start.point.distanceTo(L.point(e.clientX, e.clientY));
      const from = start.latlng;
      start = null;
      setDraft(null);
      if (dragged < MIN_DRAW_PX) return;
      const bbox = normalizeBbox([from.lng, from.lat, end.lng, end.lat]);
      if (bbox[0] < bbox[2] && bbox[1] < bbox[3]) onDraw(bbox);
    };
    const cancel = (e) => {
      if (start?.pointerId !== e.pointerId) return;
      start = null;
      setDraft(null);
    };
    const key = (e) => {
      if (e.key === "Escape") onCancel();
    };

    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", up);
    container.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", up);
      container.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      container.classList.remove("map-drawing");
      map.dragging.enable();
      map.boxZoom.enable();
      map.doubleClickZoom.enable();
      setDraft(null);
      drawingRef.current = performance.now() + CLICK_GRACE_MS;
    };
  }, [active, map, drawingRef, onDraw, onCancel]);

  return (
    <>
      {active && (
        <DrawBar host={host} status="Drag on the map to draw a box.">
          <button type="button" className="btn btn-small btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </DrawBar>
      )}
      {draft && (
        <Rectangle
          bounds={draft}
          pathOptions={{ color: "#facc15", weight: 2, dashArray: "6 4" }}
          interactive={false}
        />
      )}
    </>
  );
}

/** Leaflet [lat, lng] points → [lon, lat], shifted back from a world copy as one piece. */
function toLonLat(latlngs) {
  const shift = (((latlngs[0][1] + 180) % 360) + 360) % 360 - 180 - latlngs[0][1];
  return latlngs.map(([lat, lng]) => [
    Math.round((lng + shift) * 1e5) / 1e5,
    Math.round(lat * 1e5) / 1e5,
  ]);
}

/**
 * While `active`, clicks (or taps) add points to a line. The bar over the
 * map says what to do and has Undo, Finish line and Cancel; double-click
 * or Enter also finish, Backspace removes the last point, Escape cancels.
 * The rules are in services/drawing.js: a line needs two points and at
 * most MAX_LINE_KM, and until then it can't be finished and drawing
 * carries on; a click on the last point adds nothing, so a double-click
 * ends the line where it is without a repeated point.
 * A click that makes `finishWhen(points)` true also finishes (the tour's
 * suggested line). `hint` replaces the bar's text.
 */
function LineDrawer({ active, drawingRef, onDraw, onCancel, finishWhen, hint, host }) {
  const map = useMap();
  const [points, setPoints] = useState([]);
  const [cursor, setCursor] = useState(null);
  const pointsRef = useRef(points);
  const finishWhenRef = useRef(finishWhen);
  useEffect(() => {
    finishWhenRef.current = finishWhen;
  });
  const update = useCallback((next) => {
    pointsRef.current = next;
    setPoints(next);
  }, []);
  const finish = useCallback(() => {
    const pts = pointsRef.current;
    if (canFinish(pts)) onDraw(pts);
  }, [onDraw]);
  const undo = useCallback(() => update(pointsRef.current.slice(0, -1)), [update]);

  useEffect(() => {
    if (!active) return undefined;
    drawingRef.current = Infinity;
    const container = map.getContainer();
    container.classList.add("map-drawing");
    map.doubleClickZoom.disable();
    const key = (e) => {
      if (e.key === "Escape") onCancel();
      // A focused button or field handles its own Enter and Backspace.
      if (e.target instanceof Element && e.target.closest("button, a[href], input, select, textarea")) return;
      if (e.key === "Enter") finish();
      if (e.key === "Backspace") undo();
    };
    const click = (e) => {
      const pts = pointsRef.current;
      const last = pts[pts.length - 1];
      const px = last ? map.latLngToContainerPoint(last).distanceTo(e.containerPoint) : Infinity;
      const next = addPoint(pts, [e.latlng.lat, e.latlng.lng], px);
      if (next === pts) return;
      update(next);
      if (finishWhenRef.current?.(next)) onDraw(next);
    };
    const move = (e) => setCursor([e.latlng.lat, e.latlng.lng]);
    const leave = () => setCursor(null);
    map.on("click", click);
    map.on("mousemove", move);
    map.on("mouseout", leave);
    map.on("dblclick", finish);
    window.addEventListener("keydown", key);
    return () => {
      map.off("click", click);
      map.off("mousemove", move);
      map.off("mouseout", leave);
      map.off("dblclick", finish);
      window.removeEventListener("keydown", key);
      container.classList.remove("map-drawing");
      map.doubleClickZoom.enable();
      update([]);
      setCursor(null);
      drawingRef.current = performance.now() + CLICK_GRACE_MS;
    };
  }, [active, map, drawingRef, onDraw, onCancel, finish, undo, update]);

  if (!active) return null;
  const preview = cursor && points.length ? [...points, cursor] : points;
  const previewKm = lineKm(preview);
  const status = lineStatus(points, hint);
  return (
    <>
      <DrawBar host={host} status={status.text} warning={status.warning}>
        <LineBarButtons points={points} canFinishLine={canFinish(points)} onUndo={undo} onFinish={finish} onCancel={onCancel} />
      </DrawBar>
      {points.length > 0 && (
        <Polyline
          positions={preview}
          pathOptions={{ color: previewKm > MAX_LINE_KM ? "#ef4444" : "#facc15", weight: 3, dashArray: "6 4" }}
          interactive={false}
        />
      )}
      {pointKeys(points).map(({ p, key }) => (
        <CircleMarker
          key={key}
          center={p}
          radius={4}
          pathOptions={{ color: "#0b1220", weight: 1, fillColor: "#facc15", fillOpacity: 1 }}
          interactive={false}
        />
      ))}
      {cursor && points.length > 0 && (
        <CircleMarker center={cursor} radius={0.1} pathOptions={{ opacity: 0 }} interactive={false}>
          <Tooltip permanent direction="right" offset={[10, 0]}>
            {previewKm.toFixed(1)} km{previewKm > MAX_LINE_KM ? ` (max ${MAX_LINE_KM})` : ""}
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

/** The line's points with keys from their position on the map (a point visited twice gets a count). */
function pointKeys(points) {
  const seen = new Map();
  return points.map((p) => {
    const at = `${p.lat},${p.lng}`;
    const n = seen.get(at) ?? 0;
    seen.set(at, n + 1);
    return { p, key: n ? `${at}#${n}` : at };
  });
}

// Narrower than this on screen (pixels), a selected place's image is too
// small to see, so its marker is drawn after all.
const TINY_PX = 40;

/**
 * Markers for every place with data: study sites in their change type's
 * color, before & after places in the gallery's. The selected place is
 * shown by its image and outline rather than a dot over it, except when
 * the map is zoomed so far out that the image can't be seen.
 */
function PlaceMarkers({ sites, places, selectedSiteId, selectedPlace, selectedBbox, colorOf, onSelectSite, onSelectPlace }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const tiny =
    !selectedBbox ||
    Math.abs(
      map.project([selectedBbox[1], selectedBbox[2]], zoom).x - map.project([selectedBbox[1], selectedBbox[0]], zoom).x,
    ) < TINY_PX;
  const marker = (key, lat, lon, color, radius, label, onClick) => (
    <CircleMarker
      key={key}
      center={[lat, lon]}
      radius={radius}
      pathOptions={{ color: "#0b1220", weight: 2, fillColor: color, fillOpacity: 0.95 }}
      eventHandlers={{ click: onClick }}
      bubblingMouseEvents={false}
    >
      <Tooltip>{label}</Tooltip>
    </CircleMarker>
  );
  return (
    <>
      {places
        .filter((p) => tiny || p.slug !== selectedPlace)
        .map((p) => marker(p.slug, p.lat, p.lon, GALLERY_COLOR, 6, `${p.name} · before & after`, () => onSelectPlace?.(p.slug)))}
      {sites
        .filter((s) => tiny || s.id !== selectedSiteId)
        .map((s) =>
          marker(s.id, s.latitude, s.longitude, colorOf[s.change_type] ?? "#38bdf8", 7, s.name, () => onSelectSite(s.id)))}
    </>
  );
}

/** SVG path of a MultiPolygon in the overlay's (lon, -mercator y) space. */
const clipPathData = (multi) =>
  multi
    .flatMap((polygon) =>
      polygon.map(
        (ring) =>
          "M" +
          ring.map(([lon, lat]) => `${lon},${-mercY(lat)}`).join("L") +
          "Z",
      ),
    )
    .join("");

/**
 * An image stretched over `bounds` and clipped to `clip` (a MultiPolygon),
 * so opaque margins of browse images never hide other data.
 */
function ClippedImage({ tile, painted, onLoad }) {
  const [minLon, minLat, maxLon, maxLat] = tile.bounds;
  const x = minLon;
  const y = -mercY(maxLat);
  const w = maxLon - minLon;
  const h = mercY(maxLat) - mercY(minLat);
  // Unique per instance: the same tile can be on two stacked frames.
  const id = `clip-${useId().replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    <SVGOverlay
      key={`${tile.url}|${tile.bounds.join(",")}`}
      bounds={toBounds(tile.bounds)}
      attributes={{ viewBox: `${x} ${y} ${w} ${h}`, preserveAspectRatio: "none" }}
    >
      <defs>
        <clipPath id={id}>
          <path d={clipPathData(tile.clip)} clipRule="evenodd" />
        </clipPath>
      </defs>
      <image
        href={tile.url}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="none"
        clipPath={`url(#${id})`}
        className={painted ? "scene-frame is-painted" : "scene-frame"}
        // React does attach load/error listeners to SVG <image>.
        // eslint-disable-next-line react/no-unknown-property
        onLoad={(e) => onLoad(e.currentTarget)}
        // eslint-disable-next-line react/no-unknown-property
        onError={(e) => onLoad(e.currentTarget)}
      />
    </SVGOverlay>
  );
}

/**
 * The scene image and the explorer's tiles that are ready to show (the last
 * ready ones stay while the next download), and whether the scene image
 * asked for is still on its way.
 */
function useShownLayers(sceneOverlay, regionLayers) {
  const overlayKey = sceneOverlay ? JSON.stringify([sceneOverlay.url, sceneOverlay.bbox, sceneOverlay.opacity]) : "";
  const shownOverlay = useWhenLoaded(sceneOverlay, sceneOverlay ? [sceneOverlay.url] : [], overlayKey);
  const tiles = regionLayers?.tiles ?? [];
  const regionKey = regionLayers
    ? JSON.stringify([tiles.map((t) => [t.key, t.url]), regionLayers.outlines?.map((o) => o.key), regionLayers.opacity])
    : "";
  const shownRegion = useWhenLoaded(regionLayers, tiles.map((t) => t.url), regionKey);
  // The image asked for isn't the one on the map yet: it is still downloading.
  const overlayPending = Boolean(sceneOverlay) && sceneOverlay.url !== shownOverlay?.url;
  return { shownOverlay, shownRegion, overlayPending };
}

/** Stable drawing callbacks (in [lon, lat]), so the drawers don't rebind their listeners mid-drag. */
function useDrawCallbacks(onDrawArea, onDrawLine, finishLineWhen) {
  const onDraw = useStableCallback((bbox) => onDrawArea?.(bbox));
  const onLine = useStableCallback((latlngs) => onDrawLine?.(toLonLat(latlngs)));
  const finishLine = useStableCallback((latlngs) => Boolean(finishLineWhen?.(toLonLat(latlngs))));
  return { onDraw, onLine, finishLine };
}

// Country, region and city names with borders (LABELS_URL): a transparent
// layer over the images, the same one the 3D globe shows.
const LABELS_PANE = "place-labels";

/** The labels' pane: over the NISAR images and outlines, under the markers, and never in the way of a click. */
function LabelsPane() {
  const map = useMap();
  if (!map.getPane(LABELS_PANE)) {
    const pane = map.createPane(LABELS_PANE);
    pane.style.zIndex = "455";
    pane.style.pointerEvents = "none";
  }
  return null;
}

function BaseLayers() {
  return (
    <LayersControl position="topleft">
      <LayersControl.BaseLayer checked name="Satellite (Esri)">
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, GIS User Community"
          maxZoom={18}
        />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Streets (OpenStreetMap)">
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" maxZoom={19} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name={`NASA GIBS true color (${GIBS_DATE})`}>
        <TileLayer
          url={`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`}
          attribution="Imagery: NASA GIBS / VIIRS (NOAA-20)"
          maxNativeZoom={9}
          maxZoom={12}
        />
      </LayersControl.BaseLayer>
      <LayersControl.Overlay checked name="Place names">
        <TileLayer url={LABELS_URL} pane={LABELS_PANE} attribution="Labels &copy; Esri" maxZoom={18} />
      </LayersControl.Overlay>
    </LayersControl>
  );
}

/** The scene image and the explorer's tiles. Opacity is set on the panes, so stacked frames blend as one image. */
function ImagePanes({ overlay, region }) {
  return (
    <>
      <Pane name="scene-frames" style={{ zIndex: 400 }}>
        <PaneOpacity pane="scene-frames" value={overlay?.opacity ?? 1} />
        {overlay && <SceneFrames overlay={overlay} />}
      </Pane>
      <Pane name="region-frames" style={{ zIndex: 400 }}>
        <PaneOpacity pane="region-frames" value={region?.opacity ?? 0.85} />
        {region?.tiles?.length > 0 && <RegionFrames region={region} />}
      </Pane>
    </>
  );
}

/** The part of a site's box some pass did not image, hatched. */
function FootprintPane({ footprint }) {
  if (!footprint) return null;
  return (
    <Pane name="footprint" style={{ zIndex: 420 }}>
      <ImageOverlay key={footprint.url} url={footprint.url} bounds={toBounds(footprint.bbox)} interactive className="footprint-overlay">
        <Tooltip sticky>{footprint.label}</Tooltip>
      </ImageOverlay>
    </Pane>
  );
}

/** Above the images, so boundaries stay visible: the selection's box, the explorer's footprints, the profile line. */
function OutlinePane({ focusBbox, showFocusOutline, outlines = [], lines = [] }) {
  return (
    <Pane name="outlines" style={{ zIndex: 450 }}>
      {focusBbox && showFocusOutline && (
        <Rectangle
          bounds={toBounds(focusBbox)}
          pathOptions={{ color: "#facc15", weight: 2, dashArray: "6 4", fill: false }}
          interactive={false}
        />
      )}
      {outlines.map((o) => (
        <Polygon
          key={o.key}
          positions={o.positions}
          pathOptions={{ color: o.color, weight: o.weight ?? 2, dashArray: o.dashed ? "4 4" : undefined, fillOpacity: 0 }}
          bubblingMouseEvents
        >
          {o.label && <Tooltip sticky>{o.label}</Tooltip>}
        </Polygon>
      ))}
      {lines.map((l) => (
        <Polyline key={l.key} positions={l.positions} pathOptions={{ color: l.color, weight: 3 }}>
          {l.label && <Tooltip sticky>{l.label}</Tooltip>}
        </Polyline>
      ))}
    </Pane>
  );
}

/** The global coverage heatmap (services/coverageMap.js), under the NISAR images, outlines and labels. */
function HeatmapPane({ heatmap }) {
  if (!heatmap) return null;
  return (
    <Pane name="coverage-heatmap" style={{ zIndex: 350 }}>
      <ImageOverlay url={heatmap.url} bounds={toBounds(heatmap.bbox)} opacity={heatmap.opacity ?? 0.8} className="heatmap-overlay" />
    </Pane>
  );
}

const SATELLITE_ICON = L.divIcon({
  className: "orbit-satellite",
  html: '<span class="orbit-satellite-ring"></span><span class="orbit-satellite-dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/** One [lon, lat] line, split where it crosses the antimeridian. */
function OrbitLine({ coords, pathOptions }) {
  return splitAtAntimeridian(coords).map((positions, i) => (
    <Polyline key={i} positions={positions} pathOptions={pathOptions} interactive={false} />
  ));
}

/** Keeps the map centered on the satellite while `follow` is on. */
function FollowSatellite({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lon], { animate: false });
  }, [map, lat, lon]);
  return null;
}

/** NISAR's computed path (OrbitPanel): last and next orbit, the swath's edges, and the satellite. */
function OrbitPane({ orbit }) {
  if (!orbit) return null;
  const { past, future, swathNear, swathFar, satellite } = orbit;
  const swath = { color: "#7dd3fc", weight: 1.5, dashArray: "3 5", opacity: 0.9 };
  return (
    <Pane name="orbit" style={{ zIndex: 458, pointerEvents: "none" }}>
      <OrbitLine coords={swathNear} pathOptions={swath} />
      <OrbitLine coords={swathFar} pathOptions={swath} />
      <OrbitLine coords={past} pathOptions={{ color: "#ffffff", weight: 2.5, opacity: 0.95 }} />
      <OrbitLine coords={future} pathOptions={{ color: "#ffffff", weight: 2, opacity: 0.7, dashArray: "6 6" }} />
      <Marker position={[satellite.lat, satellite.lon]} icon={SATELLITE_ICON} interactive={false} keyboard={false} />
      {orbit.follow && <FollowSatellite lat={satellite.lat} lon={satellite.lon} />}
    </Pane>
  );
}

/** Reports where the pointer is over the map ({ lat, lon }), or null when it leaves. */
function PointerTracker({ onPointerMove }) {
  useMapEvents({
    mousemove: (e) => onPointerMove({ lat: e.latlng.lat, lon: e.latlng.lng }),
    mouseout: () => onPointerMove(null),
  });
  return null;
}

/** Above everything, and clickable: the profile's ends, the InSAR reference point, and every place's marker. */
function SitesPane({ points = [], referencePoint, markers }) {
  return (
    <Pane name="sites" style={{ zIndex: 460 }}>
      {points.map((p) => (
        <CircleMarker
          key={p.key}
          center={[p.lat, p.lon]}
          radius={5}
          pathOptions={{ color: "#0b1220", weight: 1.5, fillColor: p.color, fillOpacity: 1 }}
          bubblingMouseEvents={false}
        >
          <Tooltip>{p.label}</Tooltip>
        </CircleMarker>
      ))}
      {referencePoint && (
        <CircleMarker
          center={[referencePoint[1], referencePoint[0]]}
          radius={5}
          pathOptions={{ color: "#0b1220", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}
          bubblingMouseEvents={false}
        >
          <Tooltip>Stable reference point for displacement</Tooltip>
        </CircleMarker>
      )}
      <PlaceMarkers {...markers} />
    </Pane>
  );
}

/**
 * World map: study sites and before & after places as markers, the
 * selected area, the selected place's NISAR image (and InSAR reference
 * point), plus region layers from the data explorer: clipped images and
 * outlined boundaries. Drawing an area or a line happens here too.
 */
export default function ChangeMap({
  sites,
  changeTypes,
  selectedSiteId,
  places = [], // before & after places: [{ slug, name, lat, lon }]
  selectedPlace = null,
  onSelectPlace,
  focusBbox,
  focusObstructionRef,
  sceneOverlay = null,
  referencePoint = null,
  regionLayers = null,
  studyLayers = null,
  showFocusOutline = true,
  focusMaxZoom = 11,
  tourMarks = null,
  // The part of a site's box some pass did not image, hatched: { url, bbox, label }.
  footprintOverlay = null,
  onSelectSite,
  onMapClick,
  onDrawArea,
  drawing,
  onCancelDraw,
  onDrawLine,
  finishLineWhen = null, // finish a line as soon as this is true of its [lon, lat] points
  locked = false, // no panning or zooming (the guided tour)
  drawHint = null, // replaces the drawing bar's text for a line
  drawHost = null, // element over the map where the drawing bar goes
  fitKey = 0, // change to fit `focusBbox` again, e.g. after the user moved the map
  homeKey = 0, // change to show the whole world again
  heatmap = null, // the global coverage heatmap: { url, bbox, opacity }
  orbit = null, // NISAR's computed path: { past, future, swathNear, swathFar, satellite }
  onPointerMove = null, // ({ lat, lon } | null) as the pointer moves over the map
}) {
  const drawingRef = useRef(0); // ignore map clicks until this time
  const { shownOverlay, shownRegion, overlayPending } = useShownLayers(sceneOverlay, regionLayers);
  const { onDraw, onLine, finishLine } = useDrawCallbacks(onDrawArea, onDrawLine, finishLineWhen);
  const colorOf = Object.fromEntries(changeTypes.map((ct) => [ct.id, ct.color]));
  const startZoom = worldZoom(typeof window === "undefined" ? 1024 : window.innerWidth);
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={startZoom} minZoom={startZoom} zoomControl={false} worldCopyJump className="map">
      <KeepMapSized />
      <ZoomControl position="topleft" zoomInText={zoomInIcon} zoomOutText={zoomOutIcon} />
      <ResetViewControl />
      <LabelsPane />
      <BaseLayers />
      <LineDrawer
        active={drawing === "line"}
        drawingRef={drawingRef}
        onDraw={onLine}
        onCancel={onCancelDraw}
        finishWhen={finishLine}
        hint={drawHint}
        host={drawHost}
      />
      <RectangleDrawer active={drawing === "area"} drawingRef={drawingRef} onDraw={onDraw} onCancel={onCancelDraw} host={drawHost} />
      {/* After the drawers, so its lock wins over handlers they re-enable. */}
      <MapLock locked={locked} drawing={drawing} />
      <ClickHandler onMapClick={onMapClick} drawingRef={drawingRef} />
      <FitTo bbox={focusBbox} refitKey={fitKey} maxZoom={focusMaxZoom} obstructionRef={focusObstructionRef} />
      <HomeView homeKey={homeKey} />
      <TourMarks marks={tourMarks} />
      {overlayPending && <div className="map-loading" aria-hidden="true">Loading image…</div>}
      <ImagePanes overlay={shownOverlay} region={shownRegion} />
      <HeatmapPane heatmap={heatmap} />
      {onPointerMove && <PointerTracker onPointerMove={onPointerMove} />}
      <FootprintPane footprint={footprintOverlay} />
      <OutlinePane focusBbox={focusBbox} showFocusOutline={showFocusOutline} outlines={shownRegion?.outlines} lines={studyLayers?.lines} />
      <OrbitPane orbit={orbit} />
      <SitesPane
        points={studyLayers?.points}
        referencePoint={referencePoint}
        markers={{ sites, places, selectedSiteId, selectedPlace, selectedBbox: focusBbox, colorOf, onSelectSite, onSelectPlace }}
      />
    </MapContainer>
  );
}
