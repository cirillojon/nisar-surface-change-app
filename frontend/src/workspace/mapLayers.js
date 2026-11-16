// Geometry for what the workspace puts on the map: the box around a map
// click, a height-profile line's layers, and the hatched footprint. Pure.

// Half-width in degrees of the search box drawn around a map click.
export const AOI_HALF_DEG = 0.25;
// Margin in degrees around a profile line when the map zooms to it.
const PROFILE_PAD_DEG = 0.05;
const PROFILE_START = "#facc15";
const PROFILE_END = "#f472b6";

const round3 = (v) => Math.round(v * 1000) / 1000;

/** The search area around a map click: its centre and a box of ±AOI_HALF_DEG. */
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
