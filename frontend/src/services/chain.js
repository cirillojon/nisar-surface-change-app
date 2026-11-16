/* Helpers for the NISAR story panel: shared time axis, readouts, moments, drawn areas. */
import { fetchAreaContext } from "./api.js";

const DAY_MS = 86400000;

/** The date in `dates` closest to time `t` (ms since epoch). */
export function nearestDate(dates, t) {
  let best = null;
  let bestGap = Infinity;
  for (const date of dates) {
    const gap = Math.abs(Date.parse(date) - t);
    if (gap < bestGap) {
      best = date;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Sum or mean of a daily series over the `days` up to and including
 * `date`; null unless every day of that window has a value.
 */
export function windowValue(series, date, days, aggregate) {
  const end = Date.parse(date);
  const start = end - (days - 1) * DAY_MS;
  let sum = 0;
  let count = 0;
  for (const point of series) {
    const t = Date.parse(point.date);
    if (t >= start && t <= end) {
      sum += point.value;
      count += 1;
    }
  }
  if (count < days) return null;
  return aggregate === "sum" ? sum : sum / count;
}

/**
 * The moment that explains pass `date`: the pinned one if the pass lies
 * in its range, else the shortest range containing the pass.
 */
export function momentAt(moments, date, pinnedId = null) {
  if (!date || !moments?.length) return null;
  const containing = moments.filter((m) => m.start <= date && date <= m.end);
  const pinned = containing.find((m) => m.id === pinnedId);
  if (pinned) return pinned;
  const length = (m) => Date.parse(m.end) - Date.parse(m.start);
  return containing.reduce((best, m) => (best && length(best) <= length(m) ? best : m), null);
}

/** Month starts between two times, thinned to at most `max` labels. */
export function monthTicks(t0, t1, max = 7) {
  const ticks = [];
  const cursor = new Date(t0);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= t1) {
    ticks.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const stride = Math.max(1, Math.ceil(ticks.length / max));
  return ticks.filter((_, i) => i % stride === 0);
}

/**
 * Related data for a custom area: rain at its centre. NISAR values come
 * from the explorer.
 */
export async function loadAreaChain(bbox, start, end) {
  const [context] = await Promise.allSettled([fetchAreaContext(bbox, start, end)]);
  return {
    available: true,
    window_days: context.value?.window_days ?? 12,
    drivers: context.status === "fulfilled" ? context.value.drivers : [],
    driverError:
      context.status === "rejected"
        ? context.reason?.message || "Rainfall data is unavailable."
        : null,
    radar: null,
    moments: [],
  };
}

/** How open water is compared, for the chart and the map's legend. */
export function footprintText(footprint) {
  if (!footprint) return null;
  if (footprint.status === "insufficient") {
    return `The passes share only ${footprint.pct_of_box}% of the box, too little to compare open water.`;
  }
  if (footprint.pct_of_box >= 99.95) return "Every pass imaged the whole box.";
  let text = `Over the ${footprint.pct_of_box}% of the box every pass imaged; the hatched area on the map is left out.`;
  if (footprint.method === "image" && footprint.estimated?.length) {
    text += ` Passes that imaged more are estimated to within about ±${footprint.uncertainty_pp} points.`;
  }
  return text;
}

