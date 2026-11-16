import { useEffect, useMemo, useState } from "react";

import { assetUrl } from "../services/api.js";
import { imageLayerOptions, layerLegend, useLayerMapper } from "../services/layers.js";
import {
  CHANGE_LIMIT_DB,
  CHANGED_DB,
  createChangeMaps,
  loadLayer as defaultLoadLayer,
  toDataUrl as defaultToDataUrl,
} from "../services/landchange.js";
import ScenePlayer from "./ScenePlayer.jsx";

const CHANGE_RAMP = {
  className: "ramp-change",
  labels: [`−${CHANGE_LIMIT_DB} dB (darker)`, "no change", `+${CHANGE_LIMIT_DB} dB (brighter)`],
};

/**
 * The change map between two passes: the one asked for if it is built,
 * otherwise the last one shown, so the map and the numbers never blank
 * while the next is computed. `pending` says a newer one is on its way.
 */
function useChangeMap(maps, from, to, removeShift, enabled) {
  // The last result that arrived, with the settings it was built for.
  const [last, setLast] = useState(null);
  const fromDate = from?.date;
  const toDate = to?.date;
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    maps.get(from, to, removeShift).then((result) => {
      if (live) setLast({ ...result, from: fromDate, to: toDate, removeShift, maps });
    });
    return () => {
      live = false;
    };
    // A pass is named by its date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, fromDate, toDate, removeShift, enabled]);
  if (!enabled) return { result: null, pending: false };
  // A map that is already built is used at once, so playback never dims.
  const built = maps.peek(from, to, removeShift);
  const result = built ?? (last?.maps === maps ? last : null);
  const current =
    Boolean(built) ||
    (Boolean(result) && result.from === fromDate && result.to === toDate && result.removeShift === removeShift);
  return { result, pending: !current };
}

/**
 * A land-change place's passes, in the dock under the map: play or scrub
 * through the dates, pick a layer, and compare two dates as images or as a
 * change map computed in the browser. The map overlay goes to the parent
 * through `onOverlay`. It lives in the dock, not in the side panel, so the
 * dates, layer and playback carry over when the panel changes.
 */
