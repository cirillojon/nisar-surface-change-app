import { imageLayerOptions, layerLegend } from "../services/layers.js";
import { CHANGE_LIMIT_DB, CHANGED_DB } from "../services/landchange.js";
import ScenePlayer from "./ScenePlayer.jsx";

const CHANGE_RAMP = {
  className: "ramp-change",
  labels: [`−${CHANGE_LIMIT_DB} dB (darker)`, "no change", `+${CHANGE_LIMIT_DB} dB (brighter)`],
};
const CHANGE_LEGEND =
  "Red: brighter than on the “since” date. Blue: darker. Wet ground and wind on water also change brightness; water that is dark on both dates is left out of the percentage.";

/** "4.2% of the land changed by more than 3 dB, after removing an area-wide +0.4 dB", or why not. */
function changeFigure(result, removeShift) {
  if (!result) return "Building the change map…";
  if (result.error) return result.error;
  const shift = removeShift && Math.abs(result.shift) >= 0.1
    ? `, after removing an area-wide ${result.shift > 0 ? "+" : "−"}${Math.abs(result.shift).toFixed(1)} dB`
    : "";
  return `${result.changedPct.toFixed(1)}% of the land changed by more than ${CHANGED_DB} dB${shift}`;
}

/** The tour's marked dates, as positions on the bar (dates the place doesn't have are left out). */
function guideMarks(guideDates, dates) {
  if (!guideDates) return undefined;
  const indexOf = new Map(dates.map((d, i) => [d, i]));
  return guideDates.filter((d) => indexOf.has(d)).map((d) => ({ index: indexOf.get(d), label: d }));
}

/** Layers the place can show: color (if any pass has HV), HH, HV (if every pass does), and the change map. */
function layersOf(player) {
  const { everyHv, hvPasses, passes, from } = player;
  return [
    ...imageLayerOptions({ hh: true, hv: everyHv }).map((l) =>
      l.id === "color" && hvPasses === 0 ? { ...l, disabled: true, reason: "no HV data" } : l),
    { id: "change", label: "Change map", disabled: !passes[from]?.hh_url, reason: "no HH layer" },
  ];
}

/** Under the bar while comparing: the "since" date, how much changed, and the color key. */
function ChangeNote({ player, scenes, dateLabel }) {
  const { from, change, removeShift, setFrom } = player;
  return (
    <>
      <label className="change-from">
        Change since
        <select value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="Change since">
          {scenes.map((s, i) => (
            <option key={s.date} value={i}>{s.date}{dateLabel?.(s) ?? ""}</option>
          ))}
        </select>
      </label>
      <span className="change-figure" data-pending={change.pending || undefined}>{changeFigure(change.result, removeShift)}</span>
      <span className="change-key" aria-hidden="true">
        <i className="key-darker" />darker <i className="key-brighter" />brighter
      </span>
    </>
  );
}

/**
 * A land-change place's passes, in the dock under the map: play or scrub
 * through the dates, pick a layer, and compare two dates as images or as a
 * change map computed in the browser. `player` is the workspace's view of
 * the place (components/land/useLandPlayer.js), which also puts its image on
 * the map; it lives in the dock, not in the side panel, so the dates, layer
 * and playback carry over when the panel changes.
 */
export default function LandPlayer({ player, opacity, onOpacityChange, onLayerChange, onRemoveShiftChange, colorLegend, guideDates = null, comparison = null }) {
  const { site, passes, dates, from, to, layer, changing, everyHv, mapUrl, maps, removeShift } = player;
  const scenes = passes.map((p) => ({ date: p.date, quality: p.quality, image_url: p.image_url }));
  const event = site.event;
  const dateLabel = event ? (s) => (s.date >= event.date ? " (after)" : " (before)") : null;
  let note = null;
  if (changing) note = <ChangeNote player={player} scenes={scenes} dateLabel={dateLabel} />;
  else if (layer === "color" && !everyHv) note = "Gray frames are passes where only HH was collected.";

  return (
    <ScenePlayer
      scenes={scenes}
      index={to}
      onIndexChange={player.setTo}
      before={from}
      onBeforeChange={player.setFrom}
      comparison={comparison}
      opacity={opacity}
      onOpacityChange={onOpacityChange}
      product="GCOV"
      title={`${site.name}: NISAR images over time`}
      legend={changing ? CHANGE_LEGEND : layerLegend(layer, colorLegend).text}
      ramp={changing ? CHANGE_RAMP : layerLegend(layer).ramp}
      legendExtra={changing && (
        <label className="small change-shift">
          <input type="checkbox" checked={removeShift} onChange={(e) => onRemoveShiftChange(e.target.checked)} />
          Remove the area-wide shift (season, moisture, snow)
        </label>
      )}
      layers={layersOf(player)}
      layer={layer}
      onLayerChange={onLayerChange}
      imageUrl={mapUrl}
      ready={changing ? (i) => maps.get(passes[from], passes[i], removeShift) : null}
      loopFrom={changing && from < passes.length - 1 ? from + 1 : 0}
      note={note}
      dateLabel={dateLabel}
      guide={guideMarks(guideDates, dates)}
      docked
    />
  );
}
