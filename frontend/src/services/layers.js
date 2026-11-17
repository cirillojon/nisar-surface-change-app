/* Image layers shared by every map view: study sites, the land-change
 * gallery and drawn areas.
 *
 * NISAR backscatter images are false colour: R = HH, G = HV, B = HH/HV (see
 * gcov_rgb in app/nisar_render.py). Their channels still hold the two
 * polarisations, so a single-polarisation or open-water layer is drawn from
 * the colour image in the browser: no new data and no extra downloads. */
import { useCallback, useMemo } from "react";

import { useQueuedQueries } from "./useQueuedQueries.js";

// Matches STRETCH_DB in app/nisar_render.py (the colour image's fixed stretch).
export const HH_RANGE_DB = [-20, 0];
export const HV_RANGE_DB = [-26, -8];
export const WATER_DB = -18;
// Colour images are stored with a mild gamma that lifts the dark end.
const GAMMA = 0.8;
// HH-only passes are drawn grey: (dB + 25) / 25, same gamma.
const GREY_RANGE_DB = [-25, 0];

const stretched = (db, [lo, hi]) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, (db - lo) / (hi - lo))), GAMMA));

// An HH-only pass is stored on the wider grey stretch. In the "HH brightness"
// layer it is redrawn on the HH stretch, so a grey level means the same dB on
// every pass and the legend (−20 to 0 dB) holds for all of them.
const GREY_TO_HH = Uint8Array.from({ length: 256 }, (_, v) => {
  const [lo, hi] = GREY_RANGE_DB;
  return stretched(lo + Math.pow(v / 255, 1 / GAMMA) * (hi - lo), HH_RANGE_DB);
});

export const LAYERS = {
  colour: {
    label: "Colour (HH, HV)",
    // The parent supplies the colour legend text; it differs by product.
    legend: null,
  },
  hh: {
    label: "HH brightness",
    ramp: { className: "ramp-grey", labels: ["−20 dB (dark)", "−10", "0 dB (bright)"] },
    legend: "HH in grey. Calm water and smooth ground are dark; rough ground, buildings and flooded vegetation are bright.",
  },
  hv: {
    label: "HV brightness",
    ramp: { className: "ramp-grey", labels: ["−26 dB (dark)", "−17", "−8 dB (bright)"] },
    legend: "HV in grey. Follows vegetation.",
  },
  water: {
    label: "Very dark pixels",
    ramp: { className: "ramp-water", labels: ["HH above −18 dB", "HH below −18 dB"] },
    legend: "Blue: HH below −18 dB. Calm water, or smooth bare ground.",
  },
};

/** Layer ids drawn from a colour image's channels. */
export const IMAGE_LAYERS = ["colour", "hh", "hv", "water"];

/**
 * The layer choices for a set of images: [{ id, label, disabled, reason }].
 * `has` says which polarisations the data holds ({ hh, hv }); a layer the
 * data can't supply is listed but disabled, with the reason.
 */
export function imageLayerOptions({ hh = true, hv = true } = {}) {
  return IMAGE_LAYERS.map((id) => {
    const missing = (id === "hv" && !hv) || (id === "hh" && !hh) || (id === "water" && !hh);
    return {
      id,
      label: LAYERS[id].label,
      disabled: missing,
      reason: missing ? `no ${id === "hv" ? "HV" : "HH"} data` : null,
    };
  });
}

// ── Rendering ────────────────────────────────────────────────────────

const cache = new Map(); // key -> { url } | { promise }

const keyOf = (url, layer, grey) => `${layer}${grey ? "-grey" : ""}|${url}`;

export function paint(data, layer, grey) {
  const waterCut = stretched(WATER_DB, grey ? GREY_RANGE_DB : HH_RANGE_DB);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (!a) continue;
    const r = data[i];
    if (layer === "hh") {
      const v = grey ? GREY_TO_HH[r] : r;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (layer === "hv") {
      const g = grey ? r : data[i + 1];
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    } else if (layer === "water") {
      if (r < waterCut) {
        data[i] = 34;
        data[i + 1] = 150;
        data[i + 2] = 255;
      } else {
        // The land stays visible, dimmed, so the water has context.
        const v = Math.round(r * 0.45);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    }
  }
}

function render(url, layer, grey) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        paint(pixels.data, layer, grey);
        ctx.putImageData(pixels, 0, 0);
        canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/png");
      } catch {
        resolve(null); // e.g. a cross-origin image: the colour image stays
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Start drawing `layer` for the colour image at `url`; resolves to the
 * drawn image's URL, or null if it can't be drawn. `grey` marks HH-only
 * images (drawn grey, so there is no HV to show).
 */
export function ensureLayer(url, layer, { grey = false } = {}) {
  if (!url || !layer || layer === "colour") return Promise.resolve(url ?? null);
  const key = keyOf(url, layer, grey);
  let entry = cache.get(key);
  if (!entry) {
    entry = { url: undefined, promise: render(url, layer, grey) };
    entry.promise.then((out) => {
      entry.url = out;
    });
    cache.set(key, entry);
  }
  return entry.promise;
}

/** The drawn image's URL if it's ready, else the colour image's. */
export function layerUrl(url, layer, { grey = false } = {}) {
  if (!url || !layer || layer === "colour") return url;
  return cache.get(keyOf(url, layer, grey))?.url ?? url;
}

// Layer images drawn at once (each decodes and repaints a whole image).
const LAYER_CONCURRENCY = 2;

/** Drawing `layer` from the colour image at `url`, as a query (null if it can't be drawn). */
const layerQuery = (url, layer, grey) => ({
  queryKey: ["image-layer", url, layer, grey],
  queryFn: () => ensureLayer(url, layer, { grey }),
  staleTime: Infinity,
  retry: false,
});

/**
 * A function that maps a colour image's URL to the selected layer's image
 * (the colour image until the layer is drawn). `items` are
 * `{ url, grey }` for every image the view may show, the first wanted first;
 * they are drawn a couple at a time, in that order.
 */
export function useLayerMapper(layer, items) {
  const drawn = layer && layer !== "colour";
  const results = useQueuedQueries(
    drawn ? items.map((it) => layerQuery(it.url, layer, Boolean(it.grey))) : [],
    LAYER_CONCURRENCY,
  );
  // Each image's drawn URL once ready, as a string so the mapper only
  // changes when an image finishes (not with every new `items` array).
  const pairs = JSON.stringify(drawn ? items.map((it, i) => [it.url, results[i]?.data ?? null]) : []);
  const byUrl = useMemo(() => new Map(JSON.parse(pairs)), [pairs]);
  return useCallback((url) => byUrl.get(url) || url, [byUrl]);
}

/** Legend for a layer: { ramp, text } ('colour' uses `colourText`). */
export function layerLegend(layer, colourText) {
  const meta = LAYERS[layer] ?? LAYERS.colour;
  return { ramp: meta.ramp ?? null, text: meta.legend ?? colourText };
}
