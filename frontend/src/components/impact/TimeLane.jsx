import { useRef } from "react";

import { nearestDate } from "../../services/chain.js";
import { formatAmount } from "../../services/measurements.js";
import { DAY_MS, FULL_COVERAGE } from "./constants.js";

const TOP = 8;

/**
 * Where a lane's points go on its 0–100 box: x from the shared axis, y from
 * the values in view (from zero, except for line charts), and the extras
 * drawn behind them (the moment's span, the window, the fitted line).
 */
function laneGeometry(lane, { t0, span, selectedDate }) {
  const x = (date) => ((Date.parse(date) - t0) / span) * 100;
  const visible = (lane.points ?? []).filter((p) => {
    const at = x(p.date);
    return at >= -0.5 && at <= 100.5;
  });
  const fromZero = lane.chart !== "line";
  const values = visible.map((p) => p.value);
  const lo = fromZero || !values.length ? 0 : Math.min(...values);
  const peak = values.length ? Math.max(lo, ...values) : lo;
  const hi = peak > lo ? peak : lo + 1;
  const bottom = fromZero ? 100 : 92;
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - TOP);
  return { x, y, visible, lo, peak, bottom, band: windowBand(lane, x, span, selectedDate), highlight: highlightBox(lane, x) };
}

// The days counted towards the selected pass's readout.
function windowBand(lane, x, span, selectedDate) {
  if (!lane.windowDays || !selectedDate) return null;
  const right = x(selectedDate);
  const left = Math.max(0, right - (((lane.windowDays - 1) * DAY_MS) / span) * 100);
  return { left: `${left}%`, width: `${right - left}%` };
}

// The span of the moment shown.
function highlightBox(lane, x) {
  if (!lane.highlight) return null;
  const { start, end } = lane.highlight;
  return { left: `${x(start)}%`, width: `${Math.max(0.6, x(end) - x(start))}%` };
}

const at = (v) => v.toFixed(2);

/** The series itself: pass ticks, daily bars, or a line (filled for areas). */
function LaneShape({ lane, geometry, passes }) {
  const { x, y, visible } = geometry;
  if (lane.chart === "ticks") {
    return <path className="lane-stroke" d={passes.map((d) => `M${at(x(d))},30V70`).join("")} />;
  }
  if (!visible.length) return null;
  const first = at(x(visible[0].date));
  const last = at(x(visible.at(-1).date));
  if (lane.chart === "bars") {
    const bars = visible.filter((p) => p.value > 0).map((p) => `M${at(x(p.date))},100V${at(y(p.value))}`).join("");
    return (
      <path
        className={`lane-stroke ${visible.length > 200 ? "" : "lane-stroke-wide"}`}
        d={bars || `M${first},100H${last}`}
        strokeLinecap={bars ? undefined : "round"}
      />
    );
  }
  const line = visible.map((p, i) => `${i ? "L" : "M"}${at(x(p.date))},${at(y(p.value))}`).join("");
  return (
    <>
      {lane.chart === "area" && <path className="lane-fill" d={`${line}L${last},100L${first},100Z`} />}
      <path className="lane-stroke lane-stroke-wide" d={line} />
    </>
  );
}

function LaneFit({ fit, geometry }) {
  if (!fit) return null;
  const { x, y } = geometry;
  return <path className="lane-fit" d={`M${at(x(fit.startDate))},${at(y(fit.start))}L${at(x(fit.endDate))},${at(y(fit.end))}`} />;
}

/** One dot per pass: hollow if it imaged little of the box, shaped by its mode. */
function LaneDots({ lane, geometry }) {
  if (!lane.dots) return null;
  const { x, y, visible } = geometry;
  return visible.map((p) => (
    <span
      key={p.date}
      className="lane-dot"
      data-active={p.date === lane.activeDate}
      data-partial={Boolean(lane.flagPartial) && p.coverage != null && p.coverage < FULL_COVERAGE}
      data-mode={lane.modeIndex?.[p.mode]}
      style={{ left: `${x(p.date)}%`, top: `${y(p.value)}%` }}
      title={lane.dotTitle(p)}
    />
  ));
}

/** The lane's top value, and its lowest when it doesn't start at zero. */
function LaneScale({ lane, geometry }) {
  const { visible, peak, lo } = geometry;
  if (!visible.length) return null;
  const scale = (v) => (lane.formatScale ? lane.formatScale(v) : formatAmount(v, lane.scaleUnit));
  return (
    <>
      <span className="lane-scale">{scale(peak)}</span>
      {lane.showLow && peak > lo && <span className="lane-scale lane-scale-low">{scale(lo)}</span>}
    </>
  );
}

/** One series on the shared time axis. Click or drag to pick the nearest pass. */
export default function TimeLane({ lane, t0, span, selectedDate, passes, onSelectDate }) {
  const seriesRef = useRef(null);
  const geometry = laneGeometry(lane, { t0, span, selectedDate });
  const { x, visible, bottom, band, highlight } = geometry;

  const pick = (e) => {
    const rect = seriesRef.current.getBoundingClientRect();
    if (!rect.width || !passes.length) return;
    const date = nearestDate(passes, t0 + ((e.clientX - rect.left) / rect.width) * span);
    if (date && date !== selectedDate) onSelectDate?.(date);
  };

  return (
    <div
      className={`lane-plot ${lane.className ?? ""}`}
      style={{ "--lane": lane.color }}
      role="img"
      aria-label={lane.description}
      onPointerDown={pick}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e);
      }}
    >
      <LaneScale lane={lane} geometry={geometry} />
      <div ref={seriesRef} className="lane-series" data-scale={visible.length > 0}>
        {highlight && <span className="lane-highlight" style={highlight} />}
        {band && <span className="lane-window" style={band} />}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {visible.length > 0 && (
            <g className="lane-grid">
              <line x1="0" x2="100" y1={TOP} y2={TOP} />
              <line x1="0" x2="100" y1={bottom} y2={bottom} />
            </g>
          )}
          <LaneFit fit={lane.fit} geometry={geometry} />
          <LaneShape lane={lane} geometry={geometry} passes={passes} />
        </svg>
        {selectedDate && <span className="lane-cursor" style={{ left: `${x(selectedDate)}%` }} />}
        <LaneDots lane={lane} geometry={geometry} />
      </div>
    </div>
  );
}
