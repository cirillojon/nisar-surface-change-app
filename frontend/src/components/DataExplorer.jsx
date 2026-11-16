import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  assetUrl,
  fetchBrowseBounds,
  fetchSme2Scene,
} from "../services/api.js";
import { imageLayerOptions, layerLegend, useLayerMapper } from "../services/layers.js";
import {
  buildMosaic,
  frameKey,
  groupByDay,
  rectPolygon,
  toLatLngs,
} from "../services/regions.js";
import { SME2_LAYERS, SME2_METRICS } from "../services/sme2.js";
import LayerSelect from "./LayerSelect.jsx";
import ScenePlayer from "./ScenePlayer.jsx";
import TimeSeriesChart from "./TimeSeriesChart.jsx";

// SME2 passes are rendered by the backend (a few seconds each).
const SME2_CONCURRENCY = 2;
// Browse-image bounds requests in flight at once.
const BOUNDS_CONCURRENCY = 6;

/**
 * Days for sharp, pre-rendered imagery of this area (a gallery-style site):
 * one image per pass on one frame, shaped like `groupByDay`'s output.
 */
function sharpDays(site, bbox, range) {
  const region = rectPolygon(bbox);
  return site.passes
    .filter((p) => (!range?.start || p.date >= range.start) && (!range?.end || p.date <= range.end))
    .map((p) => ({
      date: p.date,
      granules: [{
        granule: { id: `sharp-${site.slug}-${p.date}`, product: "GCOV", title: site.frame, quality: p.quality, sharp: p, site },
        region,
        share: 1,
      }],
    }));
}

