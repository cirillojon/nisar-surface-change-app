// Geometry for what the workspace puts on the map: the box around a map
// click, a height-profile line's layers, and the hatched footprint. Pure.

// Half-width in degrees of the search box drawn around a map click.
export const AOI_HALF_DEG = 0.25;
// Margin in degrees around a profile line when the map zooms to it.
const PROFILE_PAD_DEG = 0.05;
const PROFILE_START = "#facc15";
const PROFILE_END = "#f472b6";

const round3 = (v) => Math.round(v * 1000) / 1000;

/** The search area around a map click: its center and a box of ±AOI_HALF_DEG. */
export function aoiAround(latitude, longitude) {
  // Leaflet's worldCopyJump can report longitudes outside ±180.
  const lon = ((((longitude + 180) % 360) + 360) % 360) - 180;
  const lat = Math.max(-89.5, Math.min(89.5, latitude));
  return {
    latitude: lat,
    longitude: lon,
    bbox: [
      round3(Math.max(lon - AOI_HALF_DEG, -180)),
      round3(Math.max(lat - AOI_HALF_DEG, -90)),
      round3(Math.min(lon + AOI_HALF_DEG, 180)),
      round3(Math.min(lat + AOI_HALF_DEG, 90)),
    ],
  };
}

// The largest box a searched place opens with, in degrees a side: a whole
// country or ocean would ask NASA's catalog for every pass on Earth's side.
export const PLACE_MAX_SPAN_DEG = 3;

// Into ±180° (left as is when already there, so it stays exact).
const wrapLon = (longitude) => (Math.abs(longitude) <= 180 ? longitude : ((((longitude + 180) % 360) + 360) % 360) - 180);

/**
 * The search area for a place found by name: its own box, at least as big as
 * the box around a map click, and at most PLACE_MAX_SPAN_DEG a side (centered
 * on the place, `clipped` then). `label` names it.
 */
export function areaForPlace({ name, latitude, longitude, bbox }) {
  const lon = wrapLon(longitude);
  const lat = Math.max(-89.5, Math.min(89.5, latitude));
  const [west, south, east, north] = bbox ?? [lon, lat, lon, lat];
  // A box across the antimeridian (west > east) is treated as too wide.
  const lonSpan = west <= east ? east - west : 360;
  const latSpan = north - south;
  const clipped = lonSpan > PLACE_MAX_SPAN_DEG || latSpan > PLACE_MAX_SPAN_DEG;
  const half = (span) => Math.min(PLACE_MAX_SPAN_DEG, Math.max(2 * AOI_HALF_DEG, span)) / 2;
  // A box that fits is kept around its own middle; one that doesn't is centered on the place.
  const cLon = clipped || west > east ? lon : (west + east) / 2;
  const cLat = clipped ? lat : (south + north) / 2;
  const hLon = half(lonSpan);
  const hLat = half(latSpan);
  return {
    latitude: lat,
    longitude: lon,
    bbox: [
      round3(Math.max(cLon - hLon, -180)),
      round3(Math.max(cLat - hLat, -90)),
      round3(Math.min(cLon + hLon, 180)),
      round3(Math.min(cLat + hLat, 90)),
    ],
    label: name,
    clipped,
  };
}

/**
 * A height-profile line ([[lon, lat], ...]) on the map: a box to zoom to and
 * the line with its A and B ends. Both null without a line.
 */
export function profileLayers(line) {
  if (!line) return { bbox: null, layers: null };
  const lons = line.map((p) => p[0]);
  const lats = line.map((p) => p[1]);
  const bbox = [
    Math.min(...lons) - PROFILE_PAD_DEG,
    Math.min(...lats) - PROFILE_PAD_DEG,
    Math.max(...lons) + PROFILE_PAD_DEG,
    Math.max(...lats) + PROFILE_PAD_DEG,
  ];
  const [a, b] = [line[0], line[line.length - 1]];
  return {
    bbox,
    layers: {
      lines: [
        {
          key: "profile",
          positions: line.map(([lon, lat]) => [lat, lon]),
          color: PROFILE_START,
          label: "Height profile line",
        },
      ],
      points: [
        { key: "A", lat: a[1], lon: a[0], color: PROFILE_START, label: "A: start of the profile" },
        { key: "B", lat: b[1], lon: b[0], color: PROFILE_END, label: "B: end of the profile" },
      ],
    },
  };
}

/**
 * The part of a study site's box some pass didn't image, hatched over the
 * map while open water (compared over the rest) is what the site shows.
 * `toUrl` turns the stored image path into a URL (assetUrl).
 */
export function footprintOverlay({ site, siteLayer, hidden, toUrl }) {
  if (hidden || !site?.footprint?.image_url) return null;
  if (site.story_metric !== "water_pct" && siteLayer !== "water") return null;
  return {
    url: toUrl(site.footprint.image_url),
    bbox: site.bbox,
    label: `Left out of open-water values: not imaged by every pass. Values are compared over the other ${site.footprint.pct_of_box}% of the box.`,
  };
}
