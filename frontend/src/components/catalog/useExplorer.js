import { useMemo } from "react";

import { assetUrl } from "../../services/api.js";
import { useLayerMapper } from "../../services/layers.js";
import { browseBoundsQuery, sme2SceneQuery } from "../../services/queries.js";
import { useQueuedQueries } from "../../services/useQueuedQueries.js";
import {
  buildMosaic,
  buildSme2Charts,
  daysOf,
  framesToPlace,
  imageItems,
  layerOptionsOf,
  legendOf,
  mapLayersOf,
  scenesOf,
  sme2Priority,
  sme2Status,
  sourceOf,
} from "./explorer.js";

// SME2 passes are rendered by the backend (a few seconds each).
const SME2_CONCURRENCY = 2;
// Browse-image bounds requests in flight at once: a large area spans dozens
// of frames, and each uncached one costs the backend up to three NASA requests.
const BOUNDS_CONCURRENCY = 6;

/** Exact browse-image bounds per track/frame (the footprint's bbox, flagged approximate, if they can't be had). */
function useFrameBounds(granules, active) {
  const frames = active ? framesToPlace(granules) : [];
  const lookups = frames.filter(([, g]) => g.browse_kml_url);
  const results = useQueuedQueries(lookups.map(([, g]) => browseBoundsQuery(g.browse_kml_url)), BOUNDS_CONCURRENCY);
  const answers = new Map(lookups.map(([key], i) => [key, results[i]]));
  const bounds = {};
  for (const [key, g] of frames) {
    const r = answers.get(key);
    if (!r) bounds[key] = { bbox: g.bbox, exact: false };
    else if (r.data) bounds[key] = { bbox: r.data, exact: true };
    else if (r.isError) bounds[key] = { bbox: g.bbox, exact: false };
  }
  return bounds;
}

/**
 * SME2 passes rendered over the area, most wanted first and a couple at a
 * time; after a missing login (503) none more are asked for, as each would
 * fail the same way. Granule id → scene, or { error, status }.
 */
function useSme2Scenes(priority, granules, bbox, active) {
  const byId = new Map(granules.map((g) => [g.id, g]));
  const ids = active ? priority.filter((id) => byId.has(id)) : [];
  const queries = ids.map((id) => sme2SceneQuery({ granule: byId.get(id).title, bbox }));
  const results = useQueuedQueries(queries, SME2_CONCURRENCY, { haltWhen: (state) => state?.error?.status === 503 });
  const scenes = {};
  ids.forEach((id, i) => {
    const r = results[i];
    if (r.data) scenes[id] = r.data;
    else if (r.error) scenes[id] = { error: r.error.message || "Failed", status: r.error.status };
  });
  return scenes;
}

/** The days (or mosaic) of these results, and the day shown. */
function useDays({ product, granules, bbox, imagery, start, end, ui }) {
  const isSme2 = product === "SME2";
  const sharp = product === "GCOV" && imagery?.passes?.length ? imagery : null;
  // One frame's images can't be mosaicked.
  const mode = sharp ? "time" : ui.mode;
  const days = useMemo(() => daysOf({ sharp, granules, bbox, start, end }), [sharp, granules, bbox, start, end]);
  const mosaic = useMemo(() => (mode === "mosaic" ? buildMosaic(granules, bbox) : null), [mode, granules, bbox]);
  const current = ui.index === null ? days.length - 1 : Math.min(ui.index, days.length - 1);
  return { isSme2, sharp, browse: !isSme2 && !sharp, mode, layer: ui.layer, days, mosaic, current, day: days[current] ?? null };
}

/**
 * Where each granule's image is, and its URL for the layer shown:
 * backscatter images can be drawn as HH, HV or the open-water mask.
 */
function useImages(base, { sme2, frameBounds, bbox }) {
  const { isSme2, sharp, layer, days } = base;
  const source = (g) => sourceOf(g, { isSme2, sme2, layer, bbox, frameBounds });
  const drawn = Boolean(sharp || isSme2) && layer !== "soil_moisture";
  const mapUrl = useLayerMapper(drawn ? layer : "colour", drawn ? imageItems(days, source) : []);
  const shown = (path) => (drawn ? mapUrl(assetUrl(path)) : assetUrl(path));
  return { source, shown, mapUrl: drawn ? mapUrl : undefined };
}

/** What the explorer puts on the map, kept the same object until it changes. */
function useMapLayers(base, images, opacity) {
  const { mode, mosaic, day, layer } = base;
  const json = JSON.stringify(mapLayersOf({ mode, mosaic, day, opacity, source: images.source, shown: images.shown, layer }));
  return useMemo(() => JSON.parse(json), [json]);
}

/** The view the explorer's panel, the map and the evidence card read. */
function explorerView({ base, images, product, granules, sme2, priority, frameBounds, sme2Charts, mapLayers, backscatterLegend }) {
  const { isSme2, sharp, mode, layer, days, day, browse } = base;
  const noBrowse = browse && !granules.some((g) => g.browse_url);
  return {
    ...base,
    product,
    mapLayers,
    mapUrl: images.mapUrl,
    scenes: scenesOf(days, images.source),
    sme2Charts,
    sme2Status: sme2Status(sme2, priority),
    layerOptions: layerOptionsOf({ sharp, isSme2, sme2 }),
    legend: legendOf({ layer, isSme2, sharp, noBrowse, product, backscatterLegend }),
    approximate: browse && Object.values(frameBounds).some((b) => !b.exact),
    // What the evidence card charts for the area: the soil-moisture series and the day shown.
    observation: {
      date: mode === "time" ? day?.date ?? null : null,
      series: sme2Charts.flatMap((c) => c.series).find((s) => s.id === "soil_moisture"),
      dates: days.map((d) => d.date),
      product,
      mode,
    },
  };
}

/**
 * Everything the catalog explorer shows for a set of results: the days (or
 * mosaic), the images ready for them, what goes on the map, the scenes for
 * the player, the SME2 charts and series, the legend and the status lines.
 * `ui` is the viewer's choice of view ({ mode, index, layer }).
 */
export function useExplorer({ product, granules, bbox, imagery, start, end, ui, opacity, backscatterLegend }) {
  const base = useDays({ product, granules, bbox, imagery, start, end, ui });
  const priority = sme2Priority(base);
  const sme2 = useSme2Scenes(priority, granules, bbox, base.isSme2);
  const frameBounds = useFrameBounds(granules, base.browse);
  const images = useImages(base, { sme2, frameBounds, bbox });
  const mapLayers = useMapLayers(base, images, opacity);
  const sme2Charts = useMemo(() => (base.isSme2 ? buildSme2Charts(base.days, sme2) : []), [base.isSme2, base.days, sme2]);
  return explorerView({ base, images, product, granules, sme2, priority, frameBounds, sme2Charts, mapLayers, backscatterLegend });
}
