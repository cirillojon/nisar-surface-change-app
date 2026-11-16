
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
  granules,
  onGranuleResults,
  onBack,
  onMapLayers,
  backscatterLegend,
  timelineHost,
  catalogOpen,
  onCatalogToggle, embedded = false,
}) {
  const scenes = site.scenes ?? [];
  const storyMetric = site.story_metric ?? null;
  const charts = chartsFor(changeType, site.observations ?? [], storyMetric);
  const provisional = scenes.filter(
    (s) => s.quality && s.quality !== "validated",
  ).length;
  const headline = storyMetric ? null : charts[0]?.series[0];
  const observation = headline?.points.find((point) => point.date === selectedDate);
  const groundMotion = headline?.id === "los_mm";
  const measurement = describeMeasurement(headline?.id, observation?.value, charts[0]?.unit);

  const selectDate = (date) => {
    const i = scenes.findIndex((s) => s.date === date);
    if (i >= 0) onSceneIndexChange(i);
  };

  return (
    <article className="site-detail" aria-label={site.name}>
      <header className="detail-overview">
        {!embedded && <button type="button" className="btn btn-link" onClick={onBack}>
          ← All places
        </button>}
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

      {storyMetric ? null : headline ? (
        <section className="measurements" aria-labelledby="site-measurements-title">
          <h2 id="site-measurements-title">{MEASUREMENT_LABELS[headline.id] ?? headline.label}</h2>
          {observation ? (
            <div className="measurement-readout">
              <strong>{measurement.amount}</strong>
              {measurement.direction && <span>{measurement.direction}</span>}
              <span className="muted small">
                {groundMotion
                  ? passDate.formatRange(
                    new Date(`${headline.points[0].date}T00:00:00Z`),
                    new Date(`${observation.date}T00:00:00Z`),
                  )
                  : formatDate(observation.date)}
              </span>
            </div>
          ) : (
            <p className="muted small">No measurement for the selected pass.</p>
          )}
          {groundMotion && site.reference && (
            <p className="measurement-reference muted small">
              Measured against the white reference point on the map.
            </p>
          )}
          {charts.map((chart) => (
            <TimeSeriesChart
              key={chart.unit}
              series={chart.series}
              unit={chart.unit}
              title={chart.series.map((s) => s.label).join(", ")}
              selectedDate={selectedDate}
              eventDate={site.event_date}
              onSelectDate={selectDate}
              showLegend={charts.length > 1 || chart.series.length > 1}
            />
          ))}
        </section>
      ) : (
        <p className="muted small">No NISAR measurements available yet.</p>
      )}

      {/* With the charts beside the map, the notes are what's left here: open them. */}
      <details className="site-notes" open={Boolean(storyMetric)}>
        <summary>Site notes &amp; data sources</summary>
        {site.description && <p>{site.description}</p>}
        {changeType?.radar_signature && <p>{changeType.radar_signature}</p>}
        {charts.length > 0 && (
          <ul className="metric-notes small muted">
            {charts.flatMap((chart) => chart.series).map((series) => (
              <li key={series.id}><strong>{series.label}:</strong> {series.description}</li>
            ))}
          </ul>
        )}
        {site.frame && site.first_date && site.last_date && (
          <p className="muted small provenance">
            NISAR {site.product} · frame <code>{site.frame}</code> ·{" "}
            {formatDate(site.first_date)} to {formatDate(site.last_date)}
          </p>
        )}
      </details>

      <details
        className="catalog"
        open={catalogOpen}
        onToggle={(e) => onCatalogToggle(e.currentTarget.open)}
      >
        <summary>Search the NISAR catalog</summary>
        {catalogOpen && (
          <GranulePanel
            key={site.bbox.join(",")}
            bbox={site.bbox}
            defaultProduct={changeType?.product ?? "GCOV"}
            products={products}
            granules={granules}
            onResults={onGranuleResults}
            overlayOpacity={overlayOpacity}
            onOverlayOpacityChange={onOverlayOpacityChange}
            onMapLayers={onMapLayers}
            backscatterLegend={backscatterLegend}
            timelineHost={timelineHost}
          />
        )}
      </details>
    </article>
  );
}
