import { useState } from "react";

import { useCatalogContext } from "./catalog/CatalogContext.js";
import DataExplorer from "./DataExplorer.jsx";

// Longer lists start collapsed; the explorer above is the main view.
const LIST_OPEN_MAX = 10;

const formatSize = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

/** " (after the tour)", " (none here)" or nothing, for a product in the menu. */
function productNote(id, { lockedProduct, coverage, current }) {
  if (lockedProduct && id !== lockedProduct) return " (after the tour)";
  if (coverage?.[id] === 0 && id !== current) return " (none here)";
  return "";
}

/** Product and dates, searched on submit (a new product searches at once). */
function SearchForm({ products, draft, setDraft, loading, lockedProduct, coverage, onSubmit }) {
  const onProductChange = (e) => {
    const next = { ...draft, product: e.target.value };
    setDraft(next);
    onSubmit(next);
  };
  return (
    <form
      className="granule-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <label>
        Product
        <select value={draft.product} onChange={onProductChange}>
          {products.map((p) => {
            const note = productNote(p.id, { lockedProduct, coverage, current: draft.product });
            return (
              <option key={p.id} value={p.id} disabled={Boolean(note)}>
                {p.label}
                {note}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        From
        <input type="date" value={draft.start} max={draft.end} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
      </label>
      <label>
        To
        <input type="date" value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "Searching…" : "Search"}
      </button>
    </form>
  );
}

/** "12 granules found · using the newest 10", once a search has answered. */
function HitCount({ results }) {
  const { hits, granules, loading, error } = results;
  if (loading || error || hits === null) return null;
  return (
    <p className="muted small">
      {hits} granule{hits === 1 ? "" : "s"} found
      {hits > granules.length ? ` · using the newest ${granules.length}` : ""}
    </p>
  );
}

function GranuleItem({ granule: g, active, onShow }) {
  const date = g.start?.slice(0, 10);
  return (
    <li className={`granule ${active ? "granule-active" : ""}`}>
      {g.thumbnail_url && <img src={g.thumbnail_url} alt="" loading="lazy" className="thumb" />}
      <div className="granule-body">
        <div>
          <strong>{date}</strong> <span className={`badge badge-${g.quality}`}>{g.quality}</span>
        </div>
        <div className="muted small" title={g.title}>
          {g.product}
          {g.size_mb ? ` · ${formatSize(g.size_mb)}` : ""}
        </div>
        <div className="granule-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => onShow(date, g.id)} title="Show this date in the time slider">
            Show on map
          </button>
          {g.data_url && (
            <a href={g.data_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-small" title="Requires a free NASA Earthdata Login">
              Download .h5
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function GranuleList({ granules, activeId, onShow }) {
  return (
    <details className="granule-list" open={granules.length <= LIST_OPEN_MAX}>
      <summary>All {granules.length} granules</summary>
      <ul className="granule-items">
        {granules.map((g) => (
          <GranuleItem key={g.id} granule={g} active={activeId === g.id} onShow={onShow} />
        ))}
      </ul>
    </details>
  );
}

/**
 * Search one NISAR product over the open catalog's area, explore every
 * result on the map (time slider or newest-first mosaic) and list the
 * granules. The search and its results are the workspace's
 * (workspace/useAreaCatalog.js, shared through CatalogContext); this keeps
 * only the form being filled in.
 *
 * Remount (via `key`) when the area changes to reset the form.
 */
export default function GranulePanel({ products, overlayOpacity = 0.85, onOverlayOpacityChange = () => {}, timelineHost }) {
  const { target, results, shown, searched, ui, actions } = useCatalogContext();
  const [draft, setDraft] = useState(results.query);
  const productMeta = products.find((p) => p.id === draft.product);
  return (
    <section className="granules" aria-label="NISAR data">
      <h3>NISAR data over this area</h3>
      <SearchForm
        products={products}
        draft={draft}
        setDraft={setDraft}
        loading={results.loading}
        lockedProduct={target.lockedProduct}
        coverage={results.coverage}
        onSubmit={actions.submit}
      />
      {productMeta && <p className="muted small">{productMeta.description}</p>}
      {results.error && <p className="error">{results.error}</p>}
      <HitCount results={results} />
      {shown && (
        // A new set of results starts the explorer (and its player) afresh.
        <DataExplorer key={ui.key} opacity={overlayOpacity} onOpacityChange={onOverlayOpacityChange} timelineHost={timelineHost} />
      )}
      {searched && <GranuleList granules={results.granules} activeId={ui.granuleId} onShow={actions.selectDate} />}
    </section>
  );
}
