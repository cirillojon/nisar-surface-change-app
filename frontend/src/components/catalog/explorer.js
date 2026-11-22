// The catalog explorer's model: a search's granules (or an area's sharp
// imagery) as days to step through or a newest-first mosaic, and the map
// layers, scenes, legend and status that follow. Plain functions, so the
// workspace and the panels share one view of it.

import { assetUrl } from "../../services/api.js";
import { imageLayerOptions, layerLegend } from "../../services/layers.js";
import { buildMosaic, frameKey, groupByDay, rectPolygon, toLatLngs } from "../../services/regions.js";
import { SME2_LAYERS, SME2_METRICS } from "../../services/sme2.js";

/** "100%", "37%", "4.2%": a share of the area. */
export const pct = (share) =>
  share >= 0.995 ? "100%" : `${Math.max(0, share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

/** How the explorer starts for a new set of results: the time slider, the newest day, color. */
export const freshExplorer = (key) => ({ key, mode: "time", index: null, layer: "color", granuleId: null });

/**
 * Days for sharp, pre-rendered imagery of this area (a gallery-style site):
 * one image per pass on one frame, shaped like `groupByDay`'s output.
 */
export function sharpDays(site, bbox, start, end) {
  const region = rectPolygon(bbox);
  return site.passes
    .filter((p) => (!start || p.date >= start) && (!end || p.date <= end))
    .map((p) => ({
      date: p.date,
      granules: [{
        granule: { id: `sharp-${site.slug}-${p.date}`, product: "GCOV", title: site.frame, quality: p.quality, sharp: p, site },
        region,
        share: 1,
      }],
    }));
}

/** The days to step through: the sharp imagery's passes, or the granules grouped by day. */
export function daysOf({ sharp, granules, bbox, start, end }) {
  return sharp ? sharpDays(sharp, bbox, start, end) : groupByDay(granules, bbox);
}

/**
 * Granule ids to render (SME2), in the order they're wanted now. The time
 * slider wants every pass (for scrubbing and charts), the shown day first;
 * the mosaic only wants its tiles.
 */
export function sme2Priority({ mode, mosaic, day, days }) {
  if (mode === "mosaic") return mosaic ? [...mosaic.tiles].reverse().map((t) => t.granule.id) : [];
  const shown = day ? day.granules.map((it) => it.granule.id) : [];
  const rest = days.slice().reverse().flatMap((d) => d.granules.map((it) => it.granule.id));
  return [...new Set([...shown, ...rest])];
}

/** One granule per track/frame with a browse image: their bounds are looked up once per frame. */
export function framesToPlace(granules) {
  const first = new Map();
  for (const g of granules) {
    if (g.browse_url && !first.has(frameKey(g.title))) first.set(frameKey(g.title), g);
  }
  return [...first];
}

/** Per-day SME2 values: valid-area-weighted mean of each image's median. */
export function buildSme2Charts(days, sme2) {
  const charts = [];
  for (const m of SME2_METRICS) {
    const points = days.map((d) => sme2DayValue(d, sme2, m.id)).filter(Boolean);
    if (!points.length) continue;
    const series = { ...m, points };
    const chart = charts.find((c) => c.unit === m.unit);
    if (chart) chart.series.push(series);
    else charts.push({ unit: m.unit, series: [series] });
  }
  return charts;
}

function sme2DayValue(day, sme2, metric) {
  let sum = 0;
  let weight = 0;
  for (const it of day.granules) {
    const r = sme2[it.granule.id];
    const v = r?.values?.[metric];
    if (v === undefined) continue;
    const valid = metric === "soil_moisture" ? r.valid_pct?.soil_moisture : r.valid_pct?.backscatter;
    const w = (it.share || 1e-6) * (valid ?? 1);
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? { date: day.date, value: Math.round((sum / weight) * 1000) / 1000 } : null;
}

/**
 * Where one granule's image comes from: { raw, bounds, exact }, or null
 * while it isn't ready (or there is none).
 */
export function sourceOf(g, { isSme2, sme2, layer, bbox, frameBounds }) {
  if (g.sharp) return { raw: g.sharp.image_url, bounds: g.site.bbox, exact: true };
  if (isSme2) {
    const r = sme2[g.id];
    const path = r?.images?.[layer === "soil_moisture" ? "soil_moisture" : "backscatter"];
    // Whole-frame images (image_bbox); the map clips them to the area.
    return path ? { raw: path, bounds: r.image_bbox ?? r.bbox ?? bbox, exact: true } : null;
  }
  if (!g.browse_url) return null;
  const b = frameBounds[frameKey(g.title)];
  return b?.bbox ? { raw: g.browse_url, bounds: b.bbox, exact: b.exact } : null;
}

/** Every image the view may draw, newest day first, as `{ url }` for the layer mapper. */
export function imageItems(days, source) {
  return [...days]
    .reverse()
    .flatMap((d) => d.granules.map((it) => source(it.granule)?.raw))
    .filter(Boolean)
    .map((raw) => ({ url: assetUrl(raw) }));
}

/** The mosaic's images and each date's outline. */
function mosaicLayers(mosaic, { source, shown, layer }) {
  const tiles = [];
  for (const t of mosaic.tiles) {
    const src = source(t.granule);
    // Whole footprint, drawn oldest first: newer passes cover older ones,
    // and older ones fill a newer pass's no-data edges.
    if (src) tiles.push({ key: `m-${t.granule.id}-${layer}`, url: shown(src.raw), bounds: src.bounds, clip: t.full });
  }
  const outlines = mosaic.days.map((d) => ({
    key: `d-${d.date}`,
    positions: toLatLngs(d.region),
    color: d.color,
    weight: 2.5,
    label: `${d.date} · ${pct(d.share)} of the area`,
  }));
  return { tiles, outlines };
}

/** One day's images, each clipped to its footprint, and the footprints outlined. */
function dayLayers(day, { source, shown, layer }) {
  const tiles = [];
  const outlines = [];
  for (const it of [...day.granules].reverse()) {
    const src = source(it.granule);
    if (src) tiles.push({ key: `t-${it.granule.id}-${layer}`, url: shown(src.raw), bounds: src.bounds, clip: it.region });
    if (it.granule.sharp) continue;
    outlines.push({
      key: `f-${it.granule.id}`,
      positions: toLatLngs(it.region),
      color: "#e2e8f0",
      weight: 1,
      dashed: true,
      label: `${it.granule.product} ${day.date} · frame ${frameKey(it.granule.title)}`,
    });
  }
  return { tiles, outlines };
}

/** What the explorer puts on the map: { tiles, outlines, opacity, mode }. */
export function mapLayersOf({ mode, mosaic, day, opacity, ...draw }) {
  let layers = { tiles: [], outlines: [] };
  if (mode === "mosaic" && mosaic) layers = mosaicLayers(mosaic, draw);
  else if (day) layers = dayLayers(day, draw);
  return { ...layers, opacity, mode };
}

/** One scene per day for the player: its date, quality and first ready image. */
export function scenesOf(days, source) {
  return days.map((d) => ({
    date: d.date,
    quality: d.granules[0].granule.quality,
    image_url: d.granules.map((it) => source(it.granule)).find(Boolean)?.raw ?? null,
  }));
}

/** Layers to choose from: only those the data can supply. */
export function layerOptionsOf({ sharp, isSme2, sme2 }) {
  if (sharp) return imageLayerOptions();
  if (!isSme2) return null;
  const loaded = Object.values(sme2).filter((r) => r && !r.error);
  return [
    ...imageLayerOptions(),
    {
      id: "soil_moisture",
      label: SME2_LAYERS.soil_moisture.label,
      // Known only once passes have rendered: gray it out if none has it.
      disabled: loaded.length > 0 && !loaded.some((r) => r.images?.soil_moisture),
      reason: "none retrieved here",
    },
  ];
}

/** The legend under the player: { ramp, text }. */
export function legendOf({ layer, isSme2, sharp, noBrowse, product, backscatterLegend }) {
  if (layer === "soil_moisture") {
    return { ramp: SME2_LAYERS.soil_moisture.ramp ?? null, text: SME2_LAYERS.soil_moisture.legend };
  }
  if (isSme2) return layerLegend(layer, `${SME2_LAYERS.backscatter.note} ${backscatterLegend ?? ""}`.trim());
  if (sharp) return layerLegend(layer, `${backscatterLegend ?? ""} ~${sharp.pixel_m} m pixels, frame ${sharp.frame}.`.trim());
  if (noBrowse) return { ramp: null, text: `${product} has no browse images; footprints are outlined instead.` };
  return { ramp: null, text: "NASA browse images, clipped to each footprint." };
}

/** How the SME2 renders are going: a missing login, failed passes, and progress on what the view needs. */
export function sme2Status(sme2, priority) {
  const results = Object.values(sme2);
  return {
    blocking: results.find((r) => r?.status === 503) ?? null,
    failures: results.filter((r) => r?.error && r.status !== 503),
    done: priority.filter((id) => sme2[id]).length,
    total: priority.length,
  };
}

/** "3 images on 2026-10-13, covering 74% of the area (dashed outlines)." */
export function dayNote(day, sharp) {
  if (sharp) return `Sharp render of ${day.date}, ~${sharp.pixel_m} m pixels.`;
  const n = day.granules.length;
  const share = Math.min(1, day.granules.reduce((s, it) => s + it.share, 0));
  return `${n} image${n === 1 ? "" : "s"} on ${day.date}, covering ${pct(share)} of the area (dashed outlines).`;
}

export { buildMosaic };
