import { useId } from "react";

import { GAP } from "../services/maturity.js";

/**
 * Dependency-free SVG line chart. Draws one line per series (all sharing
 * one unit), marks the selected date, and reports clicks on a point.
 * Swap for a charting library (Recharts, Plotly, ...) if you need zoom etc.
 */
const W = 360;
const H = 180;
const PAD = { top: 16, right: 48, bottom: 28, left: 10 };

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
const dateLabel = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dateWithYear = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const seriesColor = (series) =>
  series.color ?? `var(--chart-${series.id}, var(--accent))`;

/**
 * series: [{ id, label, color, points: [{ date: "YYYY-MM-DD", value }] }]
 */
export default function TimeSeriesChart({
  series,
  unit,
  title,
  selectedDate = null,
  eventDate = null,
  onSelectDate,
  showLegend = true,
}) {
  const hatchId = `chart-gap-hatch-${useId().replace(/:/g, "")}`;
  const drawn = (series ?? []).filter((s) => s.points.length);
  if (!drawn.length) {
    return <p className="muted">No observations yet for this site.</p>;
  }

  const all = drawn.flatMap((s) =>
    s.points.map((p) => ({ t: Date.parse(p.date), v: p.value })),
  );
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  let vMin = Math.min(...all.map((p) => p.v));
  let vMax = Math.max(...all.map((p) => p.v));
  const pad = (vMax - vMin || 1) * 0.1;
  // Don't pad a non-negative quantity (e.g. a percentage) below zero.
  vMin = vMin >= 0 ? Math.max(0, vMin - pad) : vMin - pad;
  vMax += pad;

  const x = (t) =>
    PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v) =>
    PAD.top + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD.top - PAD.bottom);
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const marker = (date, className, label) => {
    const t = date ? Date.parse(date) : null;
    if (t === null || t < t0 || t > t1) return null;
    return (
      <line
        x1={x(t)}
        x2={x(t)}
        y1={PAD.top}
        y2={H - PAD.bottom}
        className={className}
      >
        <title>{`${label}: ${date}`}</title>
      </line>
    );
  };
  // NISAR's permanent acquisition gap, hatched where it falls inside the chart.
  const g0 = Math.max(Date.parse(GAP[0]), t0);
  const g1 = Math.min(Date.parse(GAP[1]), t1);
  const gap =
    g1 > g0 ? (
      <rect
        x={x(g0)}
        y={PAD.top}
        width={Math.max(1, x(g1) - x(g0))}
        height={H - PAD.top - PAD.bottom}
        className="chart-gap"
        fill={`url(#${hatchId})`}
        data-testid="chart-gap"
      >
        <title>{`No NISAR acquisitions ${GAP[0]} to ${GAP[1]} (permanent gap)`}</title>
      </rect>
    ) : null;
  const unitSuffix = unit ? ` ${unit}` : "";
  const valueTicks = [vMax, (vMax + vMin) / 2, vMin];
  const dateTicks = t0 === t1 ? [t0] : [t0, t1];
  const dateFormat =
    new Date(t0).getUTCFullYear() === new Date(t1).getUTCFullYear()
      ? dateLabel
      : dateWithYear;

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title} from ${iso(t0)} to ${iso(t1)}`}
      >
        <defs>
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" className="chart-gap-hatch-line" />
          </pattern>
        </defs>
        {gap}
        {valueTicks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(value)}
              y2={y(value)}
              className="chart-axis"
            />
            <text x={W - PAD.right + 7} y={y(value) + 4} className="chart-tick">
              {fmt(value)}
            </text>
          </g>
        ))}
        {vMin < 0 && vMax > 0 && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(0)}
            y2={y(0)}
            className="chart-zero"
          />
        )}
        {dateTicks.map((date) => (
          <text
            key={date}
            x={x(date)}
            y={H - 8}
            textAnchor={date === t0 ? "start" : "end"}
            className="chart-tick"
          >
            {dateFormat.format(date)}
          </text>
        ))}
        {marker(eventDate, "chart-event", "Event")}
        {marker(selectedDate, "chart-selected", "Showing")}
        {drawn.map((s) => (
          <g key={s.id}>
            <polyline
              points={s.points
                .map((p) => `${x(Date.parse(p.date))},${y(p.value)}`)
                .join(" ")}
              fill="none"
              stroke={seriesColor(s)}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            {s.points.map((p) => (
              <circle
                key={p.date}
                cx={x(Date.parse(p.date))}
                cy={y(p.value)}
                r={4.5}
                fill={seriesColor(s)}
                className={`chart-point${onSelectDate ? " chart-point-clickable" : ""}`}
                data-selected={p.date === selectedDate}
                onClick={onSelectDate ? () => onSelectDate(p.date) : undefined}
                data-testid="chart-point"
              >
                <title>{`${s.label} ${p.date}: ${p.value}${unitSuffix}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {showLegend && (
        <figcaption className="chart-legend">
          {drawn.map((s) => (
            <span key={s.id}>
              <span className="swatch" style={{ background: seriesColor(s) }} />
              {s.label}
            </span>
          ))}
          {unit && <span className="muted">({unit})</span>}
        </figcaption>
      )}
    </figure>
  );
}
