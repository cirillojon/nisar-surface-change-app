/* Land-change gallery: change maps between two NISAR passes, in the browser. */

// Matches DB_LO / DB_HI in scripts/build_landchange.py.
export const DB_RANGE = [-30, 5];
export const NODATA = 255;
// Color limit (dB) and smoothing radius (pixels) of the change map.
export const CHANGE_LIMIT_DB = 6;
export const BLUR_RADIUS = 2;
// A pixel counts as "changed" past this many dB.
export const CHANGED_DB = 4;

const BRIGHTER = [178, 24, 43];
const SAME = [245, 245, 245];
const DARKER = [33, 102, 172];

/** 8-bit layer value → dB (NaN for no data). */
export function toDb(v, [lo, hi] = DB_RANGE) {
  return v === NODATA ? NaN : lo + (v / 254) * (hi - lo);
}

/** NaN-aware box mean with radius r (separable, two passes). */
export function boxBlur(values, w, h, r = BLUR_RADIUS) {
  const pass = (src, horizontal) => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const v = src[yy * w + xx];
          if (!Number.isNaN(v)) {
            sum += v;
            n++;
          }
        }
        out[y * w + x] = n ? sum / n : NaN;
      }
    }
    return out;
  };
  return pass(pass(values, true), false);
}

// Below this on both dates a pixel is treated as water: wind and waves
// change its brightness, so it's left out of the "% changed" figure.
export const WATER_DB = -18;

const median = (values) => {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Change map from two 8-bit dB layers of the same size.
 *
 * With `removeShift` (default) the area-wide median difference (season,
 * soil moisture, snow) is subtracted first, so local changes stand out.
 * Returns RGBA pixels (red = brighter on the later date, blue = darker,
 * transparent where either date has no data), the shift removed (dB), and
 * the share of land pixels whose brightness changed by more than CHANGED_DB.
 */
export function changeMap(
  before,
  after,
  w,
  h,
  { limit = CHANGE_LIMIT_DB, radius = BLUR_RADIUS, range, removeShift = true } = {},
) {
  const n = w * h;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = toDb(before[i], range);
    b[i] = toDb(after[i], range);
  }
  const sa = boxBlur(a, w, h, radius);
  const sb = boxBlur(b, w, h, radius);
  const diff = new Float64Array(n).fill(NaN);
  const measured = [];
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    const d = sb[i] - sa[i];
    if (Number.isNaN(d)) continue;
    diff[i] = d;
    measured.push(d);
  }
  const shift = removeShift ? median(measured) : 0;
  const rgba = new Uint8ClampedArray(n * 4);
  let land = 0;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(diff[i])) continue;
    const d = diff[i] - shift;
    if (!(a[i] < WATER_DB && b[i] < WATER_DB)) {
      land++;
      if (Math.abs(d) > CHANGED_DB) changed++;
    }
    const t = Math.max(-1, Math.min(1, d / limit));
    const end = t < 0 ? DARKER : BRIGHTER;
    const f = Math.abs(t);
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = SAME[c] + (end[c] - SAME[c]) * f;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, shift, changedPct: land ? (100 * changed) / land : 0 };
}

/** Load an 8-bit layer image into one value per pixel (browser only). */
export async function loadLayer(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const values = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < values.length; i++) values[i] = data[i * 4];
  return { values, width: canvas.width, height: canvas.height };
}

/** RGBA pixels → PNG data URL (browser only). */
export function toDataUrl(rgba, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.toDataURL("image/png");
}

// Change maps kept per place: a year of passes against a few "from" dates.
const MAX_CHANGE_MAPS = 120;

/**
 * Change maps between pairs of passes, each computed once and then kept, so
 * a time-lapse can show one frame after another without rebuilding (or
 * blanking) anything. `get(from, to, removeShift)` resolves to
 * `{ url, changedPct, shift, from, to }` (the dates it compares) or
 * `{ error }`; `peek(...)` returns a result that is already built, else
 * undefined. `from` and `to` are passes: `{ date, hh_url }`.
 */
export function createChangeMaps({ load = loadLayer, draw = toDataUrl, urlOf = (u) => u, range } = {}) {
  const layers = new Map(); // hh_url -> Promise<{ values, width, height }>
  const built = new Map(); // key -> result
  const pending = new Map(); // key -> Promise<result>
  const keyOf = (from, to, removeShift) => `${from?.hh_url}|${to?.hh_url}|${removeShift ? 1 : 0}`;
  const layer = (pass) => {
    let p = layers.get(pass.hh_url);
    if (!p) {
      p = Promise.resolve(load(urlOf(pass.hh_url)));
      layers.set(pass.hh_url, p);
      // A failed download may work next time: don't keep it.
      p.catch(() => layers.delete(pass.hh_url));
    }
    return p;
  };
  const get = (from, to, removeShift = true) => {
    if (!from?.hh_url || !to?.hh_url) return Promise.resolve({ error: "These passes have no HH layer." });
    const key = keyOf(from, to, removeShift);
    if (built.has(key)) return Promise.resolve(built.get(key));
    let p = pending.get(key);
    if (!p) {
      p = Promise.all([layer(from), layer(to)])
        .then(([a, b]) => {
          if (a.width !== b.width || a.height !== b.height) return { error: "These two passes don't line up." };
          const { rgba, changedPct, shift } = changeMap(a.values, b.values, a.width, a.height, { range, removeShift });
          const result = { url: draw(rgba, a.width, a.height), changedPct, shift, from: from.date, to: to.date };
          built.set(key, result);
          if (built.size > MAX_CHANGE_MAPS) built.delete(built.keys().next().value);
          return result;
        })
        .catch(() => ({ error: "Couldn't build the change map in this browser." }))
        .finally(() => pending.delete(key));
      pending.set(key, p);
    }
    return p;
  };
  const peek = (from, to, removeShift = true) => built.get(keyOf(from, to, removeShift));
  return { get, peek };
}

export const STATUS_LABEL = {
  visible: "Clearly visible",
  likely: "Likely: verify",
  not_visible: "Nothing visible yet",
  // Found and written by NISAR Watch (docs/AUTOMATION.md); no person has checked it.
  auto: "Auto-detected, not reviewed",
};

/** The pass a gallery place is pictured by: its suggested "after" date, else its last. */
export function galleryThumb(place) {
  const list = place.passes ?? [];
  return list.find((p) => p.date === place.suggested?.[1]) ?? list[list.length - 1] ?? null;
}
