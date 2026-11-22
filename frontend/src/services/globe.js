// What the 3D globe (components/GlobeMap.jsx, CesiumJS) draws, as plain data:
// its tile sources, the markers, the outlines and lines, where the camera
// goes, and images clipped to where a pass imaged. Pure, so it is tested
// without WebGL. Coordinates are [lon, lat] unless named otherwise.

export const IMAGERY_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Country, region and city names with borders, over the 2D map's imagery. (The globe
// draws its own upright names instead: components/globe/usePlaceNames.js.)
export const LABELS_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
// Esri serves the same tiles from two hosts, both HTTP/1.1, where a browser
// opens at most 6 connections per host: the globe spreads its tiles over
// both ({s}), so twice as many load at once.
export const TILE_SUBDOMAINS = ["server", "services"];
const onBothHosts = (url) => url.replace("https://server.", "https://{s}.");
export const GLOBE_IMAGERY_URL = onBothHosts(IMAGERY_URL);

// The whole Earth, from far enough out to see it round, Africa and Europe in front.
export const GLOBE_HOME = { lon: 10, lat: 20, height: 2.2e7 };

const GALLERY_COLOR = "#f59e0b";
const SITE_COLOR = "#38bdf8";
const FOCUS_COLOR = "#facc15";

/**
 * Every place's marker: study sites colored by change type, before & after
 * places in amber. `kind` and `ref` say what a click opens.
 */
export function markersOf({ sites = [], places = [], colorOf = {} }) {
  return [
    ...places.map((p) => ({ kind: "place", ref: p.slug, label: `${p.name} · before & after`, color: GALLERY_COLOR, size: 12, lon: p.lon, lat: p.lat })),
    ...sites.map((s) => ({
      kind: "site",
      ref: s.id,
      label: s.name,
      color: colorOf[s.change_type] ?? SITE_COLOR,
      size: 14,
      lon: s.longitude,
      lat: s.latitude,
    })),
  ];
}

/**
 * A path with a point at least every `stepDeg` degrees, so a long edge
 * follows the globe's surface rather than cutting under it.
 */
export function densify(coords, stepDeg = 0.25) {
  if (coords.length < 2) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / stepDeg));
    for (let k = 1; k <= n; k += 1) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

/** A [west, south, east, north] box as a closed ring. */
export const boxRing = ([w, s, e, n]) => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

/** The selection's box, as a dashed yellow outline (none without a box). */
export const focusLines = (bbox) => (bbox ? [{ coords: boxRing(bbox), color: FOCUS_COLOR, dashed: true }] : []);

/**
 * The explorer's footprint outlines, the profile line, its ends and the InSAR
 * reference point, from the 2D map's layers (Leaflet's [lat, lon] positions).
 */
export function overlayShapes({ outlines = [], lines = [], points = [], referencePoint = null }) {
  const lonLat = (positions) => positions.map(([lat, lon]) => [lon, lat]);
  // A polygon's positions are a ring, a list of rings, or a list of polygons (each a list of rings).
  const rings = (positions) => {
    if (!Array.isArray(positions?.[0]?.[0])) return positions?.length ? [positions] : [];
    return Array.isArray(positions[0][0][0]) ? positions.flat(1) : positions;
  };
  const shapes = {
    lines: [
      ...outlines.flatMap((o) =>
        rings(o.positions)
          .filter((ring) => ring.length > 1)
          .map((ring) => ({ coords: [...lonLat(ring), lonLat(ring)[0]], color: o.color, dashed: Boolean(o.dashed), label: o.label ?? null }))),
      ...lines.map((l) => ({ coords: lonLat(l.positions), color: l.color, dashed: false, label: l.label ?? null })),
    ],
    points: points.map((p) => ({ lon: p.lon, lat: p.lat, color: p.color, label: p.label, size: 10 })),
  };
  if (referencePoint) {
    shapes.points.push({ lon: referencePoint[0], lat: referencePoint[1], color: "#ffffff", label: "Stable reference point for displacement", size: 10 });
  }
  return shapes;
}

/** Degrees of longitude a Leaflet map `widthPx` wide shows at `zoom`. */
export const spanAtZoom = (zoom, widthPx) => (widthPx * 360) / (256 * 2 ** zoom);

/**
 * The box the camera flies to for a selection: the selection with a margin
 * (the globe fits a box edge to edge), at least `minSpan` degrees wide (no
 * closer than the 2D map would zoom), and widened east by the share of the
 * view the evidence card covers, so the place stays clear of it.
 */
const MARGIN = 1.4;
export function cameraBox([w, s, e, n], { minSpan = 0, covered = 0 } = {}) {
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const half = Math.max((e - w) * MARGIN, minSpan) / 2;
  const halfLat = Math.min(Math.max((n - s) * MARGIN, minSpan * 0.6) / 2, 89);
  const share = Math.min(Math.max(covered, 0), 0.6);
  // The card covers `share` of the view: the box gets that much more room on its right.
  const east = cx + half + (2 * half * share) / (1 - share);
  return [Math.max(cx - half, -180), Math.max(cy - halfLat, -89.9), Math.min(east, 180), Math.min(cy + halfLat, 89.9)];
}

/**
 * An image clipped to a MultiPolygon, as a PNG data URL, the way the 2D map
 * clips browse images so their opaque margins hide nothing. The globe lays
 * an image over its box in latitude and longitude (as KML ground overlays are
 * made), so rows map linearly to latitude.
 */
export function clipToCanvas(img, [minLon, minLat, maxLon, maxLat], multi) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  const x = (lon) => ((lon - minLon) / (maxLon - minLon)) * canvas.width;
  const y = (lat) => ((maxLat - lat) / (maxLat - minLat)) * canvas.height;
  ctx.beginPath();
  for (const polygon of multi) {
    for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(x(lon), y(lat)) : ctx.moveTo(x(lon), y(lat))));
      ctx.closePath();
    }
  }
  ctx.clip("evenodd");
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}
