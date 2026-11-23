// NISAR's computed ground track (GET /api/nisar/orbit): where the satellite is
// at any moment between the track's points, the path either side of it, and
// the swath its radar images.

const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

// Measured from NISAR's own footprints against this track (see
// docs/DATA_AND_METHODS.md): every L-band frame lies 430-700 km to the left
// of the ground track, on ascending and descending passes alike.
export const SWATH_KM = { near: 430, far: 700 };

/** `{ startMs, stepS, points }` from an /api/nisar/orbit response. */
export function trackOf(response) {
  return { startMs: Date.parse(response.start), stepS: response.step_s, points: response.points };
}

/** Time span the track covers, [first ms, last ms]. */
export const trackSpan = (track) => [
  track.startMs,
  track.startMs + track.points[track.points.length - 1][0] * 1000,
];

const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * The satellite at `ms`: `{ lat, lon, altKm, ascending }`, interpolated
 * between the track's points (null outside the track).
 */
export function positionAt(track, ms) {
  const { points } = track;
  const f = (ms - track.startMs) / 1000 / track.stepS;
  if (!points.length || f < 0 || f > points.length - 1) return null;
  const i = Math.min(points.length - 2, Math.floor(f));
  const a = points[i];
  const b = points[i + 1] ?? a;
  const k = f - i;
  let dLon = b[1] - a[1];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return {
    lat: a[2] + (b[2] - a[2]) * k,
    lon: wrapLon(a[1] + dLon * k),
    altKm: a[3] + (b[3] - a[3]) * k,
    ascending: b[2] >= a[2],
  };
}

/** Track points ([lon, lat]) from `fromMs` to `toMs`, with exact positions at both ends. */
export function pathBetween(track, fromMs, toMs) {
  const [first, last] = trackSpan(track);
  const from = Math.max(first, fromMs);
  const to = Math.min(last, toMs);
  if (to <= from) return [];
  const out = [];
  const start = positionAt(track, from);
  out.push([start.lon, start.lat]);
  const i0 = Math.floor((from - track.startMs) / 1000 / track.stepS) + 1;
  const i1 = Math.ceil((to - track.startMs) / 1000 / track.stepS) - 1;
  for (let i = i0; i <= i1; i += 1) out.push([track.points[i][1], track.points[i][2]]);
  const end = positionAt(track, to);
  out.push([end.lon, end.lat]);
  return out;
}

/**
 * A line of [lon, lat] split where it crosses the antimeridian, each piece
 * as Leaflet [lat, lon] positions, so it never streaks across the map.
 */
export function splitAtAntimeridian(coords) {
  const pieces = [];
  let piece = [];
  for (let i = 0; i < coords.length; i += 1) {
    const [lon, lat] = coords[i];
    if (piece.length) {
      const [plon, plat] = coords[i - 1];
      if (Math.abs(lon - plon) > 180) {
        // Where the segment meets ±180°.
        const east = plon > 0 ? 180 : -180;
        const lon2 = lon + (plon > 0 ? 360 : -360);
        const f = (east - plon) / (lon2 - plon);
        const latX = plat + (lat - plat) * f;
        piece.push([latX, east]);
        pieces.push(piece);
        piece = [[latX, -east]];
      }
    }
    piece.push([lat, lon]);
  }
  if (piece.length > 1) pieces.push(piece);
  return pieces;
}

/** Initial bearing (radians) from a to b, both [lon, lat]. */
function bearing([lon1, lat1], [lon2, lat2]) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
}

/** The point `km` from [lon, lat] along `brg` (radians), as [lon, lat]. */
export function destination([lon, lat], brg, km) {
  const d = km / EARTH_KM;
  const p1 = lat * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
  const l2 = lon * RAD + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [wrapLon(l2 / RAD), p2 / RAD];
}

/**
 * The swath's near and far edges along a path of [lon, lat]: each a line
 * `SWATH_KM.near` / `.far` to the left of the direction of travel.
 */
export function swathEdges(path) {
  if (path.length < 2) return { near: [], far: [] };
  const near = [];
  const far = [];
  for (let i = 0; i < path.length; i += 1) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const left = bearing(a, b) - Math.PI / 2;
    near.push(destination(path[i], left, SWATH_KM.near));
    far.push(destination(path[i], left, SWATH_KM.far));
  }
  return { near, far };
}

/** "12.3°N, 45.6°W". */
export function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/** "Nov 22, 14:05 UTC". */
export function formatUtc(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}
