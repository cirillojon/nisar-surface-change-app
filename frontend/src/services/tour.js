/* Guided tour: places, suggested drawings and first-visit memory. */

export const TOUR_STORAGE_KEY = "nisar.tour.v1";

// Kīlauea summit (Halemaʻumaʻu crater), Hawaiʻi.
export const KILAUEA = { lat: 19.4075, lon: -155.2835, label: "Kīlauea summit" };
// Where the map zooms for the tour.
export const TOUR_VIEW = [-155.4, 19.335, -155.17, 19.47];
// The box the tour suggests drawing: 12 km around the summit caldera. A box
// drawn close to it snaps to it, so the tour can show sharp imagery rendered
// for exactly this area (the gallery's "kilauea-tour" set, ~20 m pixels)
// instead of NASA's coarse quick-look images.
export const TOUR_BOX = [-155.34, 19.351, -155.225, 19.459];
export const TOUR_IMAGERY = "kilauea-tour";
// The line the tour suggests: across the summit caldera. Its result ships
// with the app (app/data/profiles/), so it opens instantly.
export const TOUR_LINE = [
  [-155.335, 19.392],
  [-155.235, 19.425],
];
// A drawn line whose ends are this close to the suggested ends snaps to it.
export const SNAP_KM = 1.2;

const km = ([lon1, lat1], [lon2, lat2]) => {
  const mid = (((lat1 + lat2) / 2) * Math.PI) / 180;
  return Math.hypot((lon2 - lon1) * 111.32 * Math.cos(mid), (lat2 - lat1) * 110.57);
};

/** The suggested line if `line` roughly follows it (either direction), else null. */
export function snapToTourLine(line) {
  if (!line || line.length < 2) return null;
  const [a, b] = [line[0], line[line.length - 1]];
  const [A, B] = TOUR_LINE;
  const forward = km(a, A) <= SNAP_KM && km(b, B) <= SNAP_KM;
  const backward = km(a, B) <= SNAP_KM && km(b, A) <= SNAP_KM;
  return forward || backward ? TOUR_LINE : null;
}

/** The suggested box if `bbox` is roughly that place and size, else null. */
export function snapToTourBox(bbox) {
  if (!bbox || bbox.length < 4) return null;
  const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const size = (b) => [km([b[0], b[1]], [b[2], b[1]]), km([b[0], b[1]], [b[0], b[3]])];
  const [w, h] = size(bbox);
  const [tw, th] = size(TOUR_BOX);
  const near = km(mid(bbox), mid(TOUR_BOX)) <= 2.5;
  const alike = w / tw > 0.6 && w / tw < 1.6 && h / th > 0.6 && h / th < 1.6;
  return near && alike ? TOUR_BOX : null;
}

/** Has this browser finished or skipped the tour? (Storage can be blocked.) */
export function tourSeen() {
  try {
    return window.localStorage?.getItem(TOUR_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function markTourSeen() {
  try {
    window.localStorage?.setItem(TOUR_STORAGE_KEY, "done");
  } catch {
    // Private mode or blocked storage: the tour just shows again next time.
  }
}
