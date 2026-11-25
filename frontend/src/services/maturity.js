/**
 * NISAR release-tier facts for a pass or a series. Mirrors app/maturity.py
 * (keep the two in step). Source: https://nisar-docs.asf.alaska.edu/availability-overview/
 */
export const VALIDATED_FROM = "2026-10-21";
export const GAP = ["2026-07-27", "2026-08-10"];
export const REPROCESS_YEAR = 2027;
const TIERS = ["validated", "provisional", "beta"];

export const TIER_NOTES = {
  validated: "Validated: calibrated and checked against ground truth.",
  provisional: "Provisional: early-mission product, calibration still being refined.",
  beta: "Beta: first-release product with known artifacts (e.g. banding).",
  unknown: "Release tier unknown.",
};

/** A quality label or CMR collection name, normalised to a tier. */
export function tierOf(label) {
  const lowered = String(label ?? "").toLowerCase();
  const hit = TIERS.find((t) => lowered.includes(t));
  if (hit) return hit;
  // Validated short names drop the maturity word: NISAR_L2_GCOV_V1.
  if (/^nisar_.*_v\d+$/.test(lowered)) return "validated";
  return "unknown";
}

const day = (d) => (d ? String(d).slice(0, 10) : null);

/** One pass: its tier and every caveat that applies (backend's `maturity` wins when present). */
export function assessPass({ quality, date, product, urgentResponse, maturity } = {}) {
  if (maturity?.tier) return maturity;
  const tier = tierOf(quality);
  const d = day(date);
  const superseded = Boolean(d && d < VALIDATED_FROM);
  const inGap = Boolean(d && d >= GAP[0] && d <= GAP[1]);
  const notes = [TIER_NOTES[tier]];
  if (superseded) {
    notes.push(
      `Acquired before ${VALIDATED_FROM}: will be replaced by the ${REPROCESS_YEAR} reprocessing, so its granule ID will change.`,
    );
  }
  if (inGap) notes.push(`Falls in the permanent acquisition gap ${GAP[0]} to ${GAP[1]}.`);
  if (urgentResponse) {
    notes.push(
      "Urgent Response product: preliminary (forecast orbit, no atmosphere correction), kept in the archive for 30 days only.",
    );
  }
  if (String(product ?? "").toUpperCase() === "SME2" && tier !== "validated") {
    notes.push(`SME2 soil moisture has no validated release before ${REPROCESS_YEAR}.`);
  }
  return {
    tier,
    superseded_by_reprocessing: superseded,
    in_gap: inGap,
    urgent_response: Boolean(urgentResponse),
    notes,
  };
}

/** A series of {date, quality}: tier counts and series-level caveats. */
export function summarizeSeries(passes = []) {
  const counts = {};
  let superseded = 0;
  const dates = [];
  for (const p of passes) {
    const a = assessPass(p);
    counts[a.tier] = (counts[a.tier] ?? 0) + 1;
    if (a.superseded_by_reprocessing) superseded += 1;
    if (p.date) dates.push(day(p.date));
  }
  dates.sort();
  const tiers = Object.keys(counts);
  const spansGap = dates.length > 0 && dates[0] < GAP[0] && dates[dates.length - 1] > GAP[1];
  const notes = [];
  if (tiers.length > 1) {
    notes.push(
      `Mixed release tiers: ${tiers.map((t) => `${counts[t]} ${t}`).join(", ")}. A step between tiers can look like change.`,
    );
  }
  if (superseded) {
    notes.push(
      `${superseded} of ${passes.length} passes predate the validated record and will be replaced by the ${REPROCESS_YEAR} reprocessing.`,
    );
  }
  if (spansGap) notes.push(`The record spans NISAR's acquisition gap (${GAP[0]} to ${GAP[1]}): no passes exist in it.`);
  return { counts, mixed: tiers.length > 1, superseded, spansGap, notes };
}
