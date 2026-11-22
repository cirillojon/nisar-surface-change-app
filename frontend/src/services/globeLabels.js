/* Which place names the 3D globe shows, as plain functions (tested without
 * WebGL). The globe draws names as screen-facing text, so they stay upright
 * however the Earth is turned, as in Google Earth.
 *
 * A name shows once it is close enough: Natural Earth gives each place the
 * web-map zoom at which it starts being named (`minZoom`), and each name's
 * own distance from the camera gives the zoom it is seen at, so a tilted
 * view names nearby towns but only the countries far off. Names that would
 * overlap give way to more important ones.
 */

const EARTH_CIRCUMFERENCE_M = 40075016.7;

/**
 * The web-map zoom at which a spot `distance` meters from the camera is
 * seen, on a view `widthPx` wide with horizontal field of view `fov` (radians).
 */
export function zoomAtDistance(distance, widthPx, fov) {
  const metersAcross = 2 * Math.max(distance, 1) * Math.tan(fov / 2);
  return Math.log2((widthPx * EARTH_CIRCUMFERENCE_M) / (256 * metersAcross));
}

// The order in which names claim space: oceans and countries first, then capitals, states and towns.
const KIND_ORDER = { ocean: 0, country: 1, capital: 2, state: 3, city: 4 };

/** The places as objects, most important first (the order names claim space in). */
export function placeList(rows) {
  return rows
    .map(([name, lon, lat, minZoom, kind], i) => ({ id: i, name, lon, lat, minZoom, kind }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.minZoom - b.minZoom || a.id - b.id);
}

export const LABEL_STYLE = {
  ocean: { size: 14, italic: true, color: "#9cc9ff", dot: false },
  country: { size: 15, bold: true, color: "#ffffff", dot: false },
  state: { size: 12, color: "#f3e2b3", dot: false },
  capital: { size: 13, bold: true, color: "#ffffff", dot: true },
  city: { size: 12, color: "#ffffff", dot: true },
};

/** The CSS font for a kind of place. */
export function labelFont(kind) {
  const s = LABEL_STYLE[kind];
  return `${s.italic ? "italic " : ""}${s.bold ? "600 " : ""}${s.size}px "BDO Grotesk", system-ui, sans-serif`;
}

/** A name's box on screen (`x`, `y`: its anchor; towns' names sit right of their dot). */
export function labelBox(place, x, y) {
  const s = LABEL_STYLE[place.kind];
  const width = place.name.length * s.size * 0.58 + 6;
  const height = s.size + 6;
  return s.dot
    ? { left: x - 4, right: x + 8 + width, top: y - height / 2, bottom: y + height / 2 }
    : { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * The names to show: `candidates` ({place, x, y}, most important first)
 * that don't overlap a name already placed, at most `limit` of them.
 * Returns the set of place ids.
 */
export function declutter(candidates, limit = 160) {
  const placed = [];
  const shown = new Set();
  for (const { place, x, y } of candidates) {
    if (shown.size >= limit) break;
    const box = labelBox(place, x, y);
    if (placed.some((b) => overlaps(b, box))) continue;
    placed.push(box);
    shown.add(place.id);
  }
  return shown;
}
