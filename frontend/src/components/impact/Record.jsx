import { monthTicks } from "../../services/chain.js";
import { describeMeasurement } from "../../services/measurements.js";
import { COLORS, monthFmt, tickFmt } from "./constants.js";
import { noReadingNote, passSummary, radarDotTitle } from "./model.js";
import TimeLane from "./TimeLane.jsx";

export function Readout({ value, sub }) {
  return (
    <div className="lane-readout">
      <strong data-testid="chain-readout">{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

/** The measurement's name, its "about" toggle, and its value on the pass shown. */
export function ObservationReading({ series, value, infoOpen, onToggleInfo }) {
  const { radar, metric, info } = series;
  const readout = describeMeasurement(metric, value, radar?.unit);
  return (
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
                onClick={onToggleInfo}
              >
                i
              </button>
            )}
          </h4>
        </div>
        {Number.isFinite(value) && <Readout value={readout.amount} sub={readout.direction} />}
      </div>
    </section>
  );
}

/** What the measurement is, its record's range and this pass's details. */
export function MetricInfo({ series, pass, passQuality }) {
  const { radar, info, product } = series;
  return (
    <dl className="metric-info" id="metric-info">
      <div>
        <dt>Product</dt>
        <dd>NISAR · {product}</dd>
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
          <dd>{passSummary(pass, passQuality)}</dd>
        </div>
      )}
    </dl>
  );
}

function MonthAxis({ t0, span }) {
  const ticks = monthTicks(t0, t0 + span, 5)
    .map((t) => ({ t, at: (t - t0) / span }))
    .filter(({ at }) => at > 0.06 && at < 0.94);
  return (
    <div className="chain-axis" aria-hidden="true">
      {ticks.map(({ t, at }, i) => (
        <span key={t} style={{ left: `${at * 100}%` }}>{i === 0 ? monthFmt.format(t) : tickFmt.format(t)}</span>
      ))}
    </div>
  );
}

/** What the dots and lines mean, when any of the special ones are drawn. */
function LaneKey({ series, fit }) {
  const { hasPartial, modeIndex, modes } = series;
  if (!hasPartial && !fit && !modeIndex) return null;
  return (
    <p className="lane-key">
      {fit && <span className="key-fit">Fitted pace</span>}
      {hasPartial && <span className="key-partial">Pass covering less of the box</span>}
      {modeIndex && modes.map((m, i) => (
        <span key={m} className={i ? "key-mode-alt" : "key-mode"}>Mode {m}</span>
      ))}
    </p>
  );
}

/** The NISAR lane: every pass (or its value), the moment shown, and the month axis. */
function RadarLane({ series, axis, passes, moment, fit, selectedDate, onSelectDate }) {
  const { radar, flagPartial, modeIndex } = series;
  const lane = {
    chart: radar ? "line" : "ticks",
    color: COLORS.radar,
    points: radar?.points ?? [],
    dots: true,
    nisarGap: true,
    showLow: true,
    activeDate: selectedDate,
    highlight: moment ? { start: moment.start, end: moment.end } : null,
    fit,
    flagPartial,
    modeIndex,
    dotTitle: (p) => radarDotTitle(p, { unit: radar.unit, flagPartial, modeIndex }),
    scaleUnit: radar?.unit,
    className: "lane-hero",
    description: radar ? `${radar.label} on ${radar.points.length} NISAR passes` : `${passes.length} NISAR passes`,
  };
  return (
    <>
      <TimeLane {...axis} passes={passes} selectedDate={selectedDate} onSelectDate={onSelectDate} lane={lane} />
      <MonthAxis t0={axis.t0} span={axis.span} />
      <LaneKey series={series} fit={fit} />
    </>
  );
}

/** The record: the measurement's facts (when asked for), its lane, and notes on the reading. */
export function RadarRecord({ series, axis, passes, moment, fit, value, pass, passQuality, infoOpen, area, areaObservation, selectedDate, onSelectDate }) {
  return (
    <div className="observation-record">
      {series.info && infoOpen && <MetricInfo series={series} pass={pass} passQuality={passQuality} />}
      {passes.length > 0 && (
        <RadarLane series={series} axis={axis} passes={passes} moment={moment} fit={fit} selectedDate={selectedDate} onSelectDate={onSelectDate} />
      )}
      {series.metric === "los_mm" && !area && (
        <p className="observation-note">Relative to the white reference point on the map.</p>
      )}
      {!Number.isFinite(value) && (
        <p className="observation-note">{noReadingNote({ radar: series.radar, areaObservation, passes })}</p>
      )}
    </div>
  );
}
