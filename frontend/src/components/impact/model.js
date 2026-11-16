// The evidence card's numbers, worked out from its record and the pass on the
// map. Plain functions of their inputs, so the components only lay them out.

import { momentAt, windowValue } from "../../services/chain.js";
import { formatAmount } from "../../services/measurements.js";
import { CATALOG_PRODUCTS, DAY_MS, FULL_COVERAGE, METRIC_INFO, fmtDay } from "./constants.js";

const isPartial = (p) => p.coverage != null && p.coverage < FULL_COVERAGE;

/**
 * The NISAR series the card charts: a site's own record, or a drawn area's
 * series from its search (null while there is none), with what it measures.
 */
export function radarOf({ chain, area, areaObservation }) {
  const radar = (area ? areaObservation?.series : chain.radar) ?? null;
  const metric = radar?.metric ?? radar?.id;
  const info = METRIC_INFO[metric] ?? null;
  const footprint = area ? null : chain.footprint;
  // Values over the shared footprint aren't affected by what each pass imaged.
  const flagPartial = !(footprint && metric === "water_pct");
  // Two or more acquisition modes: draw them differently, as a mode change can look like change.
  const modes = [...new Set((radar?.points ?? []).map((p) => p.mode).filter(Boolean))].sort().reverse();
  return {
    radar,
    metric,
    info,
    product: info?.product ?? CATALOG_PRODUCTS[areaObservation?.product],
    footprint,
    flagPartial,
    modes,
    modeIndex: modes.length > 1 ? Object.fromEntries(modes.map((m, i) => [m, i])) : null,
    hasPartial: flagPartial && Boolean(radar?.points.some(isPartial)),
  };
}

/** The pass days on the axis: the ones given, else the series' own. */
export const passesOf = (passDates, radar) => (passDates?.length ? passDates : radar?.points.map((p) => p.date) ?? []);

/**
 * The shared time axis: it follows the NISAR record, with room before the
 * first pass for its window, and the search dates when there are no passes.
 */
export function timeAxis({ passes, radar, start, end, windowDays }) {
  const times = [...passes, ...(radar?.points.map((p) => p.date) ?? [])].map((d) => Date.parse(d));
  let first = times.length ? Math.min(...times) : Date.parse(start);
  let last = times.length ? Math.max(...times) : Date.parse(end);
  if (!times.length || first === last) {
    first = Math.min(first, Date.parse(start) || first);
    last = Math.max(last, Date.parse(end) || last);
  }
  const t0 = first - (windowDays - 1) * DAY_MS;
  return { t0, span: last + Math.max((last - first) * 0.03, DAY_MS) - t0 };
}

/** The related series on offer (rain, river flow…), and the one shown (`relatedId` "none": none). */
export function relatedOf({ chain, area, radar, relatedId }) {
  // Rain or river flow only means something next to a measured NISAR series;
  // a drawn area searching browse imagery has just dates.
  const drivers = area && !radar ? [] : chain.drivers ?? [];
  const lanes = drivers.map((driver) => ({ id: driver.id, label: driver.label, driver }));
  const related = relatedId === "none" ? null : lanes.find((lane) => lane.id === relatedId) ?? lanes[0] ?? null;
  return { lanes, related, driver: related?.driver ?? null };
}

/** The related series' reading for the pass shown, and what it covers. */
export function relatedReading(driver, selectedDate, windowDays) {
  if (!selectedDate) return { value: null, sub: "Select a NISAR pass" };
  const value = driver.per_pass?.find((p) => p.date === selectedDate)?.value
    ?? windowValue(driver.series ?? [], selectedDate, windowDays, driver.aggregate);
  if (value == null) return { value, sub: "No data for this window" };
  return { value, sub: driver.aggregate === "sum" ? `${windowDays} days to the pass` : `${windowDays}-day average` };
}

/** The moment shown (the one picked, else the one holding the pass), and where it is in the list. */
export function activeMomentOf(moments, selectedDate, momentId) {
  const moment = momentAt(moments, selectedDate, momentId);
  return { moment, index: moment ? moments.indexOf(moment) : -1 };
}

/** A moment's fitted pace, as a line from its start to its end. */
export function fitOf(moment) {
  if (!moment?.fit || moment.metric) return null;
  return { startDate: moment.start, endDate: moment.end, start: moment.fit.start, end: moment.fit.end };
}

/** What a drawn area's chart says when it has no reading to show. */
export function searchNote(areaObservation, passes) {
  const notes = {
    loading: "Searching the NISAR catalog for this area…",
    empty: "The catalog found no passes for this product and date range.",
    error: "The catalog search failed. Retry it in Details.",
  };
  const note = notes[areaObservation?.searchStatus];
  if (note) return note;
  if (!passes.length) return "Search the NISAR catalog in Details to find passes over this area.";
  return areaObservation?.product === "SME2"
    ? "Soil moisture appears as usable readings are processed."
    : "Browse images only. Choose Soil moisture (SME2) in Details for a measured series.";
}

/** Why there is no reading for the pass shown. */
export function noReadingNote({ radar, areaObservation, passes }) {
  if (!radar) return searchNote(areaObservation, passes);
  return areaObservation?.mode === "mosaic" ? "Choose a single pass to see its reading." : "No reading for the selected pass.";
}

/** "83% of the box imaged · mode DH · provisional data", or its date. */
export function passSummary(pass, passQuality) {
  const quality = pass.quality ?? passQuality;
  const parts = [
    pass.coverage != null && `${Math.round(pass.coverage)}% of the box imaged`,
    pass.mode && `mode ${pass.mode}`,
    quality && `${quality} data`,
  ].filter(Boolean);
  return parts.join(" · ") || fmtDay(pass.date);
}

/** A dot's tooltip on the NISAR lane. */
export function radarDotTitle(p, { unit, flagPartial, modeIndex }) {
  const partial = flagPartial && isPartial(p) ? ` (${Math.round(p.coverage)}% of the box)` : "";
  const mode = modeIndex && p.mode ? `, mode ${p.mode}` : "";
  return `${fmtDay(p.date)}: ${formatAmount(p.value, unit)}${partial}${mode}`;
}

/** "Pass 3 of 12 · Jul 14, 2026", when the pass shown is one of them. */
export function passLabel(passes, selectedDate) {
  const number = passes.indexOf(selectedDate) + 1;
  return number > 0 ? `Pass ${number} of ${passes.length} · ${fmtDay(selectedDate)}` : null;
}

/** "Average · Jun 1 – Jul 14, 2026" for a moment's related value. */
export function momentSpan(moment, context) {
  if (moment.start === moment.end) return `${context.span} · ${fmtDay(moment.end)}`;
  return `${context.span === "average" ? "Average" : "Total"} · ${fmtDay(moment.start)} – ${fmtDay(moment.end)}`;
}
