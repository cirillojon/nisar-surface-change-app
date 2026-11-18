/** Pixel geometry shared by the WebGL camera, pointer hit area, and radar physics. */
export function heroGlobeLayout(width, height) {
  const radius = Math.max(width * 0.568, width <= 600 ? width * 0.95 : height * 0.7);
  const horizon = height * (width > 600 && width <= 900 ? 0.68 : 0.64);
  return { x: width / 2, y: horizon + radius, radius };
}

// Includes raised terrain and a little breathing room around the thin atmosphere.
export function heroGlobeBoundary(width, height) {
  const globe = heroGlobeLayout(width, height);
  return { ...globe, radius: globe.radius * 1.009 + 18 };
}
