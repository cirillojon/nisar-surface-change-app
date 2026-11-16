/**
 * Dependency-free SVG chart for numeric x/y data: scatter points with
 * optional error bars, lines, shaded bands and reference lines.
 *
 * layers: [
 *   { type: "band", color, points: [{ x, lo, hi }] },
 *   { type: "line", color, label, points: [{ x, y }], dashed },
 *   { type: "points", color, label, points: [{ x, y, xerr, yerr, title, color }] },
 * ]
 * refs: [{ type: "diagonal" | "x" | "y", value, label }]
 */
const W = 360;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 34, left: 46 };

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function extent(values, pad = 0.08) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export default function XYChart({
  layers,
  refs = [],
  xLabel,
  yLabel,
  title,
  equalAxes = false,
}) {
  const xs = [];
  const ys = [];
  for (const l of layers) {
    for (const p of l.points) {
      xs.push(p.x - (p.xerr ?? 0), p.x + (p.xerr ?? 0));
      if (l.type === "band") ys.push(p.lo, p.hi);
      else ys.push(p.y - (p.yerr ?? 0), p.y + (p.yerr ?? 0));
    }
  }
  if (!xs.length) return null;
  let [x0, x1] = extent(xs);
  let [y0, y1] = extent(ys);
  if (equalAxes) {
    x0 = y0 = Math.min(x0, y0);
    x1 = y1 = Math.max(x1, y1);
  }
  const x = (v) => PAD.left + ((v - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const inX = (v) => v >= x0 && v <= x1;
  const inY = (v) => v >= y0 && v <= y1;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} className="chart-axis" />
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="chart-axis" />
        {inY(0) && <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="chart-zero" />}
        {inX(0) && <line x1={x(0)} x2={x(0)} y1={PAD.top} y2={H - PAD.bottom} className="chart-zero" />}

        {refs.map((r, i) => {
          if (r.type === "diagonal") {
            const a = Math.max(x0, y0);
            const b = Math.min(x1, y1);
            return (
              <line key={i} x1={x(a)} y1={y(a)} x2={x(b)} y2={y(b)} className="chart-ref">
                <title>{r.label}</title>
              </line>
            );
          }
          if (r.type === "x" && inX(r.value)) {
            return (
              <line key={i} x1={x(r.value)} x2={x(r.value)} y1={PAD.top} y2={H - PAD.bottom} className="chart-ref">
                <title>{r.label}</title>
              </line>
            );
          }
          return null;
        })}

        {layers.map((l, li) => {
          if (l.type === "band") {
            const top = l.points.map((p) => `${x(p.x)},${y(p.hi)}`);
            const bottom = [...l.points].reverse().map((p) => `${x(p.x)},${y(p.lo)}`);
            return (
              <polygon key={li} points={[...top, ...bottom].join(" ")} fill={l.color} fillOpacity={0.18} stroke="none" />
            );
          }
          if (l.type === "line") {
            return (
              <polyline
                key={li}
                points={l.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.dashed ? "5 4" : undefined}
              />
            );
          }
          return (
            <g key={li}>
              {l.points.map((p, i) => (
                <g key={i} data-testid="xy-point">
                  {p.xerr ? (
                    <line x1={x(p.x - p.xerr)} x2={x(p.x + p.xerr)} y1={y(p.y)} y2={y(p.y)} stroke={p.color ?? l.color} strokeOpacity={0.5} />
                  ) : null}
                  {p.yerr ? (
                    <line x1={x(p.x)} x2={x(p.x)} y1={y(p.y - p.yerr)} y2={y(p.y + p.yerr)} stroke={p.color ?? l.color} strokeOpacity={0.5} />
                  ) : null}
                  <circle cx={x(p.x)} cy={y(p.y)} r={3.2} fill={p.color ?? l.color} stroke="#0b1220" strokeWidth={0.8}>
                    {p.title && <title>{p.title}</title>}
                  </circle>
                </g>
              ))}
            </g>
          );
        })}

        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="chart-tick">{fmt(y1)}</text>
        <text x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end" className="chart-tick">{fmt(y0)}</text>
        <text x={PAD.left} y={H - PAD.bottom + 12} className="chart-tick">{fmt(x0)}</text>
        <text x={W - PAD.right} y={H - PAD.bottom + 12} textAnchor="end" className="chart-tick">{fmt(x1)}</text>
        <text x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle" className="chart-tick">{xLabel}</text>
        <text
          x={12}
          y={(PAD.top + H - PAD.bottom) / 2}
          textAnchor="middle"
          className="chart-tick"
          transform={`rotate(-90 12 ${(PAD.top + H - PAD.bottom) / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      <figcaption className="chart-legend">
        {layers
          .filter((l) => l.label)
          .map((l) => (
            <span key={l.label}>
              <span className="swatch" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        {refs
          .filter((r) => r.label)
          .map((r) => (
            <span key={r.label}>
              <span className="swatch swatch-ref" />
              {r.label}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
