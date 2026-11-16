import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { fetchSiteChain } from "../services/api.js";
import {
  footprintText,
  loadAreaChain,
  momentAt,
  monthTicks,
  nearestDate,
  windowValue,
} from "../services/chain.js";
import { describeMeasurement, formatAmount } from "../services/measurements.js";
import "./ImpactChain.css";

const dayFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const tickFmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });

const fmtDay = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
const DAY_MS = 86400000;
// Passes covering less of the box than this are drawn hollow.
const FULL_COVERAGE = 95;
const METHODS_URL = "/docs/data/methods";
const NISAR_CATALOG = "https://cmr.earthdata.nasa.gov/search/site/collections/directory/ASF/gov.nasa.eosdis";

const COLORS = {
  rain: "var(--chain-water)",
  river: "var(--chain-water)",
  quakes: "var(--chain-quakes)",
  radar: "var(--chain-radar)",
};

// What each NISAR measurement is, in a few facts rather than prose.
const METRIC_INFO = {
  water_pct: {
    title: "Open water",
    product: "L2 backscatter (GCOV)",
    facts: [
      ["Measures", "Share of the area every pass imaged where the radar return is very low (HH below −18 dB), as calm water is."],
      ["Same ground", "Pixels some pass did not image are left out of every value, so passes are compared over the same area."],
      ["Can miss", "Flooded vegetation and wind-roughened water."],
      ["Can include", "Smooth bare ground, which also returns little to the radar."],
      ["Pixels", "80 m, L-band"],
    ],
  },
  hv_db: {
    title: "Crop canopy (HV)",
    product: "L2 backscatter (GCOV)",
    facts: [
      ["Measures", "Median cross-polarised (HV) radar return over the box."],
      ["Reads higher", "With more leaves, stems and moisture in the canopy."],
      ["Pixels", "80 m, L-band"],
    ],
  },
  los_mm: {
    title: "Ground movement",
    product: "L2 interferograms (GUNW)",
    facts: [
      ["Measures", "Movement along the satellite’s line of sight, added up over 12-day pairs."],
      ["Relative to", "The white reference point on the map."],
      ["Sign", "Negative means away from the satellite."],
    ],
  },
  soil_moisture: {
    title: "Surface soil moisture",
    product: "L3 soil moisture (SME2)",
    facts: [
      ["Measures", "Water per volume of topsoil, estimated from backscatter."],
      ["Combined", "Median over usable pixels, weighted by coverage across frames."],
      ["Pixels", "200 m"],
    ],
  },
};
const CATALOG_PRODUCTS = {
  GCOV: "L2 backscatter (GCOV)",
  GUNW: "L2 interferograms (GUNW)",
  SME2: "L3 soil moisture (SME2)",
};

