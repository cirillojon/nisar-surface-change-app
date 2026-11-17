import { useEffect, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidalOccluder,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  Matrix4,
  PointPrimitiveCollection,
  PolylineCollection,
  VerticalOrigin,
} from "cesium";

import { LABEL_STYLE, declutter, labelFont, placeList, zoomAtDistance } from "../../services/globeLabels.js";

const BLACK = Color.fromCssColorString("#05080f");
const BORDER = Color.fromCssColorString("#ffe08a").withAlpha(0.55);
const ON_TOP = Number.POSITIVE_INFINITY;

/** Country borders on land, as thin lines on the ground. */
function addBorders(scene, borders) {
  const lines = scene.primitives.add(new PolylineCollection());
  for (const coords of borders) {
    // Its own material each: a collection destroys every line's material with it.
    const material = Material.fromType("Color", { color: BORDER });
    lines.add({ positions: Cartesian3.fromDegreesArray(coords.flat()), width: 1.2, material });
  }
  return lines;
}

/**
 * Upright place names (and borders) on the globe, from Natural Earth
 * (places.json, built by scripts/build_globe_places.py). After each frame
 * in which the view moved it works out which names are near enough, on the
 * near side of the Earth and on screen, lets the important ones claim space
 * first, and shows those. Names are made the first time they are shown.
 */
function createPlaceNames(scene, data) {
  const places = placeList(data.places).map((p) => ({ ...p, position: Cartesian3.fromDegrees(p.lon, p.lat) }));
  const borders = addBorders(scene, data.borders);
  const labels = scene.primitives.add(new LabelCollection({ scene }));
  const dots = scene.primitives.add(new PointPrimitiveCollection());
  // Under the app's own markers and outlines.
  for (const c of [dots, labels, borders]) scene.primitives.lowerToBottom(c);
  const byId = new Map(places.map((p) => [p.id, p]));
  const made = new Map();
  const occluder = new EllipsoidalOccluder(scene.globe.ellipsoid, scene.camera.positionWC);
  const onScreen = new Cartesian2();
  let lastView = null;
  let lastSize = "";

  const make = (place) => {
    const style = LABEL_STYLE[place.kind];
    const label = labels.add({
      position: place.position,
      text: place.name,
      font: labelFont(place.kind),
      fillColor: Color.fromCssColorString(style.color),
      outlineColor: BLACK,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: style.dot ? HorizontalOrigin.LEFT : HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(style.dot ? 8 : 0, 0),
      disableDepthTestDistance: ON_TOP,
    });
    const dot = style.dot
      ? dots.add({ position: place.position, pixelSize: 5, color: Color.WHITE, outlineColor: BLACK, outlineWidth: 1, disableDepthTestDistance: ON_TOP })
      : null;
    return { label, dot };
  };

  const update = () => {
    const camera = scene.camera;
    const width = scene.canvas.clientWidth;
    const height = scene.canvas.clientHeight;
    const size = `${width}x${height}`;
    if (lastView && size === lastSize && Matrix4.equalsEpsilon(camera.viewMatrix, lastView, 1e-9)) return;
    lastView = Matrix4.clone(camera.viewMatrix, lastView ?? undefined);
    lastSize = size;
    occluder.cameraPosition = camera.positionWC;
    const fov = camera.frustum.fov ?? Math.PI / 3;
    const candidates = [];
    for (const place of places) {
      const distance = Cartesian3.distance(camera.positionWC, place.position);
      if (zoomAtDistance(distance, width, fov) < place.minZoom) continue;
      if (!occluder.isPointVisible(place.position)) continue;
      const xy = scene.cartesianToCanvasCoordinates(place.position, onScreen);
      if (!xy || xy.x < 0 || xy.y < 0 || xy.x > width || xy.y > height) continue;
      candidates.push({ place, x: xy.x, y: xy.y });
    }
    const shown = declutter(candidates);
    let changed = false;
    for (const id of shown) {
      if (!made.has(id)) {
        made.set(id, make(byId.get(id)));
        changed = true;
      }
    }
    for (const [id, item] of made) {
      const show = shown.has(id);
      if (item.label.show === show) continue;
      item.label.show = show;
      if (item.dot) item.dot.show = show;
      changed = true;
    }
    if (changed) scene.requestRender();
  };

  const stop = scene.postRender.addEventListener(update);
  scene.requestRender();
  return () => {
    stop();
    if (scene.isDestroyed()) return;
    for (const c of [labels, dots, borders]) scene.primitives.remove(c);
    scene.requestRender();
  };
}

/** Shows Natural Earth's place names and borders on the globe while `shown` (the data loads with the globe). */
export function usePlaceNames(scene, shown) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    import("./places.json")
      .then((m) => {
        if (live) setData(m.default);
      })
      // Without the names (a failed download) the globe works as before.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!scene || !data || !shown) return undefined;
    return createPlaceNames(scene, data);
  }, [scene, data, shown]);
}
