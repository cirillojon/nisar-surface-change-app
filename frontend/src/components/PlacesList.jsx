import { STATUS_LABEL, galleryThumb } from "../services/landchange.js";
import PlaceThumb from "./PlaceThumb.jsx";

const month = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
const span = (first, last) => (first && last ? `${month(first)} – ${month(last)}` : undefined);
const passes = (n) => (n ? `${n} ${n === 1 ? "pass" : "passes"}` : "No NISAR data yet");

/**
 * Investigate, list view: every place with data, in one list. Study sites
 * chart NISAR values on every pass; before & after places compare images
 * where something was reported to have changed, with the places that were
 * checked and showed nothing folded in below.
 */
export default function PlacesList({
  loading,
  sites,
  changeTypes,
  selectedSiteId,
  onSelectSite,
  landSites,
  landSlug,
  onSelectLand,
}) {
  const typeById = Object.fromEntries(changeTypes.map((ct) => [ct.id, ct]));
  const shown = (landSites ?? []).filter((s) => s.status !== "not_visible");
  const checked = (landSites ?? []).filter((s) => s.status === "not_visible");

  return (
    <div className="places-list">
      <section aria-labelledby="places-measured">
        <h2 id="places-measured" className="places-heading">Measured over time</h2>
        <p className="muted small places-hint">NISAR values charted on every pass.</p>
        {loading ? (
          <p className="muted" role="status">Loading sites…</p>
        ) : sites.length === 0 ? (
          <p className="muted">No study sites could be loaded.</p>
        ) : (
          <ul className="site-items">
            {sites.map((s) => {
              const ct = typeById[s.change_type];
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="site-item"
                    aria-current={s.id === selectedSiteId ? "true" : undefined}
                    title={span(s.first_date, s.last_date)}
                    onClick={() => onSelectSite(s.id)}
                  >
                    <PlaceThumb url={s.thumb_url} date={s.last_date} />
                    <span className="site-copy">
                      <strong>{s.name}</strong>
                      <span className="muted small">
                        <span className="dot" style={{ background: ct?.color }} aria-hidden="true" />
                        {ct?.label ?? s.change_type} · {passes(s.scene_count)}
                      </span>
                    </span>
                    <span className="site-chevron" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="places-gallery">
        <h2 id="places-gallery" className="places-heading">Before &amp; after</h2>
        <p className="muted small places-hint">Lava, ice, rivers and landslides, with a change map.</p>
        {landSites == null ? (
          <p className="muted" role="status">Loading places…</p>
        ) : shown.length === 0 ? (
          <p className="muted">No before &amp; after places could be loaded.</p>
        ) : (
          <ul className="site-items">
            {shown.map((s) => {
              const thumb = galleryThumb(s);
              const first = s.passes[0]?.date;
              const last = s.passes[s.passes.length - 1]?.date;
              return (
                <li key={s.slug}>
                  <button
                    type="button"
                    className="site-item"
                    aria-current={landSlug === s.slug ? "true" : undefined}
                    title={span(first, last)}
                    onClick={() => onSelectLand(s.slug)}
                  >
                    <PlaceThumb url={thumb?.image_url} date={thumb?.date} />
                    <span className="site-copy">
                      <strong>{s.name}</strong>
                      <span className="muted small">
                        <span className="dot dot-gallery" aria-hidden="true" />
                        {s.kind} · {s.region} · {passes(s.passes.length)}
                      </span>
                      {s.status !== "visible" && (
                        <span className={`badge land-badge-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                      )}
                    </span>
                    <span className="site-chevron" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {checked.length > 0 && (
          <details className="sources small">
            <summary>{checked.length} more places checked, nothing visible yet</summary>
            <ul className="muted land-checked">
              {checked.map((s) => (
                <li key={s.slug}>
                  <strong>{s.name}</strong> ({s.region}): {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
