/*
 * Geometry for exploring NISAR data over a rectangle.
 *
 * Polygons use polygon-clipping's format: a MultiPolygon is
 * [polygon, ...], a polygon is [outerRing, ...holes], a ring is
 * [[lon, lat], ...]. CMR footprints come as [[lat, lon], ...].
 */
import polygonClipping from "polygon-clipping";

// Ignore slivers smaller than this share of the rectangle (rounding noise
// where footprints of one pass touch).
const MIN_SHARE = 1e-4;

// Colours for the days in a mosaic, newest first (distinct on imagery).
// No yellow: that's the selected area's outline.
export const DAY_COLORS = [
  "#22d3ee",
  "#f472b6",
  "#a3e635",
  "#fb923c",
  "#c084fc",
  "#f87171",
  "#34d399",
  "#60a5fa",
  "#e879f9",
  "#2dd4bf",
];

/** Wrap Leaflet longitudes into ±180 and order the corners. */
export function normalizeBbox([lon1, lat1, lon2, lat2]) {
  const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
  const clampLat = (lat) => Math.max(-89.9, Math.min(89.9, lat));
  let minLon = Math.min(lon1, lon2);
  let maxLon = Math.max(lon1, lon2);
  // Shift a box drawn on a world copy back, keeping its width.
  const shift = wrap(minLon) - minLon;
  minLon += shift;
  maxLon = Math.min(maxLon + shift, 180);
  const r = (v) => Math.round(v * 1000) / 1000;
  return [
    r(minLon),
    r(clampLat(Math.min(lat1, lat2))),
    r(maxLon),
    r(clampLat(Math.max(lat1, lat2))),
  ];
}

export const rectPolygon = ([minLon, minLat, maxLon, maxLat]) => [
  [
    [
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ],
  ],
];

/** CMR footprint ([[lat, lon], ...]) → MultiPolygon, or null. */
export function footprintPolygon(footprint) {
  if (!footprint || footprint.length < 3) return null;
  const ring = footprint.map(([lat, lon]) => [lon, lat]);
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return [[ring]];
}

/** Planar area (deg², latitude-weighted) of a MultiPolygon. */
export function area(multi) {
  let total = 0;
  for (const polygon of multi ?? []) {
    polygon.forEach((ring, i) => {
      let a = 0;
      let latSum = 0;
      for (let k = 0; k < ring.length - 1; k++) {
        const [x1, y1] = ring[k];
        const [x2, y2] = ring[k + 1];
        a += x1 * y2 - x2 * y1;
        latSum += y1;
      }
      const cos = Math.cos(((latSum / (ring.length - 1)) * Math.PI) / 180);
      total += (i === 0 ? 1 : -1) * Math.abs(a / 2) * cos;
    });
  }
  return total;
}

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    // polygon-clipping can throw on degenerate input; treat as empty.
    return fallback;
  }
};

export const intersect = (a, b) =>
  safe(() => polygonClipping.intersection(a, b), []);
const subtract = (a, b) => safe(() => polygonClipping.difference(a, b), a);
const union = (...polys) => safe(() => polygonClipping.union(...polys), []);

/** Track/frame of a NISAR L2/L3 granule name, e.g. "098_A_010". */
export function frameKey(title) {
  return (title ?? "").split("_").slice(5, 8).join("_");
}

/**
 * Granules that overlap the rectangle, grouped by acquisition day (UTC),
 * oldest first: [{ date, granules: [{ granule, region, share }] }].
 * `region` is the footprint clipped to the rectangle.
 */
export function groupByDay(granules, bbox) {
  const rect = rectPolygon(bbox);
  const rectArea = area(rect);
  const days = new Map();
  for (const g of granules) {
    const date = g.start?.slice(0, 10);
    const fp = footprintPolygon(g.footprint);
    if (!date || !fp) continue;
    const region = intersect(rect, fp);
    const share = rectArea ? area(region) / rectArea : 0;
    if (share < MIN_SHARE) continue;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push({ granule: g, region, share });
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      granules: items.sort((a, b) => b.share - a.share),
    }));
}

/**
 * Tile the rectangle with the newest data: walk granules newest first and
 * keep each one only where nothing newer already covers.
 *
 * Returns { tiles, days, coverage }:
 *  - tiles: [{ granule, date, region, full }] oldest first (draw order);
 *    region = the part of the rectangle this granule supplies, full = its
 *    whole footprint in the rectangle (the clip used for drawing);
 *  - days: [{ date, region, share, count, color }] newest first, the area
 *    each acquisition day supplies (outlined on the map);
 *  - coverage: share of the rectangle covered (0-1).
 */
export function buildMosaic(granules, bbox) {
  const rect = rectPolygon(bbox);
  const rectArea = area(rect);
  const newestFirst = [...granules]
    .filter((g) => g.start && g.footprint)
    .sort((a, b) => b.start.localeCompare(a.start));

  let remaining = rect;
  const tiles = [];
  for (const g of newestFirst) {
    if (area(remaining) / rectArea < MIN_SHARE) break;
    const fp = footprintPolygon(g.footprint);
    if (!fp) continue;
    const region = intersect(remaining, fp);
    if (area(region) / rectArea < MIN_SHARE) continue;
    // `full` (footprint ∩ area) is for drawing: images stacked oldest
    // first, so an older pass shows through where a newer one has no
    // data (transparent swath edges) instead of leaving a gap.
    tiles.push({
      granule: g,
      date: g.start.slice(0, 10),
      region,
      full: intersect(rect, fp),
    });
    remaining = subtract(remaining, fp);
  }

  const byDay = new Map();
  for (const t of tiles) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t.region);
  }
  const days = [...byDay.entries()].map(([date, regions], i) => {
    const region = regions.length > 1 ? union(...regions) : regions[0];
    return {
      date,
      region,
      share: area(region) / rectArea,
      count: regions.length,
      color: DAY_COLORS[i % DAY_COLORS.length],
    };
  });

  return {
    tiles: tiles.reverse(),
    days,
    coverage: Math.min(1, 1 - area(remaining) / rectArea),
  };
}

/** A MultiPolygon as Leaflet multi-polygon positions ([lat, lon], holes kept). */
export const toLatLngs = (multi) =>
  (multi ?? []).map((polygon) =>
    polygon.map((ring) => ring.map(([lon, lat]) => [lat, lon])),
  );

/** Web Mercator y in degree-like units (so SVG clip paths match the map). */
export const mercY = (lat) =>
  (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
