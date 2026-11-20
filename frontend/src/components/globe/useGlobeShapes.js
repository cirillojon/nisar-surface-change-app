import { useEffect, useState } from "react";
import { Cartesian3, Color, Material, PointPrimitiveCollection, PolylineCollection } from "cesium";

import { densify } from "../../services/globe.js";

// Just above the ground, so the Earth hides what is on its far side but not what sits on it.
const LIFT_M = 60;
const OUTLINE = Color.fromCssColorString("#0b1220");

const at = (lon, lat) => Cartesian3.fromDegrees(lon, lat, LIFT_M);

/** A point and a line collection added to the scene for as long as the component lives. */
export function useCollections(scene) {
  const [collections, setCollections] = useState(null);
  useEffect(() => {
    if (!scene) return undefined;
    const points = scene.primitives.add(new PointPrimitiveCollection());
    const lines = scene.primitives.add(new PolylineCollection());
    setCollections({ points, lines });
    return () => {
      setCollections(null);
      if (scene.isDestroyed()) return;
      scene.primitives.remove(points);
      scene.primitives.remove(lines);
    };
  }, [scene]);
  return collections;
}

/** Replaces the points: `{lon, lat, color, size, label, kind?, ref?}`; the item itself is what a pick returns. */
export function setPoints(collection, items) {
  collection.removeAll();
  for (const item of items) {
    collection.add({
      position: at(item.lon, item.lat),
      pixelSize: item.size,
      color: Color.fromCssColorString(item.color),
      outlineColor: OUTLINE,
      outlineWidth: 2,
      id: item,
    });
  }
}

/** Replaces the lines: `{coords: [[lon, lat], ...], color, dashed?}`, following the surface. */
export function setLines(collection, items, width = 2.5) {
  collection.removeAll();
  for (const item of items) {
    if (item.coords.length < 2) continue;
    const color = Color.fromCssColorString(item.color);
    collection.add({
      positions: densify(item.coords).map(([lon, lat]) => at(lon, lat)),
      width,
      material: item.dashed ? Material.fromType("PolylineDash", { color, dashLength: 12 }) : Material.fromType("Color", { color }),
      id: item.label ? item : undefined,
    });
  }
}

/**
 * Keeps a collection pair showing `points` and `lines`, redrawn when their
 * contents change (compared as JSON, since callers build them each render).
 */
export function useShapes(scene, points, lines) {
  const collections = useCollections(scene);
  const pointsJson = JSON.stringify(points);
  const linesJson = JSON.stringify(lines);
  useEffect(() => {
    if (!collections) return;
    setPoints(collections.points, JSON.parse(pointsJson));
    setLines(collections.lines, JSON.parse(linesJson));
    scene.requestRender();
  }, [scene, collections, pointsJson, linesJson]);
}
