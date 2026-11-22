import { createPortal } from "react-dom";

import { useCatalogContext } from "./catalog/CatalogContext.js";
import { dayNote, pct } from "./catalog/explorer.js";
import LayerSelect from "./LayerSelect.jsx";
import ScenePlayer from "./ScenePlayer.jsx";
import TimeSeriesChart from "./TimeSeriesChart.jsx";

const MODES = [
  ["time", "Time slider"],
  ["mosaic", "Mosaic (newest first)"],
];

function ModeControls({ mode, onChange }) {
  return (
    <div className="layer-toggle" role="group" aria-label="NISAR view">
      {MODES.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`btn btn-small ${id === mode ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={id === mode}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MosaicLegend({ ramp, legend }) {
  return (
    <div className="scene-legend small">
      {ramp && (
        <>
          <div className={`ramp ${ramp.className}`} aria-hidden="true" />
          <div className="ramp-labels muted">
            {ramp.labels.map((l) => <span key={l}>{l}</span>)}
          </div>
        </>
      )}
      <p className="muted">{legend}</p>
    </div>
  );
}

function MosaicPanel({ mosaic, product, opacity, onOpacityChange, legend, onSelectDate }) {
  const n = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return (
    <div className="mosaic">
      <h3>Newest {product} data across the area</h3>
      <p className="small">
        Covers <strong>{pct(mosaic.coverage)}</strong> of the area with {n(mosaic.tiles.length, "image")} from{" "}
        {n(mosaic.days.length, "date")}. Newer passes are on top; coloured outlines mark where each date takes over.
      </p>
      {mosaic.coverage < 0.995 && (
        <p className="warning small">
          {pct(1 - mosaic.coverage)} of the area has no {product} data in these dates. Widen the date range to fill it.
        </p>
      )}
      <ul className="mosaic-days small">
        {mosaic.days.map((d) => (
          <li key={d.date}>
            <button type="button" className="btn btn-link" onClick={() => onSelectDate(d.date)} title="Show this date in the time slider">
              <span className="swatch" style={{ background: d.color }} />
              {d.date}
            </button>{" "}
            <span className="muted">
              {pct(d.share)}
              {d.count > 1 ? ` · ${d.count} frames` : ""}
            </span>
          </li>
        ))}
      </ul>
      <label className="small opacity">
        Map overlay opacity
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => onOpacityChange(Number(e.target.value))} />
      </label>
      <MosaicLegend ramp={legend.ramp} legend={legend.text} />
    </div>
  );
}

function Sme2Charts({ charts, date, onSelectDate }) {
  if (!charts.length) return null;
  return (
    <>
      <h3>Measured values</h3>
      {charts.map((chart) => (
        <TimeSeriesChart
          key={chart.unit}
          series={chart.series}
          unit={chart.unit}
          title={chart.series.map((s) => s.label).join(", ")}
          selectedDate={date ?? null}
          onSelectDate={onSelectDate}
        />
      ))}
      <p className="muted small provenance">
        Area medians, averaged per day. Provisional; SME2 retrieval-quality flags are not applied.
        Fill/non-finite values and swath edges are masked.
      </p>
    </>
  );
}

/** A missing login, SME2 progress, failed images and approximate placement. */
function ExplorerStatus({ view }) {
  const { blocking, failures, done, total } = view.sme2Status;
  return (
    <>
      {blocking && <p className="error">{blocking.error}</p>}
      {view.isSme2 && !blocking && done < total && (
        <p className="muted small" role="status">
          Loading SME2 images: {done} of {total}… (passes not prepared in advance take ~10 s each the first time)
        </p>
      )}
      {failures.length > 0 && (
        <p className="warning small">
          {failures.length} image{failures.length === 1 ? "" : "s"} could not be shown ({failures[0].error}).
        </p>
      )}
      {view.approximate && <p className="warning small">Some images are placed approximately.</p>}
    </>
  );
}

/** The time slider's player for the shown day and layer. */
function ExplorerPlayer({ view, actions, opacity, onOpacityChange, docked }) {
  return (
    <ScenePlayer
      key={view.layer === "soil_moisture" ? "soil" : "backscatter"}
      layers={view.layerOptions}
      layer={view.layer}
      onLayerChange={actions.setLayer}
      imageUrl={view.mapUrl}
      title={`${view.product} images over time`}
      scenes={view.scenes}
      index={view.current}
      onIndexChange={actions.setIndex}
      opacity={opacity}
      onOpacityChange={onOpacityChange}
      product={view.product}
      ramp={view.legend.ramp}
      legend={view.legend.text}
      // Sharp imagery is a set of small local files: fetch them all, so playback never waits.
      preload={view.isSme2 || Boolean(view.sharp)}
      docked={docked}
    />
  );
}

/** The time slider's day: its player (unless docked under the map), what it shows, and SME2's values. */
function TimeView({ view, actions, player, docked }) {
  return (
    <>
      {!docked && player}
      {view.day && <p className="muted small">{dayNote(view.day, view.sharp)}</p>}
      {view.isSme2 && <Sme2Charts charts={view.sme2Charts} date={view.day?.date} onSelectDate={actions.selectDate} />}
    </>
  );
}

/**
 * Every image of one NISAR product over an area, two ways:
 *
 *  - Time slider (default): one step per acquisition day; all of that
 *    day's images are drawn, each clipped to its footprint in the area.
 *  - Mosaic: the area tiled with the newest data (each granule only where
 *    nothing newer covers), with each acquisition day's part outlined.
 *
 * L2 products show NASA's browse images, unless sharp imagery was rendered
 * for this area (the guided tour's box, a gallery-style site); SME2 passes
 * are rendered by the backend (backscatter in the crop sites' colours, or
 * soil moisture). Backscatter images can be viewed as HH, HV or the
 * open-water mask (see services/layers.js). The view is the workspace's
 * (catalog/useExplorer.js, through CatalogContext): it also draws the map.
 * With `timelineHost`, the player and view controls sit under the map.
 */
export default function DataExplorer({ opacity, onOpacityChange, timelineHost }) {
  const { view, actions } = useCatalogContext();
  if (!view.days.length) {
    return <p className="muted small">No {view.product} data covers this area in the selected dates.</p>;
  }
  const docked = Boolean(timelineHost);
  const player = <ExplorerPlayer view={view} actions={actions} opacity={opacity} onOpacityChange={onOpacityChange} docked={docked} />;
  const modeControls = view.sharp ? null : <ModeControls mode={view.mode} onChange={actions.setMode} />;
  const timeView = view.mode === "time";
  return (
    <section className="explorer" aria-label={`${view.product} data over this area`}>
      {docked
        ? createPortal(
          <>
            {modeControls && <div className="map-view-controls">{modeControls}</div>}
            {timeView && player}
          </>,
          timelineHost,
        )
        : modeControls}
      {!timeView && <LayerSelect layers={view.layerOptions} value={view.layer} onChange={actions.setLayer} />}
      <ExplorerStatus view={view} />
      {timeView && <TimeView view={view} actions={actions} player={player} docked={docked} />}
      {!timeView && view.mosaic && (
        <MosaicPanel
          mosaic={view.mosaic}
          product={view.product}
          opacity={opacity}
          onOpacityChange={onOpacityChange}
          legend={view.legend}
          onSelectDate={actions.selectDate}
        />
      )}
    </section>
  );
}
