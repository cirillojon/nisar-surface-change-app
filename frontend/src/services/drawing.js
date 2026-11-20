/* The rules for drawing a line on the map (LineDrawer in ChangeMap.jsx),
 * kept apart from Leaflet so they can be tested. Points are [lat, lng]. */

// Matches MAX_LENGTH_KM in app/profiles.py.
export const MAX_LINE_KM = 100;
export const MIN_LINE_POINTS = 2;
// A click this close (in screen pixels) to the line's last point adds
// nothing: it is the second click of a double-click, or a repeated tap.
export const SAME_POINT_PX = 6;

const EARTH_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle length of a path, in km. */
export function lineKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    const a =
      Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    km += 2 * EARTH_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return km;
}

/**
 * The line after a click at `point`, which landed `pxFromLast` screen
 * pixels from the line's last point. A click on that last point returns
 * the same line.
 */
export function addPoint(points, point, pxFromLast = Infinity) {
  return points.length > 0 && pxFromLast < SAME_POINT_PX ? points : [...points, point];
}

/** A line can be finished once it has two points and is no longer than the limit. */
export const canFinish = (points) => points.length >= MIN_LINE_POINTS && lineKm(points) <= MAX_LINE_KM;

/** What the drawing bar says about a line of `points` (`hint` replaces the instructions). */
export function lineStatus(points, hint = null) {
  const km = lineKm(points);
  if (km > MAX_LINE_KM) return { text: `${km.toFixed(1)} km is over the ${MAX_LINE_KM} km limit: undo a point.`, warning: true };
  if (hint) return { text: hint, warning: false };
  if (points.length === 0) return { text: "Click the map to start a line.", warning: false };
  if (points.length === 1) return { text: "Click to add the next point.", warning: false };
  return { text: `${points.length} points, ${km.toFixed(1)} km. Add more, or finish.`, warning: false };
}
