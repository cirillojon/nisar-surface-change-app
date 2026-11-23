import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  HEATMAP_BOUNDS,
  decodeGrid,
  formatValue,
  heatmapImage,
  legendGradient,
  monthLabel,
  rangeOf,
  valueAt,
} from "../services/coverageMap.js";
import { formatLatLon } from "../services/orbit.js";
import { coverageMapGridQuery, coverageMapInfoQuery } from "../services/queries.js";
import { usePlayback } from "../services/usePlayback.js";

// Image sizes: 2D map pixels per degree are doubled so 1° cells stay square-edged.
const IMAGE_SIZE = { mercator: { width: 720, height: 720 }, geographic: { width: 720, height: 360 } };

const dayLabel = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What the hovered cell holds, in words. */
function Readout({ grid, values, pointer }) {
  if (!pointer) return <p className="map-layer-note">Point at the map to read a cell.</p>;
  const value = valueAt(grid, values, pointer.lat, pointer.lon);
  const where = formatLatLon(pointer.lat, pointer.lon);
  const text = Number.isFinite(value)
    ? `${formatValue(value, grid.metric)} ${grid.unit}`
    : grid.metric === "days_since"
      ? "never imaged up to then"
      : "no passes";
  return (
    <p className="map-layer-readout" aria-live="polite">
      <span>{where}</span> <strong>{text}</strong>
    </p>
  );
}

function Legend({ grid }) {
  const [lo, hi] = rangeOf(grid);
  const capped = grid.metric !== "ascending_pct" && (grid.stats?.max ?? 0) > hi;
  return (
    <div className="map-layer-legend">
      <span className="map-layer-gradient" style={{ background: legendGradient(grid.metric) }} aria-hidden="true" />
      <span className="map-layer-scale">
        <span>{grid.metric === "ascending_pct" ? "0% (all descending)" : formatValue(lo, grid.metric)}</span>
        <span>
          {grid.metric === "ascending_pct" ? "100% (all ascending)" : `${capped ? "≥ " : ""}${formatValue(hi, grid.metric)} ${grid.unit}`}
        </span>
      </span>
    </div>
  );
}

/**
 * The global coverage heatmap's controls: product, metric, period and month
 * (with a play button), the legend and the value under the pointer. The
 * image itself goes to the map through `onLayer` ({ url, bbox, opacity }),
 * drawn for the 2D map or, with `globe`, for the 3D globe.
 */
export default function CoveragePanel({ globe = false, pointer = null, onLayer, onClose }) {
  const info = useQuery(coverageMapInfoQuery());
  const queryClient = useQueryClient();
  const [product, setProduct] = useState("GCOV");
  const [metric, setMetric] = useState("passes");
  const [span, setSpan] = useState("month");
  const [monthIndex, setMonthIndex] = useState(null);
  const [opacity, setOpacity] = useState(0.8);

  const months = info.data?.months ?? [];
  const index = monthIndex ?? months.length - 1;
  const month = months[index];
  const params = { product, metric, window: span };
  const grid = useQuery({ ...coverageMapGridQuery({ ...params, month }), placeholderData: keepPreviousData });
  const values = useMemo(() => (grid.data ? decodeGrid(grid.data) : null), [grid.data]);
  const projection = globe ? "geographic" : "mercator";
  const url = useMemo(
    () => (values ? heatmapImage(grid.data, values, { ...IMAGE_SIZE[projection], projection }) : null),
    [grid.data, values, projection],
  );

  useEffect(() => {
    onLayer?.(url ? { url, bbox: HEATMAP_BOUNDS[projection], opacity } : null);
  }, [onLayer, url, projection, opacity]);
  useEffect(() => () => onLayer?.(null), [onLayer]);

  const [playing, setPlaying] = usePlayback({
    count: months.length,
    index,
    ready: (i) => queryClient.fetchQuery(coverageMapGridQuery({ ...params, month: months[i] })),
    onIndexChange: setMonthIndex,
  });

  const products = Object.fromEntries((info.data?.products ?? []).map((p) => [p.id, p]));
  const metrics = Object.fromEntries((info.data?.metrics ?? []).map((m) => [m.id, m]));
  const shown = grid.data;
  return (
    <section id="coverage-panel" className="map-layer-panel" aria-labelledby="coverage-panel-title">
      <header>
        <h2 id="coverage-panel-title">NISAR coverage</h2>
        <button type="button" className="map-layer-close" onClick={onClose} aria-label="Close the coverage heatmap">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {info.isError && <p className="map-layer-note error">Couldn&apos;t load the coverage map: {info.error?.message}</p>}
      {info.isPending && <p className="map-layer-note">Loading…</p>}
      {info.data && (
        <>
          <div className="map-layer-fields">
            <label className="layer-select small">
              <span>Product</span>
              <select value={product} onChange={(e) => setProduct(e.target.value)}>
                {info.data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="layer-select small">
              <span>Metric</span>
              <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                {info.data.metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === "passes" && products[product]?.unit === "pairs" ? "Pairs" : m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="layer-select small">
              <span>Period</span>
              <select
                value={span}
                onChange={(e) => setSpan(e.target.value)}
                disabled={metric === "days_since"}
                title={metric === "days_since" ? "Days since the last pass always looks back through every earlier month." : undefined}
              >
                <option value="month">That month</option>
                <option value="cumulative">Every month up to it</option>
              </select>
            </label>
          </div>
          <p className="map-layer-note">{metrics[metric]?.description}</p>
          <div className="map-layer-time">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setPlaying((p) => !p)}
              aria-pressed={playing}
              aria-label={playing ? "Pause" : "Play through the months"}
            >
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, months.length - 1)}
              value={index}
              aria-label="Month"
              aria-valuetext={month ? monthLabel(month) : undefined}
              onChange={(e) => {
                setPlaying(false);
                setMonthIndex(Number(e.target.value));
              }}
            />
            <strong className="map-layer-when">{month ? monthLabel(month) : ""}</strong>
          </div>
          {shown && (
            <>
              <p className="map-layer-note">
                {dayLabel(shown.start)} – {dayLabel(shown.end)}
                {grid.isFetching ? " · loading…" : ` · ${shown.stats.cells.toLocaleString()} cells`}
              </p>
              <Legend grid={shown} />
              <Readout grid={shown} values={values} pointer={pointer} />
            </>
          )}
          {grid.isError && <p className="map-layer-note error">{grid.error?.message}</p>}
          <label className="map-layer-opacity small">
            <span>Opacity</span>
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Heatmap opacity" />
          </label>
          <details className="map-layer-about">
            <summary>About this map</summary>
            <p>
              Counted from every NISAR granule in NASA&apos;s catalog ({products[product]?.granules?.toLocaleString()} for this
              product) on {dayLabel(info.data.generated_at.slice(0, 10))}. A pass is one track on one day
              {products[product]?.unit === "pairs" ? " (here, one pair of dates)" : ""}; it counts for every 1° cell whose center
              its footprints cover, once however many frames or modes it has.
            </p>
            <p>Coverage shows where NISAR has data, not whether a product suits a question. Check an area in Investigate.</p>
          </details>
        </>
      )}
    </section>
  );
}
