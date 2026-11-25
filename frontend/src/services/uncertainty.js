/**
 * Plain-language uncertainty for ground-motion readings: words always paired
 * with the number behind them (ProfilePanel.jsx).
 */
const finite = (v) => v !== null && v !== undefined && !Number.isNaN(v);

/**
 * How a change compares with the noise, in words and a number, so the
 * words never stand alone (a change under 2x the noise is not a finding).
 */
export function signalWords(value, noise) {
  if (!finite(value) || !noise) return null;
  const ratio = Math.abs(value) / noise;
  const times = `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}× the ±${noise} mm noise`;
  if (ratio < 2) return `${times}: within the noise, not a measured change`;
  if (ratio < 3) return `${times}: possibly real, worth a second look`;
  return `${times}: clearly above the noise`;
}

/**
 * Where the radar sits and which way "+" points. NISAR looks left of its
 * track: heading north (ascending) it looks west, so it sits to the east.
 */
export function lookGeometry(passDirection, lookDirection, incidence) {
  const asc = String(passDirection ?? "").toLowerCase().startsWith("asc");
  const desc = String(passDirection ?? "").toLowerCase().startsWith("desc");
  if (!asc && !desc) return null;
  const left = !String(lookDirection ?? "left").toLowerCase().startsWith("r");
  const from = asc === left ? "east" : "west";
  const angles = (incidence ?? []).filter(finite).sort((a, b) => a - b);
  const tilt = angles.length ? Math.round(angles[angles.length >> 1]) : null;
  return { from, tilt };
}
