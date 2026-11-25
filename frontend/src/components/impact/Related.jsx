import { formatAmount } from "../../services/measurements.js";
import { COLORS, METHODS_URL, NISAR_CATALOG, fmtDay } from "./constants.js";
import { momentSpan, relatedReading } from "./model.js";
import { Readout } from "./Record.jsx";
import TimeLane from "./TimeLane.jsx";

/** The related series shown: its place, its reading for the pass, and its lane. */
function RelatedLane({ driver, axis, passes, selectedDate, onSelectDate, windowDays }) {
  const { value, sub } = relatedReading(driver, selectedDate, windowDays);
  const series = driver.series ?? [];
  return (
    <div className="chain-lane">
      {driver.place && <p className="lane-place muted">{driver.place}</p>}
      <Readout value={formatAmount(value, driver.unit)} sub={sub} />
      {series.length ? (
        <TimeLane
          {...axis}
          passes={passes}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          lane={{
            chart: driver.chart,
            color: COLORS[driver.kind],
            points: series,
            windowDays,
            scaleUnit: driver.chart === "bars" ? `${driver.unit}/day` : driver.unit,
            description: `${driver.label}, daily, ${fmtDay(series[0].date)} to ${fmtDay(series.at(-1).date)}`,
          }}
        />
      ) : (
        <p className="lane-empty lane-plot-empty muted small">No daily data for {driver.label.toLowerCase()} in this date range.</p>
      )}
    </div>
  );
}

/** Buttons to pick one related series, or none. */
function LaneOptions({ lanes, related, onPick }) {
  return (
    <div className="lane-options" role="group" aria-label="Related data">
      {lanes.map((lane) => (
        <button key={lane.id} type="button" className="lane-option" aria-pressed={lane === related} onClick={() => onPick(lane.id)}>
          {lane.label}
        </button>
      ))}
      {lanes.length > 0 && (
        <button type="button" className="lane-option" aria-pressed={!related} onClick={() => onPick("none")}>
          Off
        </button>
      )}
    </div>
  );
}

/**
 * Supporting series (rain, river flow…) on the same axis, one at a time,
 * with the moment's related total or average. Context, not causes.
 */
export function CompareSection({ chain, hasRadar, related, moment, open, onToggle, onPickRelated, axis, passes, selectedDate, onSelectDate }) {
  const { lanes, related: shown, driver } = related;
  const context = moment?.related;
  const driverError = hasRadar ? chain.driverError : null;
  if (!lanes.length && !context && !driverError) return null;
  return (
    <details className="chain-disclosure" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary>Compare</summary>
      <section className="chain-related" aria-label="Related data" data-tour="compare">
        <LaneOptions lanes={lanes} related={shown} onPick={onPickRelated} />
        {context && (
          <p className="chain-note related-moment">
            <strong>{context.label} · {context.display}</strong>
            <span>{momentSpan(moment, context)}</span>
          </p>
        )}
        {!driver && chain.driverError && <p className="chain-note warning small">{chain.driverError}</p>}
        {driver && (
          <RelatedLane driver={driver} axis={axis} passes={passes} selectedDate={selectedDate} onSelectDate={onSelectDate} windowDays={chain.window_days} />
        )}
        {driver?.summary && <p className="related-note">{driver.summary}</p>}
        <p className="related-note">
          Supporting context, not a NISAR measurement. Lining up in time doesn’t show that one affects the other.
        </p>
      </section>
    </details>
  );
}

/** The site's other NISAR series, each with its reading for the pass shown. */
export function MoreSeries({ series, axis, passes, selectedDate, onSelectDate }) {
  if (!series?.length) return null;
  return (
    <details className="chain-disclosure">
      <summary>More NISAR measurements</summary>
      <section className="chain-more" aria-label="More NISAR measurements">
        {series.map((s) => (
          <div key={s.id} className="more-lane">
            <div className="more-lane-head">
              <span title={s.description}>{s.label}</span>
              <strong data-testid="more-readout">{formatAmount(s.points.find((p) => p.date === selectedDate)?.value, s.unit)}</strong>
            </div>
            <TimeLane
              {...axis}
              passes={passes}
              selectedDate={selectedDate}
              onSelectDate={onSelectDate}
              lane={{
                chart: "line",
                color: COLORS.radar,
                points: s.points,
                dots: true,
                nisarGap: true,
                showLow: true,
                activeDate: selectedDate,
                dotTitle: (p) => `${fmtDay(p.date)}: ${formatAmount(p.value, s.unit)}`,
                scaleUnit: s.unit,
                className: "lane-compact",
                description: `${s.label} on ${s.points.length} NISAR passes`,
              }}
            />
          </div>
        ))}
      </section>
    </details>
  );
}

/** Where every number comes from, and how it was worked out. */
export function SourcesSection({ chain, series, fpText, area, hasMoments, driver }) {
  return (
    <details className="chain-disclosure">
      <summary>Sources &amp; method</summary>
      <div className="chain-about-body">
        <ul>
          <li>
            <a href={NISAR_CATALOG}>NISAR {series.product ?? "products"}</a>, NASA/ISRO.
            {area ? " Each tick is a catalog acquisition date." : " Every number above comes from these passes."}
          </li>
          {fpText && <li>{fpText}</li>}
          {!series.info && series.radar?.summary && <li>Record range · {series.radar.summary}</li>}
          {hasMoments && (
            <li>A change compares two passes. A pace is a straight line fitted through every pass in the range, ± its standard error.</li>
          )}
          {driver?.source && (
            <li>{driver.label}: <a href={driver.source.url}>{driver.source.name}</a>. {driver.note}</li>
          )}
          {chain.season_source && (
            <li>Season labels: <a href={chain.season_source.url}>{chain.season_source.name}</a>.</li>
          )}
        </ul>
        <a href={METHODS_URL}>Full data and methods</a>
      </div>
    </details>
  );
}
