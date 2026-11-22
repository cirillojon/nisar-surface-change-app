/**
 * Space-time diagram: distance along a line (x) by date (y, oldest at the
 * top), each cell colored by displacement. Red = down / away from the
 * satellite, blue = up / toward it (as the deformation sites).
 */
const W = 360;
const PAD = { top: 8, right: 8, bottom: 30, left: 52 };

/** "2025-11-24" → "Nov '25" (fits narrow sidebars; full date on hover). */
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} '${iso.slice(2, 4)}`;
};
const MAX_COLUMNS = 120;
const ROW_H = 8;

const AWAY = [178, 24, 43];
const ZERO = [247, 247, 247];
const TOWARD = [33, 102, 172];

function divergingColor(value, limit) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const t = Math.max(-1, Math.min(1, value / limit));
  const end = t < 0 ? AWAY : TOWARD;
  const a = Math.abs(t);
  const c = ZERO.map((z, i) => Math.round(z + (end[i] - z) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Average groups of neighboring points so there are at most MAX_COLUMNS. */
function columns(dist, rows) {
  const n = dist.length;
  const per = Math.max(1, Math.ceil(n / MAX_COLUMNS));
  const cols = [];
  for (let start = 0; start < n; start += per) {
    const end = Math.min(n, start + per);
    cols.push({
      from: dist[start],
      to: end < n ? dist[end] : dist[n - 1],
      values: rows.map((row) => {
        const v = row.slice(start, end).filter((x) => x !== null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      }),
    });
  }
  return cols;
}

export default function SpaceTimeChart({
  dist,
  dates,
  rows,
  limit,
  unit = "mm",
  selected = null,
  baseline = null,
  onSelect,
}) {
  const cols = columns(dist, rows);
  const total = dist[dist.length - 1] || 1;
  const H = PAD.top + dates.length * ROW_H + PAD.bottom;
  const x = (d) => PAD.left + (d / total) * (W - PAD.left - PAD.right);
  const y = (i) => PAD.top + i * ROW_H;
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Displacement along the line from ${dates[0]} to ${dates[dates.length - 1]}`}
      >
        {dates.map((d, i) => (
          <g
            key={d}
            className={onSelect ? "chart-point-clickable" : undefined}
            onClick={onSelect ? () => onSelect(i) : undefined}
            data-testid="spacetime-row"
          >
            {cols.map((c, j) => {
              const fill = divergingColor(c.values[i], limit);
              return fill ? (
                <rect
                  key={j}
                  x={x(c.from)}
                  y={y(i)}
                  width={Math.max(0.5, x(c.to) - x(c.from))}
                  height={ROW_H}
                  fill={fill}
                />
              ) : null;
            })}
            <title>{d}</title>
          </g>
        ))}
        {baseline !== null && (
          <rect
            x={PAD.left}
            y={y(baseline)}
            width={W - PAD.left - PAD.right}
            height={ROW_H}
            fill="none"
            className="chart-baseline"
          >
            <title>From date (zero change)</title>
          </rect>
        )}
        {selected !== null && (
          <rect
            x={PAD.left}
            y={y(selected)}
            width={W - PAD.left - PAD.right}
            height={ROW_H}
            fill="none"
            className="chart-selected"
          />
        )}
        {dates.map((d, i) =>
          i % labelEvery === 0 || i === dates.length - 1 ? (
            <text key={d} x={PAD.left - 4} y={y(i) + ROW_H - 1} textAnchor="end" className="chart-tick">
              {shortDate(d)}
              <title>{d}</title>
            </text>
          ) : null,
        )}
        <text x={PAD.left} y={H - PAD.bottom + 12} className="chart-tick">A · 0 km</text>
        <text x={W - PAD.right} y={H - PAD.bottom + 12} textAnchor="end" className="chart-tick">
          {total.toFixed(1)} km · B
        </text>
        <text x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle" className="chart-tick">
          Distance along the line
        </text>
      </svg>
      <div className="scene-legend small">
        <div className="ramp ramp-displacement" aria-hidden="true" />
        <div className="ramp-labels muted">
          <span>−{limit} {unit}</span>
          <span>0</span>
          <span>+{limit} {unit}</span>
        </div>
      </div>
    </figure>
  );
}
