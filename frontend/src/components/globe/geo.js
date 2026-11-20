import { Cartographic, Math as CesiumMath } from "cesium";

/** [lon, lat] on the Earth under a screen position, or null off the globe (in space). */
export function lonLatAt(scene, position) {
  const hit = scene.camera.pickEllipsoid(position, scene.globe.ellipsoid);
  if (!hit) return null;
  const c = Cartographic.fromCartesian(hit);
  return [CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)];
}

/** A [lat, lon] point (the drawing rules' order) on the Earth's surface. */
export const latLonToCartesian = ([lat, lon]) => Cartographic.toCartesian(Cartographic.fromDegrees(lon, lat));