/** One series on the shared time axis. Click or drag to pick the nearest pass. */
function TimeLane({ lane, t0, span, selectedDate, passes, onSelectDate }) {
  const seriesRef = useRef(null);
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
  const top = 8;
  const bottom = fromZero ? 100 : 92;
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);

  const line = visible
    .map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(2)},${y(p.value).toFixed(2)}`)
    .join("");
  let shape = null;
  if (lane.chart === "ticks") {
    shape = (
      <path
        className="lane-stroke"
        d={passes.map((d) => `M${x(d).toFixed(2)},30V70`).join("")}
      />
    );
  } else if (lane.chart === "bars" && visible.length) {
    const bars = visible
      .filter((p) => p.value > 0)
      .map((p) => `M${x(p.date).toFixed(2)},100V${y(p.value).toFixed(2)}`)
      .join("");
    const zeroLine = `M${x(visible[0].date).toFixed(2)},100H${x(visible.at(-1).date).toFixed(2)}`;
    shape = (
      <path
        className={`lane-stroke ${visible.length > 200 ? "" : "lane-stroke-wide"}`}
        d={bars || zeroLine}
        strokeLinecap={bars ? undefined : "round"}
      />
    );
  } else if (visible.length) {
    const first = x(visible[0].date).toFixed(2);
    const last = x(visible.at(-1).date).toFixed(2);
    shape = (
      <>
        {lane.chart === "area" && (
          <path className="lane-fill" d={`${line}L${last},100L${first},100Z`} />
        )}
        <path className="lane-stroke lane-stroke-wide" d={line} />
      </>
    );
  }

  // The days counted towards the selected pass's readout.
  let band = null;
  if (lane.windowDays && selectedDate) {
    const right = x(selectedDate);
    const left = Math.max(0, right - (((lane.windowDays - 1) * DAY_MS) / span) * 100);
    band = { left: `${left}%`, width: `${right - left}%` };
  }
  const highlight = lane.highlight && {
    left: `${x(lane.highlight.start)}%`,
    width: `${Math.max(0.6, x(lane.highlight.end) - x(lane.highlight.start))}%`,
  };
  const fit = lane.fit;

  const pick = (e) => {
    const rect = seriesRef.current.getBoundingClientRect();
    if (!rect.width || !passes.length) return;
    const t = t0 + ((e.clientX - rect.left) / rect.width) * span;
    const date = nearestDate(passes, t);
    if (date && date !== selectedDate) onSelectDate?.(date);
  };

  const scale = (v) => (lane.formatScale ? lane.formatScale(v) : formatAmount(v, lane.scaleUnit));
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
      {visible.length > 0 && (
        <span className="lane-scale">{scale(peak)}</span>
      )}
      {lane.showLow && visible.length > 0 && peak > lo && (
        <span className="lane-scale lane-scale-low">{scale(lo)}</span>
      )}
      <div ref={seriesRef} className="lane-series" data-scale={visible.length > 0}>
        {highlight && <span className="lane-highlight" style={highlight} />}
        {band && <span className="lane-window" style={band} />}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {visible.length > 0 && (
            <g className="lane-grid">
              <line x1="0" x2="100" y1={top} y2={top} />
              <line x1="0" x2="100" y1={bottom} y2={bottom} />
            </g>
          )}
          {fit && (
            <path
              className="lane-fit"
              d={`M${x(fit.startDate).toFixed(2)},${y(fit.start).toFixed(2)}L${x(fit.endDate).toFixed(2)},${y(fit.end).toFixed(2)}`}
            />
          )}
          {shape}
        </svg>
        {selectedDate && (
          <span className="lane-cursor" style={{ left: `${x(selectedDate)}%` }} />
        )}
        {lane.dots &&
          visible.map((p) => (
            <span
              key={p.date}
              className="lane-dot"
              data-active={p.date === lane.activeDate}
              data-partial={Boolean(lane.flagPartial) && p.coverage != null && p.coverage < FULL_COVERAGE}
              data-mode={lane.modeIndex?.[p.mode]}
              style={{ left: `${x(p.date)}%`, top: `${y(p.value)}%` }}
              title={lane.dotTitle(p)}
            />
          ))}
      </div>
    </div>
  );
}

function Readout({ value, sub }) {
  return (
    <div className="lane-readout">
      <strong data-testid="chain-readout">{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

function MomentText({ moment }) {
  // "−20.0 mm/month" → a large number and a small unit.
  const [, number, unit] = /^([−+-]?[\d.,]+)\s*(.*)$/.exec(moment.display) ?? [null, moment.display, ""];
  return (
    <>
      <span className="moment-when">
        {moment.title}
        {moment.season && <span className="moment-season">{moment.season}</span>}
      </span>
      <strong className="moment-value">
        {number}
        {unit && <span className="moment-unit" data-tight={unit === "%"}>{unit}</span>}
      </strong>
      <span className="moment-detail">{moment.detail}</span>
    </>
  );
}

/** The selected moment, shown over the map image it describes. */
function MomentPopup({ moment, index, count, onStep, onClose, onSave }) {
  return (
    <aside className="moment-popup" aria-label="What NISAR shows here" aria-live="polite">
      <div className="moment-popup-top">
        <span className="moment-count">NISAR observation · {index + 1} of {count}</span>
        <button type="button" className="moment-close" aria-label="Hide explanation" onClick={onClose}>×</button>
      </div>
      <MomentText moment={moment} />
      <p className="moment-caption">{moment.caption}</p>
      <div className="moment-popup-nav">
        <button type="button" className="btn btn-secondary btn-small" disabled={index === 0} onClick={() => onStep(-1)}>
          ‹ Previous
        </button>
        {onSave && (
          <button type="button" className="btn btn-secondary btn-small" data-tour="save-moment" onClick={() => onSave(moment)}>
            Save
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-small" disabled={index === count - 1} onClick={() => onStep(1)}>
          Next ›
        </button>
      </div>
    </aside>
  );
}

function EvidenceCard({ heading, passDate, passLabel, reading, open, onOpenChange, children }) {
  const id = useId();
  const closeRef = useRef(null);
  const reopenRef = useRef(null);
  const moveFocus = useRef(false);
  const changeOpen = (next) => {
    moveFocus.current = true;
    onOpenChange(next);
  };
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? closeRef : reopenRef).current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      {!open && (
        <button
          ref={reopenRef}
          type="button"
          className="btn btn-secondary chain-reopen"
          aria-controls={id}
          aria-expanded={false}
          onClick={() => changeOpen(true)}
        >
          {heading}
        </button>
      )}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the card from any of its controls. */}
      <section
        id={id}
        className="panel chain"
        aria-label="NISAR story"
        aria-hidden={open ? undefined : true}
        inert={!open}
        data-open={open}
        onKeyDown={onOpenChange ? (event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          changeOpen(false);
        } : undefined}
      >
        <header className="chain-head">
          <h3 className="chain-title">{heading}</h3>
          {passLabel && <time className="chain-pass-date" dateTime={passDate}>{passLabel}</time>}
          {onOpenChange && (
            <button
              ref={closeRef}
              type="button"
              className="chain-close"
              aria-label="Close NISAR card"
              onClick={() => changeOpen(false)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </button>
          )}
        </header>
        {reading}
        {children}
      </section>
    </>
  );
}

/**
 * What NISAR measured at a study site or drawn area, with a few public
 * series on the same time axis. For curated sites, short "moments" sum up
 * stretches of the record; every number in them comes from the NISAR
 * values. The vertical line is the pass shown on the map; click or drag a
 * chart to move it. Picking a moment also picks the map layer that shows it.
 */
export default function ImpactChain({
  siteId = null,
  area = null, // drawn area: { bbox: "w,s,e,n", start, end }
  areaObservation = null,
  passDates = null, // NISAR acquisition days shown in the timeline
  selectedDate = null,
  passQuality = null,
  onReturnToStudy,
  onSelectDate,
  onSelectLayer, // a moment's map layer ("water", "hv", …)
  onSaveMoment, // save the selected moment as a finding
  momentHost = null, // element over the map for the moment pop-up
  showMomentPopup = true,
  moreSeries = null, // the site's other NISAR series: [{ id, label, unit, description, points }]
  keepDate = false, // the selected pass was asked for (a link, a finding): don't move off it
  open = true,
  onOpenChange,
}) {
  const { bbox, start, end } = area ?? {};
  const [state, setState] = useState({ chain: null, error: null });
  const [relatedId, setRelatedId] = useState(null);
  const [compareOpen, setCompareOpen] = useState(true);
  const [momentId, setMomentId] = useState(null);
  const [momentsOpen, setMomentsOpen] = useState(null);
  const [momentExplained, setMomentExplained] = useState(false);
  const [popupHidden, setPopupHidden] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const bodyRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ selectedDate, onSelectDate, keepDate, onSelectLayer, open });
  useLayoutEffect(() => {
    latest.current = { selectedDate, onSelectDate, keepDate, onSelectLayer, open };
  });

  useEffect(() => {
    let cancelled = false;
    setState({ chain: null, error: null });
    // A drawn area's dates arrive with its first search.
    if (bbox && !(start && end)) return undefined;
    const request = bbox ? loadAreaChain(bbox, start, end) : fetchSiteChain(siteId);
    request
      .then((chain) => {
        if (!cancelled) setState({ chain, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ chain: null, error: err?.message || "Failed to load" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, bbox, start, end, attempt]);

  // The story reads in order: open on its first moment and that pass,
  // rather than on whichever moment holds the latest pass. A pass that was
  // asked for stays put, and the moment shown follows it.
  const loaded = state.chain;
  useLayoutEffect(() => {
    const first = loaded?.moments?.[0];
    if (!first) return;
    setPopupHidden(false);
    const { selectedDate: shown, onSelectDate: select, keepDate: keep, onSelectLayer: layer, open: cardOpen } = latest.current;
    if (keep || !cardOpen) return;
    setMomentId(first.id);
    if (first.focus !== shown) select?.(first.focus);
    if (first.layer) layer?.(first.layer);
  }, [loaded]);

  const { chain, error } = state;
  const heading = area ? "Your area over time" : "What NISAR saw";
  if (!chain || chain.available === false) {
    return (
      <EvidenceCard heading={heading} open={open} onOpenChange={onOpenChange}>
        <p className={error ? "chain-question warning" : "chain-question"} role="status">
          {error
            ? `The NISAR story could not be loaded (${error}).`
            : chain ? chain.reason ?? "This study site has no story yet." : "Loading the NISAR record…"}
        </p>
        {error && (
          <button className="btn btn-secondary btn-small chain-retry" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        )}
      </EvidenceCard>
    );
  }

  const windowDays = chain.window_days;
  const moments = chain.moments ?? [];
  const radar = area ? areaObservation?.series : chain.radar;
  const radarMetric = radar?.metric ?? radar?.id;
  const info = METRIC_INFO[radarMetric];
  const radarProduct = info?.product ?? CATALOG_PRODUCTS[areaObservation?.product];
  const passes = passDates?.length ? passDates : radar?.points.map((p) => p.date) ?? [];
  const footprint = area ? null : chain.footprint;
  // Values over the shared footprint aren't affected by what each pass imaged.
  const flagPartial = !(footprint && radarMetric === "water_pct");
  // Two or more acquisition modes: draw them differently, as a mode change can look like change.
  const modes = [...new Set((radar?.points ?? []).map((p) => p.mode).filter(Boolean))].sort().reverse();
  const modeIndex = modes.length > 1 ? Object.fromEntries(modes.map((m, i) => [m, i])) : null;

  // Related series, one at a time or none. Rain or river flow only means
  // something next to a measured NISAR series; a drawn area searching
  // browse imagery has just dates.
  const driversShown = area && !radar ? [] : chain.drivers;
  const lanes = driversShown.map((driver) => ({ id: driver.id, label: driver.label, driver }));
  const related = relatedId === "none"
    ? null
    : lanes.find((lane) => lane.id === relatedId) ?? lanes[0] ?? null;
  const driver = related?.driver ?? null;

  // The axis follows the NISAR record, with room for the first pass's window.
  const radarTimes = [...passes, ...(radar?.points.map((p) => p.date) ?? [])].map((d) => Date.parse(d));
  let firstTime = radarTimes.length ? Math.min(...radarTimes) : Date.parse(start);
  let lastTime = radarTimes.length ? Math.max(...radarTimes) : Date.parse(end);
  if (!radarTimes.length || firstTime === lastTime) {
    firstTime = Math.min(firstTime, Date.parse(start) || firstTime);
    lastTime = Math.max(lastTime, Date.parse(end) || lastTime);
  }
  const t0 = firstTime - (windowDays - 1) * DAY_MS;
  const span = lastTime + Math.max((lastTime - firstTime) * 0.03, DAY_MS) - t0;
  const shared = { t0, span, selectedDate, passes, onSelectDate };

  const activeMoment = momentAt(moments, selectedDate, momentId);
  const momentIndex = activeMoment ? moments.indexOf(activeMoment) : -1;
  const selectMoment = (moment) => {
    setMomentId(moment.id);
    setMomentExplained(true);
    setPopupHidden(false);
    if (moment.focus !== selectedDate) onSelectDate?.(moment.focus);
    if (moment.layer) onSelectLayer?.(moment.layer);
  };
  const stepMoment = (step) => {
    const next = moments[momentIndex + step];
    if (next) selectMoment(next);
  };

  const radarValue = radar?.points.find((p) => p.date === selectedDate)?.value;
  const radarReadout = describeMeasurement(radarMetric, radarValue, radar?.unit);
  const pass = radar?.points.find((p) => p.date === selectedDate);
  const passNumber = passes.indexOf(selectedDate) + 1;
  const hasPartial = flagPartial && radar?.points.some((p) => p.coverage != null && p.coverage < FULL_COVERAGE);
  const searchNotes = {
    loading: "Searching the NISAR catalog for this area…",
    empty: "The catalog found no passes for this product and date range.",
    error: "The catalog search failed. Retry it in Details.",
  };
  const searchNote = searchNotes[areaObservation?.searchStatus] ?? (
    passes.length
      ? areaObservation?.product === "SME2"
        ? "Soil moisture appears as usable readings are processed."
        : "Browse images only. Choose Soil moisture (SME2) in Details for a measured series."
      : "Search the NISAR catalog in Details to find passes over this area."
  );

  let relatedValue = null;
  let relatedSub = null;
  if (driver) {
    relatedValue = selectedDate
      ? driver.per_pass?.find((p) => p.date === selectedDate)?.value ??
        windowValue(driver.series ?? [], selectedDate, windowDays, driver.aggregate)
      : null;
    relatedSub = !selectedDate
      ? "Select a NISAR pass"
      : relatedValue == null ? "No data for this window"
        : driver.aggregate === "sum" ? `${windowDays} days to the pass` : `${windowDays}-day average`;
  }
  const activeFit = activeMoment?.fit && !activeMoment.metric
    ? {
      startDate: activeMoment.start,
      endDate: activeMoment.end,
      start: activeMoment.fit.start,
      end: activeMoment.fit.end,
    }
    : null;

  const popup = open && activeMoment && showMomentPopup && !popupHidden && momentHost
    ? createPortal(
      <MomentPopup
        moment={activeMoment}
        index={momentIndex}
        count={moments.length}
        onStep={stepMoment}
        onClose={() => setPopupHidden(true)}
        onSave={onSaveMoment ? (m) => onSaveMoment({ ...m, index: momentIndex }) : null}
      />,
      momentHost,
    )
    : null;
  const fpText = radarMetric === "water_pct" ? footprintText(footprint) : null;
  const momentContext = activeMoment?.related;
  const momentsUsePopup = Boolean(showMomentPopup && momentHost);

  const reading = (
    <section className="chain-observation" aria-label="NISAR observation">
      <div className="observation-reading">
        <div className="observation-title">
          <h4>
            {info?.title ?? radar?.label ?? "Acquisition dates"}
            {info && (
              <button
                type="button"
                className="metric-info-toggle"
                aria-expanded={infoOpen}
                aria-controls="metric-info"
                aria-label="About this measurement"
                onClick={() => {
                  setInfoOpen(!infoOpen);
                  if (!infoOpen) bodyRef.current?.scrollTo?.({ top: 0 });
                }}
              >
                i
              </button>
            )}
          </h4>
        </div>
        {Number.isFinite(radarValue) && (
          <Readout value={radarReadout.amount} sub={radarReadout.direction} />
        )}
      </div>
    </section>
  );

  return (
    <EvidenceCard
      heading={heading}
      passDate={selectedDate}
      passLabel={passNumber > 0 ? `Pass ${passNumber} of ${passes.length} · ${fmtDay(selectedDate)}` : null}
      reading={reading}
      open={open}
      onOpenChange={onOpenChange}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Make the scrollable analysis reachable by keyboard. */}
      <div ref={bodyRef} className="chain-body" role="group" aria-label="NISAR record" tabIndex={0}>
        {onReturnToStudy && (
          <div className="chain-map-notice">
            <p>The map is showing catalog imagery. The charts below use the study series.</p>
            <button type="button" className="btn btn-link" onClick={onReturnToStudy}>
              Return to study images
            </button>
          </div>
        )}
        <div className="observation-record">
          {info && infoOpen && (
            <dl className="metric-info" id="metric-info">
              <div>
                <dt>Product</dt>
                <dd>NISAR · {radarProduct}</dd>
              </div>
              {radar?.summary && (
                <div>
                  <dt>Record range</dt>
                  <dd>{radar.summary}</dd>
                </div>
              )}
              {info.facts.map(([term, text]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
              {pass && (
                <div>
                  <dt>This pass</dt>
                  <dd>
                    {[
                      pass.coverage != null && `${Math.round(pass.coverage)}% of the box imaged`,
                      pass.mode && `mode ${pass.mode}`,
                      (pass.quality ?? passQuality) && `${pass.quality ?? passQuality} data`,
                    ].filter(Boolean).join(" · ") || fmtDay(pass.date)}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {passes.length > 0 && (
            <>
              <TimeLane
                {...shared}
                lane={{
                  chart: radar ? "line" : "ticks",
                  color: COLORS.radar,
                  points: radar?.points ?? [],
                  dots: true,
                  showLow: true,
                  activeDate: selectedDate,
                  highlight: activeMoment ? { start: activeMoment.start, end: activeMoment.end } : null,
                  fit: activeFit,
                  flagPartial,
                  modeIndex,
                  dotTitle: (p) => `${fmtDay(p.date)}: ${formatAmount(p.value, radar.unit)}${
                    flagPartial && p.coverage != null && p.coverage < FULL_COVERAGE ? ` (${Math.round(p.coverage)}% of the box)` : ""}${
                    modeIndex && p.mode ? `, mode ${p.mode}` : ""}`,
                  scaleUnit: radar?.unit,
                  className: "lane-hero",
                  description: radar
                    ? `${radar.label} on ${radar.points.length} NISAR passes`
                    : `${passes.length} NISAR passes`,
                }}
              />
              <div className="chain-axis" aria-hidden="true">
                {monthTicks(t0, t0 + span, 5)
                  .map((t) => ({ t, at: (t - t0) / span }))
                  .filter(({ at }) => at > 0.06 && at < 0.94)
                  .map(({ t, at }, i) => (
                    <span key={t} style={{ left: `${at * 100}%` }}>
                      {i === 0 ? monthFmt.format(t) : tickFmt.format(t)}
                    </span>
                  ))}
              </div>
              {(hasPartial || activeFit || modeIndex) && (
                <p className="lane-key">
                  {activeFit && <span className="key-fit">Fitted pace</span>}
                  {hasPartial && <span className="key-partial">Pass covering less of the box</span>}
                  {modeIndex && modes.map((m, i) => (
                    <span key={m} className={i ? "key-mode-alt" : "key-mode"}>Mode {m}</span>
                  ))}
                </p>
              )}
            </>
          )}
          {radarMetric === "los_mm" && !area && (
            <p className="observation-note">Relative to the white reference point on the map.</p>
          )}
          {!Number.isFinite(radarValue) && (
            <p className="observation-note">
              {radar
                ? areaObservation?.mode === "mosaic"
                  ? "Choose a single pass to see its reading."
                  : "No reading for the selected pass."
                : searchNote}
            </p>
          )}
        </div>

        {moments.length > 0 && (
          <section className="chain-moments" aria-label="Moments in the record" data-tour="moments">
            <details
              className="chain-disclosure moments-disclosure"
              open={momentsOpen ?? momentsUsePopup}
              onToggle={(event) => setMomentsOpen(event.currentTarget.open)}
            >
              <summary>
                <span className="moments-heading">
                  <span>Moments</span>
                  {activeMoment && (
                    <span className="moments-current">
                      {activeMoment.season ?? activeMoment.title}
                    </span>
                  )}
                </span>
              </summary>
              <ul className="moment-list">
                {moments.map((moment) => (
                  <li key={moment.id}>
                    <button
                      type="button"
                      className="moment-row"
                      aria-pressed={moment === activeMoment}
                      aria-label={`${[moment.season, moment.title, moment.display].filter(Boolean).join(" · ")}. ${moment.caption}`}
                      onClick={() => selectMoment(moment)}
                    >
                      <span className="moment-row-label">
                        <span>{moment.season ?? moment.title}</span>
                        {moment.season && <span className="moment-date">{moment.title}</span>}
                      </span>
                      {!momentsUsePopup && <span className="moment-detail">{moment.display}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {activeMoment && momentExplained && !momentsUsePopup && (
                <div className="moment-summary">
                  <p className="chain-note">{activeMoment.caption}</p>
                  {onSaveMoment && (
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => onSaveMoment({ ...activeMoment, index: momentIndex })}
                    >
                      Save moment
                    </button>
                  )}
                </div>
              )}
            </details>
          </section>
        )}

        {(lanes.length > 0 || momentContext || (radar && chain.driverError)) && (
          <details
            className="chain-disclosure"
            open={compareOpen}
            onToggle={(event) => setCompareOpen(event.currentTarget.open)}
          >
            <summary>Compare</summary>
            <section className="chain-related" aria-label="Related data" data-tour="compare">
              <div className="lane-options" role="group" aria-label="Related data">
                {lanes.map((lane) => (
                  <button
                    key={lane.id}
                    type="button"
                    className="lane-option"
                    aria-pressed={lane === related}
                    onClick={() => setRelatedId(lane.id)}
                  >
                    {lane.label}
                  </button>
                ))}
                {lanes.length > 0 && (
                  <button
                    type="button"
                    className="lane-option"
                    aria-pressed={!related}
                    onClick={() => setRelatedId("none")}
                  >
                    Off
                  </button>
                )}
              </div>
              {momentContext && (
                <p className="chain-note related-moment">
                  <strong>{momentContext.label} · {momentContext.display}</strong>
                  <span>
                  {activeMoment.start === activeMoment.end
                    ? `${momentContext.span} · ${fmtDay(activeMoment.end)}`
                    : `${momentContext.span === "average" ? "Average" : "Total"} · ${fmtDay(activeMoment.start)} – ${fmtDay(activeMoment.end)}`}
                  </span>
                </p>
              )}
              {!driver && chain.driverError && (
                <p className="chain-note warning small">{chain.driverError}</p>
              )}
              {driver && (
                <div className="chain-lane">
                  {driver.place && <p className="lane-place muted">{driver.place}</p>}
                  <Readout value={formatAmount(relatedValue, driver.unit)} sub={relatedSub} />
                  {driver.series?.length ? (
                    <TimeLane
                      {...shared}
                      lane={{
                        chart: driver.chart,
                        color: COLORS[driver.kind],
                        points: driver.series,
                        windowDays,
                        scaleUnit: driver.chart === "bars" ? `${driver.unit}/day` : driver.unit,
                        description: `${driver.label}, daily, ${fmtDay(driver.series[0].date)} to ${fmtDay(driver.series.at(-1).date)}`,
                      }}
                    />
                  ) : (
                    <p className="lane-empty lane-plot-empty muted small">
                      No daily data for {driver.label.toLowerCase()} in this date range.
                    </p>
                  )}
                </div>
              )}
              {driver?.summary && <p className="related-note">{driver.summary}</p>}
              <p className="related-note">
                Supporting context, not a NISAR measurement. Lining up in time doesn’t show that one affects the other.
              </p>
            </section>
          </details>
        )}

        {moreSeries?.length > 0 && (
          <details className="chain-disclosure">
            <summary>More NISAR measurements</summary>
            <section className="chain-more" aria-label="More NISAR measurements">
              {moreSeries.map((series) => {
                const value = series.points.find((p) => p.date === selectedDate)?.value;
                return (
                  <div key={series.id} className="more-lane">
                    <div className="more-lane-head">
                      <span title={series.description}>{series.label}</span>
                      <strong data-testid="more-readout">{formatAmount(value, series.unit)}</strong>
                    </div>
                    <TimeLane
                      {...shared}
                      lane={{
                        chart: "line",
                        color: COLORS.radar,
                        points: series.points,
                        dots: true,
                        showLow: true,
                        activeDate: selectedDate,
                        dotTitle: (p) => `${fmtDay(p.date)}: ${formatAmount(p.value, series.unit)}`,
                        scaleUnit: series.unit,
                        className: "lane-compact",
                        description: `${series.label} on ${series.points.length} NISAR passes`,
                      }}
                    />
                  </div>
                );
              })}
            </section>
          </details>
        )}

        <details className="chain-disclosure">
          <summary>Sources &amp; method</summary>
          <div className="chain-about-body">
            <ul>
              <li>
                <a href={NISAR_CATALOG}>NISAR {radarProduct ?? "products"}</a>, NASA/ISRO.
                {area ? " Each tick is a catalog acquisition date." : " Every number above comes from these passes."}
              </li>
              {fpText && <li>{fpText}</li>}
              {!info && radar?.summary && <li>Record range · {radar.summary}</li>}
              {moments.length > 0 && (
                <li>
                  A change compares two passes. A pace is a straight line fitted
                  through every pass in the range, ± its standard error.
                </li>
              )}
              {driver?.source && (
                <li>
                  {driver.label}: <a href={driver.source.url}>{driver.source.name}</a>. {driver.note}
                </li>
              )}
              {chain.season_source && (
                <li>
                  Season labels: <a href={chain.season_source.url}>{chain.season_source.name}</a>.
                </li>
              )}
            </ul>
            <a href={METHODS_URL}>Full data and methods</a>
          </div>
        </details>
      </div>
      {popup}
    </EvidenceCard>
  );
}