const pct = (share) =>
  share >= 0.995 ? "100%" : `${Math.max(0, share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

/**
 * Every image of one NISAR product over a rectangle, two ways:
 *
 *  - Time slider (default): one step per acquisition day; all of that
 *    day's images are drawn, each clipped to its footprint in the area.
 *  - Mosaic: the area tiled with the newest data (each granule only where
 *    nothing newer covers), with each acquisition day's part outlined.
 *
 * L2 products show NASA's browse images, unless sharp imagery was rendered
 * for this area (`imagery`: the guided tour's box, a gallery-style site);
 * SME2 passes are rendered by the backend (backscatter in the crop sites'
 * colours, or soil moisture). Backscatter images can be viewed as HH, HV or
 * the open-water mask (see services/layers.js). Map layers go to the parent
 * through `onMapLayers`.
 */
export default function DataExplorer({
  product,
  granules,
  bbox,
  opacity,
  onOpacityChange,
  onMapLayers,
  focus = null,
  backscatterLegend,
  onAreaSeries,
  timelineHost,
  imagery = null,
  dateRange = null,
}) {
  const isSme2 = product === "SME2";
  const sharp = product === "GCOV" && imagery?.passes?.length ? imagery : null;
  const [modeChoice, setMode] = useState("time");
  // One frame's images can't be mosaicked.
  const mode = sharp ? "time" : modeChoice;
  const [layer, setLayer] = useState("colour");
  const [index, setIndex] = useState(null); // null = newest day
  const [frameBounds, setFrameBounds] = useState({}); // frame -> {bbox, exact}
  const [sme2, setSme2] = useState({}); // granule id -> scene | {error}

  const days = useMemo(
    () => (sharp ? sharpDays(sharp, bbox, dateRange) : groupByDay(granules, bbox)),
    [sharp, granules, bbox, dateRange?.start, dateRange?.end], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mosaic = useMemo(
    () => (mode === "mosaic" ? buildMosaic(granules, bbox) : null),
    [mode, granules, bbox],
  );
  const last = days.length - 1;
  const current = index === null ? last : Math.min(index, last);
  const day = days[current] ?? null;
  const sme2Charts = useMemo(
    () => isSme2 ? buildSme2Charts(days, sme2) : [],
    [isSme2, days, sme2],
  );
  const areaSeries = sme2Charts
    .flatMap((chart) => chart.series)
    .find((series) => series.id === "soil_moisture");
  const areaDate = mode === "time" ? day?.date ?? null : null;
  const dayDates = useMemo(() => days.map((d) => d.date), [days]);

  useEffect(() => {
    onAreaSeries?.({ date: areaDate, series: areaSeries, dates: dayDates, product, mode });
  }, [onAreaSeries, areaDate, areaSeries, dayDates, product, mode]);

  useEffect(() => () => onAreaSeries?.(null), [onAreaSeries]);

  // Jump to a date picked in the granule list.
  useEffect(() => {
    if (!focus) return;
    const i = days.findIndex((d) => d.date === focus.date);
    if (i >= 0) {
      setMode("time");
      setIndex(i);
    }
    // Only when a new focus request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // ─── L2: exact browse-image bounds, once per track/frame ─────────
  useEffect(() => {
    if (isSme2 || sharp) return undefined;
    let cancelled = false;
    const firstPerFrame = new Map();
    for (const g of granules) {
      if (!g.browse_url) continue;
      const key = frameKey(g.title);
      if (!firstPerFrame.has(key)) firstPerFrame.set(key, g);
    }
    // A few at a time: a large area spans dozens of frames, and each
    // uncached one costs the backend up to three NASA requests.
    const queue = [...firstPerFrame];
    const worker = async () => {
      while (!cancelled && queue.length) {
        const [key, g] = queue.shift();
        let placed = { bbox: g.bbox, exact: false };
        if (g.browse_kml_url) {
          try {
            placed = { bbox: await fetchBrowseBounds(g.browse_kml_url), exact: true };
          } catch {
            // Fall back to the footprint's bbox (flagged as approximate).
          }
        }
        if (!cancelled) setFrameBounds((m) => ({ ...m, [key]: placed }));
      }
    };
    for (let i = 0; i < BOUNDS_CONCURRENCY; i++) worker();
    return () => {
      cancelled = true;
    };
  }, [isSme2, sharp, granules]);

  // ─── SME2: render passes, most wanted first ──────────────────────
  // Granule ids to render, in the order they're wanted now. The time
  // slider wants every pass (for scrubbing and charts), the shown day
  // first; the mosaic only wants its tiles.
  const priority = useMemo(() => {
    if (mode === "mosaic") {
      return mosaic ? [...mosaic.tiles].reverse().map((t) => t.granule.id) : [];
    }
    const shown = day ? day.granules.map((it) => it.granule.id) : [];
    const rest = days
      .slice()
      .reverse()
      .flatMap((d) => d.granules.map((it) => it.granule.id));
    return [...new Set([...shown, ...rest])];
  }, [mode, mosaic, day, days]);
  const priorityRef = useRef(priority);
  useEffect(() => {
    priorityRef.current = priority;
  });

  const byId = useMemo(
    () => Object.fromEntries(granules.map((g) => [g.id, g])),
    [granules],
  );
  // Shared by workers across restarts; reset on remount (new search).
  const loader = useRef({ requested: new Set(), running: 0, blocked: false, alive: true });
  useEffect(() => {
    const state = loader.current;
    state.alive = true;
    return () => {
      state.alive = false;
    };
  }, []);

  // (Re)start workers whenever there's something new to render.
  const pending = priority.filter((id) => !loader.current.requested.has(id)).length;
  useEffect(() => {
    if (!isSme2 || !pending) return;
    const state = loader.current;
    const worker = async () => {
      state.running += 1;
      try {
        while (state.alive && !state.blocked) {
          const id = priorityRef.current.find((i) => !state.requested.has(i));
          if (!id) return;
          state.requested.add(id);
          let result;
          try {
            result = await fetchSme2Scene({ granule: byId[id].title, bbox });
          } catch (err) {
            result = { error: err?.message || "Failed", status: err?.status };
            // No login: every other pass would fail the same way.
            if (err?.status === 503) state.blocked = true;
          }
          if (state.alive) setSme2((m) => ({ ...m, [id]: result }));
        }
      } finally {
        state.running -= 1;
      }
    };
    for (let i = state.running; i < SME2_CONCURRENCY; i++) worker();
  }, [isSme2, pending, byId, bbox]);

  // Image for one granule: { raw, bounds, exact } or null (not ready / none).
  const sourceOf = (g) => {
    if (g.sharp) return { raw: g.sharp.image_url, bounds: g.site.bbox, exact: true };
    if (isSme2) {
      const r = sme2[g.id];
      const path = r?.images?.[layer === "soil_moisture" ? "soil_moisture" : "backscatter"];
      // Whole-frame images (image_bbox); the map clips them to the area.
      return path
        ? { raw: path, bounds: r.image_bbox ?? r.bbox ?? bbox, exact: true }
        : null;
    }
    if (!g.browse_url) return null;
    const b = frameBounds[frameKey(g.title)];
    return b?.bbox ? { raw: g.browse_url, bounds: b.bbox, exact: b.exact } : null;
  };

  // Backscatter images can be drawn as HH, HV or the open-water mask; the
  // newest day's images are drawn first.
  const drawsImageLayers = Boolean(sharp || isSme2) && layer !== "soil_moisture";
  const imageUrls = drawsImageLayers
    ? [...days].reverse().flatMap((d) => d.granules.map((it) => sourceOf(it.granule)?.raw)).filter(Boolean).map(assetUrl)
    : [];
  const mapUrl = useLayerMapper(drawsImageLayers ? layer : "colour", imageUrls.map((url) => ({ url })));
  const shown = (path) => (drawsImageLayers ? mapUrl(assetUrl(path)) : assetUrl(path));

  // ─── Map layers ──────────────────────────────────────────────────
  const tiles = [];
  const outlines = [];
  if (mode === "mosaic" && mosaic) {
    for (const t of mosaic.tiles) {
      const src = sourceOf(t.granule);
      if (src) {
        tiles.push({
          key: `m-${t.granule.id}-${layer}`,
          url: shown(src.raw),
          bounds: src.bounds,
          // Whole footprint, drawn oldest first: newer passes cover older
          // ones, and older ones fill a newer pass's no-data edges.
          clip: t.full,
        });
      }
    }
    for (const d of mosaic.days) {
      outlines.push({
        key: `d-${d.date}`,
        positions: toLatLngs(d.region),
        color: d.color,
        weight: 2.5,
        label: `${d.date} · ${pct(d.share)} of the area`,
      });
    }
  } else if (day) {
    for (const it of [...day.granules].reverse()) {
      const src = sourceOf(it.granule);
      if (src) {
        tiles.push({
          key: `t-${it.granule.id}-${layer}`,
          url: shown(src.raw),
          bounds: src.bounds,
          clip: it.region,
        });
      }
      if (!it.granule.sharp) outlines.push({
        key: `f-${it.granule.id}`,
        positions: toLatLngs(it.region),
        color: "#e2e8f0",
        weight: 1,
        dashed: true,
        label: `${it.granule.product} ${day.date} · frame ${frameKey(it.granule.title)}`,
      });
    }
  }
  const layersKey = JSON.stringify([mode, tiles.map((t) => [t.key, t.url, t.bounds]), outlines.map((o) => o.key), opacity]);
  const onMapLayersRef = useRef(onMapLayers);
  useEffect(() => {
    onMapLayersRef.current = onMapLayers;
  });
  const layersRef = useRef(null);
  layersRef.current = { tiles, outlines, opacity, mode };
  useEffect(() => {
    onMapLayersRef.current(layersRef.current);
  }, [layersKey]);
  useEffect(() => () => onMapLayersRef.current(null), []);

  // ─── Panel ───────────────────────────────────────────────────────
  if (!days.length) {
    return (
      <p className="muted small">
        No {product} data covers this area in the selected dates.
      </p>
    );
  }

  const sme2Results = Object.values(sme2);
  const blocking = sme2Results.find((r) => r?.status === 503);
  const failures = sme2Results.filter((r) => r?.error && r.status !== 503);
  // Progress of what the current view needs.
  const sme2Done = priority.filter((id) => sme2[id]).length;
  const sme2Total = priority.length;
  const approximate =
    !isSme2 && !sharp && Object.values(frameBounds).some((b) => !b.exact);
  const noBrowse = !isSme2 && !sharp && !granules.some((g) => g.browse_url);

  const scenes = days.map((d) => {
    const first = d.granules.map((it) => sourceOf(it.granule)).find(Boolean);
    return {
      date: d.date,
      quality: d.granules[0].granule.quality,
      image_url: first?.raw ?? null,
    };
  });
  const onIndexChange = (next) =>
    setIndex((i) => {
      const cur = i === null ? last : Math.min(i, last);
      return typeof next === "function" ? next(cur) : next;
    });
  const selectDate = (date) => {
    const i = days.findIndex((d) => d.date === date);
    if (i >= 0) {
      setMode("time");
      setIndex(i);
    }
  };

  // Layers to choose from: only those the data can supply.
  let layerOptions = null;
  if (sharp) layerOptions = imageLayerOptions();
  else if (isSme2) {
    const loaded = Object.values(sme2).filter((r) => r && !r.error);
    layerOptions = [
      ...imageLayerOptions(),
      {
        id: "soil_moisture",
        label: SME2_LAYERS.soil_moisture.label,
        // Known only once passes have rendered: grey it out if none has it.
        disabled: loaded.length > 0 && !loaded.some((r) => r.images?.soil_moisture),
        reason: "none retrieved here",
      },
    ];
  }

  let legend;
  let ramp = null;
  if (layer === "soil_moisture") {
    ramp = SME2_LAYERS.soil_moisture.ramp ?? null;
    legend = SME2_LAYERS.soil_moisture.legend;
  } else if (isSme2 || sharp) {
    const base = isSme2
      ? `${SME2_LAYERS.backscatter.note} ${backscatterLegend ?? ""}`.trim()
      : `${backscatterLegend ?? ""} ~${sharp.pixel_m} m pixels, frame ${sharp.frame}.`.trim();
    ({ ramp, text: legend } = layerLegend(layer, base));
  } else if (noBrowse) {
    legend = `${product} has no browse images; footprints are outlined instead.`;
  } else {
    legend = "NASA browse images, clipped to each footprint.";
  }

  const player = (
    <ScenePlayer
      key={layer === "soil_moisture" ? "soil" : "backscatter"}
      layers={layerOptions}
      layer={layer}
      onLayerChange={setLayer}
      imageUrl={drawsImageLayers ? mapUrl : undefined}
      title={`${product} images over time`}
      scenes={scenes}
      index={current}
      onIndexChange={onIndexChange}
      opacity={opacity}
      onOpacityChange={onOpacityChange}
      product={product}
      ramp={ramp}
      legend={legend}
      // Sharp imagery is a set of small local files: fetch them all, so playback never waits.
      preload={isSme2 || Boolean(sharp)}
      docked={Boolean(timelineHost)}
    />
  );
  const modeControls = sharp ? null : (
    <div className="layer-toggle" role="group" aria-label="NISAR view">
      {[
        ["time", "Time slider"],
        ["mosaic", "Mosaic (newest first)"],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`btn btn-small ${id === mode ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={id === mode}
          onClick={() => setMode(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <section className="explorer" aria-label={`${product} data over this area`}>
      {timelineHost
        ? createPortal(
          <>
            {modeControls && <div className="map-view-controls">{modeControls}</div>}
            {mode === "time" && player}
          </>,
          timelineHost,
        )
        : modeControls}
      {mode === "mosaic" && (
        <LayerSelect layers={layerOptions} value={layer} onChange={setLayer} />
      )}

      {blocking && <p className="error">{blocking.error}</p>}
      {isSme2 && !blocking && sme2Done < sme2Total && (
        <p className="muted small" role="status">
          Loading SME2 images: {sme2Done} of {sme2Total}… (passes not
          prepared in advance take ~10 s each the first time)
        </p>
      )}
      {failures.length > 0 && (
        <p className="warning small">
          {failures.length} image{failures.length === 1 ? "" : "s"} could not
          be shown ({failures[0].error}).
        </p>
      )}
      {approximate && (
        <p className="warning small">
          Some images are placed approximately.
        </p>
      )}

      {mode === "time" ? (
        <>
          {!timelineHost && player}
          {day && (
            <p className="muted small">
              {sharp
                ? `Sharp render of ${day.date}, ~${sharp.pixel_m} m pixels.`
                : `${day.granules.length} image${day.granules.length === 1 ? "" : "s"} on ${day.date}, covering ${pct(Math.min(1, day.granules.reduce((s, it) => s + it.share, 0)))} of the area (dashed outlines).`}
            </p>
          )}
          {isSme2 && <Sme2Charts charts={sme2Charts} date={day?.date} onSelectDate={selectDate} />}
        </>
      ) : (
        mosaic && (
          <MosaicPanel
            mosaic={mosaic}
            product={product}
            opacity={opacity}
            onOpacityChange={onOpacityChange}
            ramp={ramp}
            legend={legend}
            onSelectDate={selectDate}
          />
        )
      )}
    </section>
  );
}

function MosaicPanel({ mosaic, product, opacity, onOpacityChange, ramp, legend, onSelectDate }) {
  return (
    <div className="mosaic">
      <h3>Newest {product} data across the area</h3>
      <p className="small">
        Covers <strong>{pct(mosaic.coverage)}</strong> of the area with{" "}
        {mosaic.tiles.length} image{mosaic.tiles.length === 1 ? "" : "s"} from{" "}
        {mosaic.days.length} date{mosaic.days.length === 1 ? "" : "s"}. Newer
        passes are on top; coloured outlines mark where each date takes over.
      </p>
      {mosaic.coverage < 0.995 && (
        <p className="warning small">
          {pct(1 - mosaic.coverage)} of the area has no {product} data in these
          dates. Widen the date range to fill it.
        </p>
      )}
      <ul className="mosaic-days small">
        {mosaic.days.map((d) => (
          <li key={d.date}>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => onSelectDate(d.date)}
              title="Show this date in the time slider"
            >
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
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
        />
      </label>
      <div className="scene-legend small">
        {ramp && (
          <>
            <div className={`ramp ${ramp.className}`} aria-hidden="true" />
            <div className="ramp-labels muted">
              {ramp.labels.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </>
        )}
        <p className="muted">{legend}</p>
      </div>
    </div>
  );
}

/** Per-day SME2 values: valid-area-weighted mean of each image's median. */
function buildSme2Charts(days, sme2) {
  const charts = [];
  for (const m of SME2_METRICS) {
    const points = [];
    for (const d of days) {
      let sum = 0;
      let weight = 0;
      for (const it of d.granules) {
        const r = sme2[it.granule.id];
        const v = r?.values?.[m.id];
        if (v === undefined) continue;
        const w = (it.share || 1e-6) * (m.id === "soil_moisture" ? r.valid_pct?.soil_moisture ?? 1 : r.valid_pct?.backscatter ?? 1);
        sum += v * w;
        weight += w;
      }
      if (weight > 0) {
        points.push({ date: d.date, value: Math.round((sum / weight) * 1000) / 1000 });
      }
    }
    if (!points.length) continue;
    const chart = charts.find((c) => c.unit === m.unit);
    const series = { ...m, points };
    if (chart) chart.series.push(series);
    else charts.push({ unit: m.unit, series: [series] });
  }
  return charts;
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
        Area medians, averaged per day. Provisional.
      </p>
    </>
  );
}