export default function LandPlayer({
  site,
  dbRange,
  opacity,
  onOpacityChange,
  onOverlay,
  colourLegend,
  // The layer, when the parent picks it too (the panel's "Show the change
  // map"); null is this place's starting layer.
  layer: layerProp = null,
  onLayerChange = null,
  onDatesChange = null, // ({ from, to }) the two dates compared, as they change
  focus = null, // { date, n }: show this date on the bar (the tour)
  guideDates = null, // dates to mark on the bar with yellow lines (the tour)
  loadLayer = defaultLoadLayer,
  toDataUrl = defaultToDataUrl,
}) {
  const passes = site.passes;
  const dates = passes.map((p) => p.date);
  const idx = (d, fallback) => (dates.includes(d) ? dates.indexOf(d) : fallback);
  const [from, setFrom] = useState(() => idx(site.suggested?.[0], 0));
  const [to, setTo] = useState(() => idx(focus?.date ?? site.suggested?.[1], dates.length - 1));
  const focusDate = focus?.date;
  const focusN = focus?.n;
  useEffect(() => {
    if (focusDate && dates.includes(focusDate)) setTo(dates.indexOf(focusDate));
    // A new request (n), not a new `dates` array, moves the bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDate, focusN]);
  const fromDate = dates[from];
  const toDate = dates[to];
  useEffect(() => {
    onDatesChange?.({ from: fromDate, to: toDate });
  }, [fromDate, toDate, onDatesChange]);
  // HH-only passes are drawn grey: there is no HV to show on them.
  const imageItems = useMemo(
    () => passes.map((p) => ({ url: assetUrl(p.image_url), grey: !/HV/.test(p.polarizations ?? "HH+HV") })),
    [passes],
  );
  const hvPasses = imageItems.filter((it) => !it.grey).length;
  const everyHv = hvPasses === passes.length;
  // "colour", "hh", "hv", "water" (image layers) or "change" (the change map).
  // Where HV is missing on some passes, colour frames would alternate with
  // grey ones and look like change: start in HH, which every pass has.
  const [ownLayer, setOwnLayer] = useState(null);
  const layer = layerProp ?? ownLayer ?? (everyHv ? "colour" : "hh");
  const setLayer = onLayerChange ?? setOwnLayer;
  const changing = layer === "change";
  // Subtract the area-wide brightness shift (season, moisture, snow).
  const [removeShift, setRemoveShift] = useState(true);
  const mapUrl = useLayerMapper(changing ? "colour" : layer, imageItems);
  const layers = [
    ...imageLayerOptions({ hh: true, hv: everyHv }).map((l) =>
      l.id === "colour" && hvPasses === 0 ? { ...l, disabled: true, reason: "no HV data" } : l),
    { id: "change", label: "Change map", disabled: !passes[from]?.hh_url, reason: "no HH layer" },
  ];
  const scenes = useMemo(
    () => passes.map((p) => ({ date: p.date, quality: p.quality, image_url: p.image_url })),
    [passes],
  );

  const maps = useMemo(
    () => createChangeMaps({ load: loadLayer, draw: toDataUrl, urlOf: assetUrl, range: dbRange }),
    [loadLayer, toDataUrl, dbRange],
  );
  const { result, pending } = useChangeMap(maps, passes[from], passes[to], removeShift, changing);

  // Until the first change map is built, the pass's own image stays on the map.
  const imageOverlay = mapUrl(assetUrl(passes[to]?.image_url));
  const overlayUrl = changing ? result?.url ?? imageOverlay : imageOverlay;
  useEffect(() => {
    onOverlay(overlayUrl ? { url: overlayUrl, bbox: site.bbox } : null);
  }, [overlayUrl, site.bbox, onOverlay]);
  useEffect(() => () => onOverlay(null), [onOverlay]);

  const event = site.event;
  const dateLabel = event ? (s) => (s.date >= event.date ? " (after)" : " (before)") : null;

  let note = null;
  if (changing) {
    const shifted = removeShift && result && !result.error && Math.abs(result.shift) >= 0.1;
    note = (
      <>
        <label className="change-from">
          Change since
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="Change since">
            {scenes.map((s, i) => (
              <option key={s.date} value={i}>{s.date}{dateLabel?.(s) ?? ""}</option>
            ))}
          </select>
        </label>
        <span className="change-figure" data-pending={pending || undefined}>
          {result?.error
            ? result.error
            : result
            ? `${result.changedPct.toFixed(1)}% of the land changed by more than ${CHANGED_DB} dB${
              shifted ? `, after removing an area-wide ${result.shift > 0 ? "+" : "−"}${Math.abs(result.shift).toFixed(1)} dB` : ""
            }`
            : "Building the change map…"}
        </span>
        <span className="change-key" aria-hidden="true">
          <i className="key-darker" />darker <i className="key-brighter" />brighter
        </span>
      </>
    );
  } else if (layer === "colour" && !everyHv) {
    note = "Grey frames are passes where only HH was collected.";
  }

  const legend = changing
    ? "Red: brighter than on the “since” date. Blue: darker. Wet ground and wind on water also change brightness; water that is dark on both dates is left out of the percentage."
    : layerLegend(layer, colourLegend).text;
  const legendExtra = changing ? (
    <label className="small change-shift">
      <input type="checkbox" checked={removeShift} onChange={(e) => setRemoveShift(e.target.checked)} />
      Remove the area-wide shift (season, moisture, snow)
    </label>
  ) : null;

  return (
    <ScenePlayer
      scenes={scenes}
      index={to}
      onIndexChange={setTo}
      before={from}
      onBeforeChange={setFrom}
      opacity={opacity}
      onOpacityChange={onOpacityChange}
      product="GCOV"
      title={`${site.name}: NISAR images over time`}
      legend={legend}
      ramp={changing ? CHANGE_RAMP : layerLegend(layer).ramp}
      legendExtra={legendExtra}
      layers={layers}
      layer={layer}
      onLayerChange={setLayer}
      imageUrl={mapUrl}
      ready={changing ? (i) => maps.get(passes[from], passes[i], removeShift) : null}
      loopFrom={changing && from < passes.length - 1 ? from + 1 : 0}
      note={note}
      dateLabel={dateLabel}
      guide={guideDates?.filter((d) => dates.includes(d)).map((d) => ({ index: dates.indexOf(d), label: d }))}
      docked
    />
  );
}
