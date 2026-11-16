
import { describeMeasurement, siteSeries } from "../services/measurements.js";
import GranulePanel from "./GranulePanel.jsx";
import TimeSeriesChart from "./TimeSeriesChart.jsx";

const passDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const formatDate = (date) => passDate.format(new Date(`${date}T00:00:00Z`));

const MEASUREMENT_LABELS = {
  los_mm: "Ground movement",
  hv_db: "Radar brightness (HV)",
  hh_db: "Radar brightness (HH)",
};

/** Group the change type's metrics into one chart per unit, leaving out `skip`. */
function chartsFor(changeType, observations, skip = null) {
  const byUnit = new Map();
  for (const series of siteSeries(changeType, observations, skip)) {
    const chart = byUnit.get(series.unit) ?? { unit: series.unit, series: [] };
    chart.series.push(series);
    byUnit.set(series.unit, chart);
  }
  return [...byUnit.values()];
}

/** The site's kind of change, its event date, and how many of its passes are provisional. */
function Overview({ site, changeType, embedded, onBack }) {
  const scenes = site.scenes ?? [];
  const provisional = scenes.filter((s) => s.quality && s.quality !== "validated").length;
  return (
    <header className="detail-overview">
      {!embedded && <button type="button" className="btn btn-link" onClick={onBack}>← All places</button>}
      <p className="muted small detail-meta">
        <span className="dot" style={{ background: changeType?.color }} />
        {changeType?.label ?? site.change_type}
        {site.event_date ? ` · event ${site.event_date}` : ""}
      </p>
      {scenes.length > 0 && (
        <p className="measurement-coverage muted small">
          {scenes.length} NISAR {scenes.length === 1 ? "pass" : "passes"}
          {provisional > 0 && ` · ${provisional} provisional`}
        </p>
      )}
    </header>
  );
}

/** The headline series' value on the pass shown (ground movement: since the first pass). */
function Readout({ headline, unit, selectedDate }) {
  const observation = headline.points.find((point) => point.date === selectedDate);
  if (!observation) return <p className="muted small">No measurement for the selected pass.</p>;
  const measurement = describeMeasurement(headline.id, observation.value, unit);
  const when = headline.id === "los_mm"
    ? passDate.formatRange(new Date(`${headline.points[0].date}T00:00:00Z`), new Date(`${observation.date}T00:00:00Z`))
    : formatDate(observation.date);
  return (
    <div className="measurement-readout">
      <strong>{measurement.amount}</strong>
      {measurement.direction && <span>{measurement.direction}</span>}
      <span className="muted small">{when}</span>
    </div>
  );
}

/** A site without a story: its headline value and every series, charted here. */
function Measurements({ site, charts, selectedDate, onSelectDate }) {
  const headline = charts[0]?.series[0];
  if (!headline) return <p className="muted small">No NISAR measurements available yet.</p>;
  return (
    <section className="measurements" aria-labelledby="site-measurements-title">
      <h2 id="site-measurements-title">{MEASUREMENT_LABELS[headline.id] ?? headline.label}</h2>
      <Readout headline={headline} unit={charts[0].unit} selectedDate={selectedDate} />
      {headline.id === "los_mm" && site.reference && (
        <p className="measurement-reference muted small">Measured against the white reference point on the map.</p>
      )}
      {charts.map((chart) => (
        <TimeSeriesChart
          key={chart.unit}
          series={chart.series}
          unit={chart.unit}
          title={chart.series.map((s) => s.label).join(", ")}
          selectedDate={selectedDate}
          eventDate={site.event_date}
          onSelectDate={onSelectDate}
          showLegend={charts.length > 1 || chart.series.length > 1}
        />
      ))}
    </section>
  );
}

/** What the site is, how radar sees its change, what each series measures, and its frame and dates. */
function SiteNotes({ site, changeType, charts, open }) {
  const series = charts.flatMap((chart) => chart.series);
  const provenance = site.frame && site.first_date && site.last_date;
  return (
    <details className="site-notes" open={open}>
      <summary>Site notes &amp; data sources</summary>
      {site.description && <p>{site.description}</p>}
      {changeType?.radar_signature && <p>{changeType.radar_signature}</p>}
      {series.length > 0 && (
        <ul className="metric-notes small muted">
          {series.map((s) => <li key={s.id}><strong>{s.label}:</strong> {s.description}</li>)}
        </ul>
      )}
      {provenance && (
        <p className="muted small provenance">
          NISAR {site.product} · frame <code>{site.frame}</code> · {formatDate(site.first_date)} to {formatDate(site.last_date)}
        </p>
      )}
    </details>
  );
}

/**
 * One study site: what's changing, how radar sees it, and a live catalog
 * search. A site with a story (`site.story_metric`) has all its NISAR
 * series charted in the story panel next to the map, so this panel keeps
 * to the notes; without one, it charts the values here. `embedded` (inside a story) drops the back button.
 */
export default function SiteDetail({
  site,
  changeType,
  selectedDate,
  onSceneIndexChange,
  overlayOpacity,
  onOverlayOpacityChange,
  products,
  onBack,
  timelineHost,
  catalogOpen,
  onCatalogToggle,
  embedded = false,
}) {
  const storyMetric = site.story_metric ?? null;
  const charts = chartsFor(changeType, site.observations ?? [], storyMetric);
  const selectDate = (date) => {
    const i = (site.scenes ?? []).findIndex((s) => s.date === date);
    if (i >= 0) onSceneIndexChange(i);
  };

  return (
    <article className="site-detail" aria-label={site.name}>
      <Overview site={site} changeType={changeType} embedded={embedded} onBack={onBack} />
      {!storyMetric && <Measurements site={site} charts={charts} selectedDate={selectedDate} onSelectDate={selectDate} />}
      {/* With the charts beside the map, the notes are what's left here: open them. */}
      <SiteNotes site={site} changeType={changeType} charts={charts} open={Boolean(storyMetric)} />
      <details className="catalog" open={catalogOpen} onToggle={(e) => onCatalogToggle(e.currentTarget.open)}>
        <summary>Search the NISAR catalog</summary>
        {catalogOpen && (
          <GranulePanel
            key={site.bbox.join(",")}
            products={products}
            overlayOpacity={overlayOpacity}
            onOverlayOpacityChange={onOverlayOpacityChange}
            timelineHost={timelineHost}
          />
        )}
      </details>
    </article>
  );
}
