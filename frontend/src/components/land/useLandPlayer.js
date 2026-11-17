// A land-change place's player, owned by the workspace: which two passes are
// compared, which layer is shown, the change map between them, and the image
// that goes on the map. The workspace keeps the choices (dates, layer, the
// area-wide shift) in its selection state, so the map, the story panel and
// the tour read the same values the player shows; LandPlayer just draws them.

import { useEffect, useMemo, useState } from "react";

import { assetUrl } from "../../services/api.js";
import {
  createChangeMaps,
  loadLayer as defaultLoadLayer,
  toDataUrl as defaultToDataUrl,
} from "../../services/landchange.js";
import { useLayerMapper } from "../../services/layers.js";

const NO_PASSES = [];

/**
 * The two passes compared: the dates chosen (each may be missing), else the
 * place's suggested pair, else its first and last. As indexes into `passes`.
 */
export function comparedPair(site, chosen) {
  const dates = (site?.passes ?? NO_PASSES).map((p) => p.date);
  const at = (date, fallback) => (dates.includes(date) ? dates.indexOf(date) : fallback);
  return {
    dates,
    from: at(chosen?.from ?? site?.suggested?.[0], 0),
    to: at(chosen?.to ?? site?.suggested?.[1], dates.length - 1),
  };
}

/**
 * The change map between two passes: the one asked for if it is built,
 * otherwise the last one shown, so the map and the numbers never blank
 * while the next is computed. `pending` says a newer one is on its way.
 */
function useChangeMap(maps, from, to, removeShift, enabled) {
  // The last result that arrived, with the settings it was built for.
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    maps.get(from, to, removeShift).then((result) => {
      if (live) setLast({ ...result, from: from?.date, to: to?.date, removeShift, maps });
    });
    return () => {
      live = false;
    };
  }, [maps, from, to, removeShift, enabled]);
  if (!enabled) return { result: null, pending: false };
  // A map that is already built is used at once, so playback never dims.
  const built = maps.peek(from, to, removeShift);
  const result = built ?? (last?.maps === maps ? last : null);
  const matches = Boolean(result) && result.from === from?.date && result.to === to?.date && result.removeShift === removeShift;
  return { result, pending: !(built || matches) };
}

/** Each pass's colour image, drawn grey where only HH was collected (no HV to show). */
function passImages(passes) {
  return passes.map((p) => ({ url: assetUrl(p.image_url), grey: !/HV/.test(p.polarizations ?? "HH+HV") }));
}

/**
 * @param {object} options
 * @param {object | null} options.site  the place (null: none open)
 * @param {object | null} options.dates  { from?, to? } chosen dates
 * @param {string | null} options.layer  the layer chosen (null: the place's starting one)
 * @param {boolean} options.removeShift  subtract the area-wide brightness shift from change maps
 * @param {Function} options.setDates  setter for `dates` (takes an updater)
 */
export function useLandPlayer({ site, dbRange, dates: chosen, layer: chosenLayer, removeShift, setDates, loadLayer = defaultLoadLayer, toDataUrl = defaultToDataUrl }) {
  const passes = site?.passes ?? NO_PASSES;
  const { dates, from, to } = comparedPair(site, chosen);
  const images = useMemo(() => passImages(passes), [passes]);
  const hvPasses = images.filter((it) => !it.grey).length;
  const everyHv = hvPasses === passes.length;
  // Where HV is missing on some passes, colour frames would alternate with
  // grey ones and look like change: start in HH, which every pass has.
  const layer = chosenLayer ?? (everyHv ? "colour" : "hh");
  const changing = layer === "change";
  const mapUrl = useLayerMapper(changing ? "colour" : layer, images);
  const maps = useMemo(
    () => createChangeMaps({ load: loadLayer, draw: toDataUrl, urlOf: assetUrl, range: dbRange }),
    [loadLayer, toDataUrl, dbRange],
  );
  const change = useChangeMap(maps, passes[from], passes[to], removeShift, changing);
  // Until the first change map is built, the pass's own image stays on the map.
  const image = passes[to] ? mapUrl(assetUrl(passes[to].image_url)) : null;
  const overlayUrl = (changing && change.result?.url) || image;
  const bbox = site?.bbox;
  const overlay = useMemo(() => (overlayUrl ? { url: overlayUrl, bbox } : null), [overlayUrl, bbox]);

  // Move either end of the comparison (by index, or an updater of it, as the player's bar does).
  const move = (end, fallback) => (next) => setDates((d) => {
    const current = comparedPair(site, d)[end] ?? fallback;
    const index = typeof next === "function" ? next(current) : next;
    return { ...d, [end]: dates[index] };
  });

  return {
    site,
    passes,
    dates,
    from,
    to,
    compared: { from: dates[from], to: dates[to] },
    layer,
    changing,
    everyHv,
    hvPasses,
    mapUrl,
    maps,
    removeShift,
    change,
    overlay,
    setFrom: move("from", from),
    setTo: move("to", to),
  };
}
