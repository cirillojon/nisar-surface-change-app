import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { profileJobQuery, profileQuery } from "../services/queries.js";
import SpaceTimeChart from "./SpaceTimeChart.jsx";
import XYChart from "./XYChart.jsx";

const PLAY_MS = 600;
const ELEVATION = "#a3a3a3";
const MOTION = "#38bdf8";

const toNumbers = (row) => row.map((v) => (v === null ? null : v));
const finite = (v) => v !== null && v !== undefined && !Number.isNaN(v);

/** Symmetric colour range: 98th percentile of |value|, rounded up to 5. */
function colourLimit(rows) {
  const all = rows.flat().filter(finite).map(Math.abs).sort((a, b) => a - b);
  if (!all.length) return 10;
  const p98 = all[Math.min(all.length - 1, Math.floor(all.length * 0.98))];
  return Math.max(10, Math.ceil(p98 / 5) * 5);
}

const fmtMm = (v) =>
  `${v > 0 ? "+" : ""}${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)} mm`;
// Said after an extreme that stands alone between gaps (see changeSummary).
const LONE = " (a lone point between gaps: treat with caution)";

/**
 * Largest drop / rise (with distance) and median of a change profile.
 * `lone` marks a value with no measured neighbour on either side: a single
 * sample inside a gap, where the radar mostly lost track of the ground.
 */
function changeSummary(dist, values) {
  const pts = values
    .map((v, i) => ({ v, d: dist[i], lone: !finite(values[i - 1]) && !finite(values[i + 1]) }))
    .filter((p) => finite(p.v));
  if (!pts.length) return null;
  const sorted = [...pts].sort((a, b) => a.v - b.v);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? sorted[mid].v : (sorted[mid - 1].v + sorted[mid].v) / 2;
  return { min: sorted[0], max: sorted[sorted.length - 1], median };
}

/** Points with a value, as {x, y}. */
const series = (xs, ys) =>
  xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => finite(p.y));

