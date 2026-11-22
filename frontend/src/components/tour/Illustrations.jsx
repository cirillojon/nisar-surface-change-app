/* Inline SVG illustrations for the welcome dialog and the docs (no external images). */
import { useId } from "react";

const useIdPrefix = () => `${useId().replace(/[^\w-]/g, "")}-`;

/** The NISAR satellite: ISRO spacecraft, 12 m reflector on its boom, radar beam. */
export function NisarIllustration() {
  // Unique per instance: the dialog and the docs can show the same art at once.
  const p = useIdPrefix();
  return (
    <svg
      className="tour-art"
      viewBox="0 0 340 210"
      role="img"
      aria-labelledby={`${p}nisar-art-title`}
    >
      <title id={`${p}nisar-art-title`}>
        Illustration of the NISAR satellite: a gold spacecraft body with a long solar panel, a
        boom holding a 12-meter mesh radar antenna, and a radar beam sweeping a strip of Earth.
      </title>
      <defs>
        <linearGradient id={`${p}tour-space`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#060b1d" />
          <stop offset="1" stopColor="#13234a" />
        </linearGradient>
        <linearGradient id={`${p}tour-earth`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2d7dd2" />
          <stop offset="1" stopColor="#1b4f8f" />
        </linearGradient>
        <linearGradient id={`${p}tour-beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd34d" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd34d" stopOpacity="0.05" />
        </linearGradient>
        <pattern id={`${p}tour-mesh`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6 L6 0 M-1 1 L1 -1 M5 7 L7 5" stroke="#f5c542" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="340" height="210" rx="12" fill={`url(#${p}tour-space)`} />
      {[[30, 20], [300, 30], [250, 12], [60, 120], [320, 110], [150, 18], [200, 40]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="#dbe4ff" opacity="0.8" />
      ))}
      {/* Earth */}
      <path d="M0 210 Q170 150 340 210 Z" fill={`url(#${p}tour-earth)`} />
      <path d="M40 200 Q120 178 200 182 Q260 186 320 200" stroke="#7cc47c" strokeWidth="6" fill="none" opacity="0.55" />
      {/* Radar beam to a strip on the ground */}
      <path d="M92 86 L150 186 L222 182 L104 84 Z" fill={`url(#${p}tour-beam)`} />
      {/* Boom from spacecraft to the reflector feed */}
      <path d="M205 78 L130 58 L98 70" stroke="#c9d1e6" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* 12 m mesh reflector (seen at an angle) */}
      <g transform="rotate(-18 82 66)">
        <ellipse cx="82" cy="66" rx="60" ry="20" fill={`url(#${p}tour-mesh)`} stroke="#f5c542" strokeWidth="2" />
        <ellipse cx="82" cy="66" rx="40" ry="13" fill="none" stroke="#f5c542" strokeWidth="0.8" opacity="0.7" />
        <ellipse cx="82" cy="66" rx="20" ry="6.5" fill="none" stroke="#f5c542" strokeWidth="0.8" opacity="0.7" />
      </g>
      {/* Spacecraft body (ISRO bus) and radar electronics */}
      <rect x="200" y="62" width="40" height="34" rx="3" fill="#d4a017" stroke="#8a6508" />
      <rect x="196" y="94" width="18" height="10" rx="2" fill="#e5e7eb" stroke="#6b7280" />
      {/* Solar array */}
      <g>
        <rect x="244" y="70" width="80" height="18" rx="2" fill="#1d4ed8" stroke="#93c5fd" strokeWidth="1" />
        {[264, 284, 304].map((x) => (
          <line key={x} x1={x} y1="70" x2={x} y2="88" stroke="#93c5fd" strokeWidth="0.8" />
        ))}
        <line x1="240" y1="79" x2="244" y2="79" stroke="#c9d1e6" strokeWidth="2" />
      </g>
      {/* Labels */}
      <g className="tour-art-labels" fontSize="10.5" fill="#eef2ff">
        <text x="10" y="22">12 m radar antenna (NASA)</text>
        <line x1="60" y1="26" x2="70" y2="46" stroke="#eef2ff" strokeWidth="0.8" />
        <text x="196" y="52">Spacecraft (ISRO)</text>
        <text x="262" y="104">Solar array</text>
        <text x="214" y="160">Radar sweeps a</text>
        <text x="214" y="173">240 km-wide strip</text>
      </g>
    </svg>
  );
}

/** How SAR works: pulses out, echoes back, through cloud, combined along the path. */
export function SarDiagram() {
  // Unique per instance: the dialog and the docs can show the same art at once.
  const p = useIdPrefix();
  return (
    <svg className="tour-art" viewBox="0 0 340 200" role="img" aria-labelledby={`${p}sar-art-title`}>
      <title id={`${p}sar-art-title`}>
        Diagram: the satellite moves along its orbit sending microwave pulses down through a cloud;
        the ground echoes them back; echoes collected along the path are combined into one sharp
        image.
      </title>
      <defs>
        <marker id={`${p}tour-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#ffd34d" />
        </marker>
      </defs>
      <rect width="340" height="200" rx="12" fill="#0b1630" />
      {/* Orbit path with three satellite positions */}
      <line x1="30" y1="34" x2="300" y2="34" stroke="#64748b" strokeDasharray="4 4" />
      <path d="M250 22 L300 22" stroke="#ffd34d" strokeWidth="2" markerEnd={`url(#${p}tour-arrow)`} />
      <text x="232" y="16" fontSize="9.5" fill="#cbd5e1">satellite moves</text>
      {[70, 140, 210].map((x, i) => (
        <g key={x} opacity={i === 2 ? 1 : 0.45}>
          <rect x={x - 8} y={28} width="16" height="12" rx="2" fill="#d4a017" />
          <rect x={x + 8} y={31} width="16" height="6" fill="#1d4ed8" />
        </g>
      ))}
      {/* Cloud the microwaves pass through */}
      <g fill="#e2e8f0" opacity="0.85">
        <ellipse cx="150" cy="86" rx="34" ry="12" />
        <ellipse cx="128" cy="80" rx="18" ry="10" />
        <ellipse cx="170" cy="78" rx="20" ry="11" />
      </g>
      <text x="8" y="84" fontSize="9.5" fill="#cbd5e1">
        <tspan x="8">microwaves pass</tspan>
        <tspan x="8" dy="11">through cloud</tspan>
      </text>
      {/* Pulses down (from the current position) */}
      {[50, 68, 86].map((r) => (
        <path key={r} d={`M${210 - r * 0.55} ${40 + r * 0.95} Q210 ${48 + r} ${210 + r * 0.25} ${40 + r * 0.95}`} fill="none" stroke="#ffd34d" strokeWidth="1.6" opacity={1 - r / 160} />
      ))}
      {/* Ground: forest, buildings, water */}
      <rect x="0" y="160" width="340" height="40" fill="#1f3b2d" />
      <rect x="220" y="160" width="120" height="40" fill="#1e40af" opacity="0.8" />
      {[30, 46, 62, 78].map((x) => (
        <path key={x} d={`M${x} 160 l7 -16 l7 16 z`} fill="#4ade80" />
      ))}
      <rect x="120" y="140" width="14" height="20" fill="#cbd5e1" />
      <rect x="138" y="132" width="12" height="28" fill="#94a3b8" />
      {/* Echoes back */}
      <path d="M144 132 Q178 90 206 44" fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeDasharray="3 3" markerEnd={`url(#${p}tour-arrow)`} />
      <g fontSize="9.5" fill="#eef2ff">
        <text x="8" y="58">1. Sends microwave pulses</text>
        <text x="8" y="116">2. Ground echoes back:</text>
        <text x="8" y="128">rough = bright,</text>
        <text x="8" y="140">smooth water = dark</text>
        <text x="332" y="142" textAnchor="end">3. Echoes along the path</text>
        <text x="332" y="154" textAnchor="end">combine into one sharp image</text>
      </g>
    </svg>
  );
}
