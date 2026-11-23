import { useEffect } from "react";
import { Cartesian3, Color, Material } from "cesium";

import { useCollections } from "./useGlobeShapes.js";

// Just above the ground, as for the other shapes on the globe.
const LIFT_M = 60;
const WHITE = Color.WHITE;
const SWATH = Color.fromCssColorString("#7dd3fc");

/** Points every `n`th of the way between neighbors (longitude unwrapped), so lines hug the surface. */
function densify(coords, n = 8) {
  if (coords.length < 2) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    let dx = x1 - x0;
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    for (let k = 1; k <= n; k += 1) out.push([x0 + (dx * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

const at = (coords, heightM) => densify(coords).map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, heightM));

function addLine(lines, positions, { color, width = 2, dashed = false, alpha = 1 }) {
  if (positions.length < 2) return;
  const c = color.withAlpha(alpha);
  lines.add({
    positions,
    width,
    material: dashed ? Material.fromType("PolylineDash", { color: c, dashLength: 14 }) : Material.fromType("Color", { color: c }),
  });
}

/**
 * NISAR's computed path on the globe (OrbitPanel): the orbit at the
 * satellite's height, its ground track and swath edges on the surface, and
 * the satellite with a line down to the point beneath it.
 */
export default function GlobeOrbit({ scene, orbit }) {
  const collections = useCollections(scene);
  useEffect(() => {
    if (!collections) return;
    const { points, lines } = collections;
    points.removeAll();
    lines.removeAll();
    if (orbit) {
      const { past, future, swathNear, swathFar, satellite } = orbit;
      const height = satellite.altKm * 1000;
      addLine(lines, at(swathNear, LIFT_M), { color: SWATH, width: 1.5, dashed: true });
      addLine(lines, at(swathFar, LIFT_M), { color: SWATH, width: 1.5, dashed: true });
      addLine(lines, at(past, LIFT_M), { color: WHITE, width: 2, alpha: 0.6 });
      addLine(lines, at(future, LIFT_M), { color: WHITE, width: 1.5, alpha: 0.45, dashed: true });
      addLine(lines, at(past, height), { color: WHITE, width: 2.5 });
      addLine(lines, at(future, height), { color: WHITE, width: 2, alpha: 0.7, dashed: true });
      addLine(
        lines,
        [Cartesian3.fromDegrees(satellite.lon, satellite.lat, LIFT_M), Cartesian3.fromDegrees(satellite.lon, satellite.lat, height)],
        { color: SWATH, width: 1.5, alpha: 0.8 },
      );
      points.add({
        position: Cartesian3.fromDegrees(satellite.lon, satellite.lat, height),
        pixelSize: 12,
        color: Color.fromCssColorString("#facc15"),
        outlineColor: Color.fromCssColorString("#0b1220"),
        outlineWidth: 2,
        id: { label: satellite.label },
      });
    }
    if (orbit?.follow) {
      const { lon, lat } = orbit.satellite;
      const height = Math.max(scene.camera.positionCartographic.height, 2.5e6);
      scene.camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, height) });
    }
    scene.requestRender();
  }, [scene, collections, orbit]);
  return null;
}