function Progress({ job }) {
  const p = job?.progress ?? {};
  const pct = p.total ? Math.round((100 * (p.done ?? 0)) / p.total) : null;
  return (
    <div className="profile-progress" role="status">
      <p className="small">
        {p.stage ?? "Starting…"}
        {p.total ? ` · ${p.done ?? 0} of ${p.total} interferograms` : ""}
        {p.frame ? ` · frame ${p.frame}` : ""}
      </p>
      {pct !== null && (
        <div className="progress-bar" aria-hidden="true">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="muted small">
        A new line takes 1–4 minutes; the same line opens instantly next time.
      </p>
    </div>
  );
}

function Result({ result }) {
  const [mode, setMode] = useState("vertical");
  const [index, setIndex] = useState(result.dates.length - 1);
  // "From" date: changes are shown relative to it.
  const [base, setBase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = result.dates.length - 1;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => setIndex((i) => (i >= last ? 0 : i + 1)), PLAY_MS);
    return () => clearInterval(timer);
  }, [playing, last]);

  const pts = result.points;
  const rows = (mode === "vertical" ? result.vertical_mm : result.los_mm).map(toNumbers);
  // Change since the From date, per point (null where either date is missing).
  const rel = rows.map((row) =>
    row.map((v, i) => (finite(v) && finite(rows[base][i]) ? v - rows[base][i] : null)),
  );
  const limit = colourLimit(rel);
  const date = result.dates[index];
  const fromDate = result.dates[base];
  const change = rel[index];
  // The first date is zero by construction, so only later From dates add their own noise.
  const noise = base === 0 ? result.noise_mm : Math.round(result.noise_mm * Math.SQRT2 * 10) / 10;
  const summary = changeSummary(pts.dist_km, change);
  const vel = pts.velocity_mm_yr.map((v, i) =>
    finite(v) && mode === "vertical" && finite(pts.incidence_deg[i])
      ? v / Math.cos((pts.incidence_deg[i] * Math.PI) / 180)
      : v,
  );
  const label = mode === "vertical" ? "Height change" : "Toward satellite";

  return (
    <>
      <p className="muted small">
        {result.length_km.toFixed(1)} km · NISAR frame <code>{result.frame}</code>
        {result.pass_direction ? ` (${result.pass_direction.toLowerCase()})` : ""} ·{" "}
        {result.first_date} to {result.last_date} · {result.pairs_used} of {result.pairs_total}{" "}
        interferograms
        {result.chains > 1 ? ` in ${result.chains} runs` : ""}
      </p>

      <div data-tour="profile-elevation">
        <h3>Elevation</h3>
        <XYChart
          title="Terrain elevation along the line"
          xLabel="Distance from A (km)"
          yLabel="Elevation (m)"
          layers={[
            { type: "line", color: ELEVATION, label: "Copernicus DEM (m)", points: series(pts.dist_km, pts.elevation_m) },
          ]}
        />
      </div>

      <h3>Change over time</h3>
      <div className="layer-toggle" role="group" aria-label="Motion shown">
        {[
          ["vertical", "Height change"],
          ["los", "Along the radar's view"],
        ].map(([id, text]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-small ${id === mode ? "btn-primary" : "btn-secondary"}`}
            aria-pressed={id === mode}
            onClick={() => setMode(id)}
          >
            {text}
          </button>
        ))}
      </div>
      <p className="muted small">
        {mode === "vertical"
          ? "Assumes vertical motion: line of sight ÷ cos(incidence angle)."
          : "Exactly what NISAR measures: + toward the satellite, − away."}{" "}
        Relative to the line&apos;s median.
      </p>
      <label className="small date-pick">
        From
        <select
          value={base}
          onChange={(e) => setBase(Number(e.target.value))}
          aria-label="From date"
        >
          {result.dates.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        <span className="muted">the slider below picks the To date</span>
      </label>
      <div data-tour="spacetime">
        <SpaceTimeChart
          dist={pts.dist_km}
          dates={result.dates}
          rows={rel}
          limit={limit}
          selected={index}
          baseline={base}
          onSelect={(i) => {
            setPlaying(false);
            setIndex(i);
          }}
        />
      </div>

      <div className="scene-controls">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          aria-label="To date"
          aria-valuetext={date}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
      </div>
      <p className="small scene-caption">
        <span className="muted">From</span> <strong>{fromDate}</strong>{" "}
        <span className="muted">to</span> <strong>{date}</strong>{" "}
        <span className="muted">
          (date {index + 1} of {result.dates.length})
        </span>
      </p>
      {summary && (
        <p className="small change-summary">
          Total {label.toLowerCase()} over this period: largest drop{" "}
          <strong>{fmtMm(summary.min.v)}</strong> at {summary.min.d.toFixed(1)} km{summary.min.lone ? LONE : ""}, largest rise{" "}
          <strong>{fmtMm(summary.max.v)}</strong> at {summary.max.d.toFixed(1)} km{summary.max.lone ? LONE : ""}, median{" "}
          {fmtMm(summary.median)} (±{noise} mm noise).
          {base > index && " To is before From, so this is the change running backwards in time."}
        </p>
      )}
      <div data-tour="profile-change">
        <XYChart
          title={`${label} along the line from ${fromDate} to ${date}`}
          xLabel="Distance from A (km)"
          yLabel={`${label} (mm)`}
          layers={[
            {
              type: "band",
              color: MOTION,
              points: series(pts.dist_km, change).map((p) => ({
                x: p.x,
                lo: p.y - noise,
                hi: p.y + noise,
              })),
            },
            {
              type: "line",
              color: MOTION,
              label: `${label}, ${fromDate} → ${date}`,
              points: series(pts.dist_km, change),
            },
          ]}
        />
      </div>
      <p className="muted small">
        Shaded: ±{noise} mm, the typical scatter of a date about the trend
        {base === 0 ? "" : " (×√2: both dates carry their own noise)"}.
      </p>

      <h3>Rate</h3>
      <XYChart
        title="Average rate along the line"
        xLabel="Distance from A (km)"
        yLabel={`${label} (mm/yr)`}
        layers={[{ type: "line", color: MOTION, label: "Straight-line trend (mm/yr)", points: series(pts.dist_km, vel) }]}
      />

      <details className="sources small">
        <summary>How this was made</summary>
        <p className="muted">
          Every NISAR interferogram (GUNW) on this frame, read only along the line (median of ~240 m
          around each point every {((pts.dist_km[1] - pts.dist_km[0]) * 1000).toFixed(0)} m). Corrected
          for {result.corrections === "none" ? "nothing (corrections made it worse)" : result.corrections}
          , the set with the least scatter about a straight line (
          {Object.entries(result.scatter_mm)
            .map(([k, v]) => `${k} ${v ?? "–"} mm`)
            .join(", ")}
          ). Gaps between runs of pairs are bridged with a straight-line fit.{" "}
          {pts.measured_pct}% of points measured. Elevation: Copernicus GLO-90 DEM. Provisional data,
          good for cm-scale motion.
        </p>
      </details>
    </>
  );
}

/**
 * The backend's height-profile job for a line: started (or found) once, then
 * asked how it is doing until it is done or failed (services/queries.js).
 */
function useProfileJob(line) {
  const start = useQuery(profileJobQuery(line));
  const status = useQuery(profileQuery(start.data?.id ?? null));
  const job = status.data ?? start.data ?? null;
  let error = null;
  if (start.error) error = start.error.message || "Couldn't start the profile";
  else if (status.error) error = status.error.message || "Lost track of the profile job";
  else if (job?.state === "error") error = job.error;
  return { job, error };
}

/**
 * Height profile along a drawn line: terrain elevation plus NISAR's
 * measured change over its full record (space-time diagram, date slider,
 * rate). Starts a backend job and polls it.
 */
export default function ProfilePanel({ line, onBack }) {
  const { job, error } = useProfileJob(line);

  return (
    <article className="panel detail" aria-label="Height profile">
      <button type="button" className="btn btn-link" onClick={onBack}>
        ← All places
      </button>
      <p className="muted small">
        From A ({line[0][1].toFixed(3)}°, {line[0][0].toFixed(3)}°) to B (
        {line[line.length - 1][1].toFixed(3)}°, {line[line.length - 1][0].toFixed(3)}°), {line.length}{" "}
        points. Use Draw line to draw another.
      </p>
      {error && <p className="error">{error}</p>}
      {!error && !job?.result && <Progress job={job} />}
      {/* A cached line answers "done" before the poll brings the result. */}
      {job?.result && <Result result={job.result} />}
    </article>
  );
}
