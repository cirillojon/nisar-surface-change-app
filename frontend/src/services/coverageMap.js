// The global coverage heatmap (GET /api/nisar/coverage-map/grid): decoding the
// packed grid, coloring it, and drawing it as an image for the 2D map (Web
// Mercator) or the 3D globe (plate carrée).

// Dark violet to yellow, perceptually ordered so more reads as brighter.
const SEQUENTIAL = [
  [0, [40, 11, 84]],
  [0.25, [101, 21, 110]],
  [0.5, [188, 55, 84]],
  [0.75, [249, 142, 9]],
  [1, [252, 255, 164]],
];
// Descending (teal) through both (pale) to ascending (orange).
const DIVERGING = [
  [0, [0, 128, 128]],
  [0.5, [236, 236, 228]],
  [1, [230, 110, 20]],
];

// How each metric is colored: `reverse` puts the bright end at small values
// (fewer days between or since passes is better coverage).
const STYLES = {
  passes: { stops: SEQUENTIAL, reverse: false, digits: 0 },
  days_per_pass: { stops: SEQUENTIAL, reverse: true, digits: 1 },
  days_since: { stops: SEQUENTIAL, reverse: true, digits: 0 },
  ascending_pct: { stops: DIVERGING, reverse: false, digits: 0, fixed: [0, 100] },
};

export const styleOf = (metric) => STYLES[metric] ?? STYLES.passes;

/** The grid's values as a Float32Array (NaN where empty), row-major from the north-west. */
export function decodeGrid(grid) {
  const binary = atob(grid.values);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) view.setUint8(i, binary.charCodeAt(i));
  const n = grid.width * grid.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const raw = view.getUint16(i * 2, true);
    out[i] = raw === grid.nodata ? NaN : raw * grid.scale;
  }
  return out;
}

/** Color range [min, max] for a grid: fixed for shares, else 0 (or the smallest value) to `color_max`. */
export function rangeOf(grid) {
  const style = styleOf(grid.metric);
  if (style.fixed) return style.fixed;
  const top = Math.max(grid.color_max ?? grid.stats?.max ?? 1, 1);
  return [grid.metric === "passes" ? 1 : 0, top];
}

/** RGB for `t` in 0..1 along `stops`. */
export function colorAt(t, stops = SEQUENTIAL) {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (let i = 1; i < stops.length; i += 1) {
    const [t1, c1] = stops[i];
    if (x <= t1) {
      const [t0, c0] = stops[i - 1];
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    }
  }
  return stops[stops.length - 1][1];
}

/** CSS gradient for a legend, low values on the left. */
export function legendGradient(metric) {
  const { stops, reverse } = styleOf(metric);
  const parts = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const [r, g, b] = colorAt(reverse ? 1 - t : t, stops);
    return `rgb(${r} ${g} ${b}) ${Math.round(t * 100)}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** A value as the legend and readout show it. */
export function formatValue(value, metric) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(styleOf(metric).digits);
}

// Web Mercator stops short of the poles.
export const MERCATOR_MAX_LAT = 85.05112878;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfMercY = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/** Index of the cell under (lat, lon), or -1 off the grid. */
export function cellIndex(grid, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) return -1;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const row = Math.min(grid.height - 1, Math.floor((90 - lat) / grid.cell_deg));
  const col = Math.min(grid.width - 1, Math.floor((wrapped + 180) / grid.cell_deg));
  return row * grid.width + col;
}

/** The value under (lat, lon), NaN where the cell is empty. */
export function valueAt(grid, values, lat, lon) {
  const i = cellIndex(grid, lat, lon);
  return i < 0 ? NaN : values[i];
}

/**
 * RGBA pixels of the heatmap, `width` x `height`: in Web Mercator between
 * ±MERCATOR_MAX_LAT (`projection: "mercator"`, for Leaflet) or plate carrée
 * over the whole Earth (`"geographic"`, for Cesium). Empty cells are clear.
 */
export function paintHeatmap(grid, values, { width, height, projection = "mercator", alpha = 210 }) {
  const { stops, reverse } = styleOf(grid.metric);
  const [lo, hi] = rangeOf(grid);
  const span = hi - lo || 1;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const top = mercY(MERCATOR_MAX_LAT);
  const cols = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    cols[x] = Math.min(grid.width - 1, Math.floor(((x + 0.5) / width) * grid.width));
  }
  for (let y = 0; y < height; y += 1) {
    const lat =
      projection === "mercator"
        ? latOfMercY(top - ((y + 0.5) / height) * 2 * top)
        : 90 - ((y + 0.5) / height) * 180;
    const row = Math.min(grid.height - 1, Math.max(0, Math.floor((90 - lat) / grid.cell_deg)));
    for (let x = 0; x < width; x += 1) {
      const v = values[row * grid.width + cols[x]];
      if (!Number.isFinite(v)) continue;
      const t = (v - lo) / span;
      const [r, g, b] = colorAt(reverse ? 1 - t : t, stops);
      const o = (y * width + x) * 4;
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
      pixels[o + 3] = alpha;
    }
  }
  return pixels;
}

/** The heatmap as a PNG data URL (needs a real canvas: not in jsdom). */
export function heatmapImage(grid, values, options) {
  const { width, height } = options;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(paintHeatmap(grid, values, options), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/** Where each image goes: [west, south, east, north]. */
export const HEATMAP_BOUNDS = {
  mercator: [-180, -MERCATOR_MAX_LAT, 180, MERCATOR_MAX_LAT],
  geographic: [-180, -90, 180, 90],
};

/** "Oct 2026" for "2026-10". */
export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
