import { useEffect, useRef, useState } from "react";

import { fetchCoverage, searchGranules } from "../services/api.js";
import DataExplorer from "./DataExplorer.jsx";

// Granules fetched per search: enough to fill a time slider or mosaic
// over a large drawn area (matches MAX_RESULTS in app/nisar.py).
const SEARCH_LIMIT = 200;
// Longer lists start collapsed; the explorer above is the main view.
const LIST_OPEN_MAX = 10;

const isoDay = (offsetDays = 0) =>
  new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

const formatSize = (mb) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

/**
 * Search one NISAR product over `bbox`, explore every result on the map
 * (time slider or newest-first mosaic) and list the granules. Results are
 * lifted to the parent (`onResults`); map layers go out via `onMapLayers`.
 *
 * Remount (via `key`) when the area changes to reset the form.
 * `lockedProduct` keeps the menu on one product (the guided tour).
 */
export default function GranulePanel({
  bbox,
  defaultProduct = "GCOV",
  imagery = null,
  products,
  granules,
  onResults,
  overlayOpacity = 0.85,
  onOverlayOpacityChange = () => {},
  onMapLayers = () => {},
  backscatterLegend,
  onAreaSeries,
  onAreaRange,
  areaFocus,
  timelineHost,
  lockedProduct = null,
}) {
  const [resultProduct, setResultProduct] = useState(null);
  const [focus, setFocus] = useState(null); // { date } picked in the list
  const [draft, setDraft] = useState(() => ({
    product: lockedProduct ?? defaultProduct,
    // Sharp imagery for this area covers a whole year of passes: start there.
    start: imagery?.passes?.[0]?.date ?? isoDay(90),
    end: isoDay(0),
  }));
  const [query, setQuery] = useState(draft);
  const [hits, setHits] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { start, end } = query;

  useEffect(() => {
    onAreaRange?.({ start, end });
  }, [onAreaRange, start, end]);

  useEffect(() => {
    if (areaFocus) setFocus(areaFocus);
  }, [areaFocus]);

  // Search when the area or submitted query changes, not on every new
  // bbox array / callback identity from the parent.
  const bboxKey = bbox.join(",");
  const onResultsRef = useRef(onResults);
  useEffect(() => {
    onResultsRef.current = onResults;
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchGranules({
      bbox: bboxKey.split(",").map(Number),
      ...query,
      limit: SEARCH_LIMIT,
    })
      .then((res) => {
        if (cancelled) return;
        setHits(res.hits);
        setResultProduct(res.product ?? query.product);
        setFocus(null);
        onResultsRef.current(res.granules);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Search failed");
        setHits(null);
        setResultProduct(null);
        onResultsRef.current([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bboxKey, query]);

  // Which products have any data here, so the menu offers only those.
  const [coverage, setCoverage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCoverage(null);
    Promise.resolve(fetchCoverage({ bbox: bboxKey.split(",").map(Number), start, end }))
      .then((counts) => !cancelled && setCoverage(counts ?? null))
      .catch(() => {}); // unknown: every product stays selectable
    return () => {
      cancelled = true;
    };
  }, [bboxKey, start, end]);
  const hasNone = (id) => coverage?.[id] === 0 && id !== draft.product;
  const isLockedOut = (id) => Boolean(lockedProduct) && id !== lockedProduct;

  const productMeta = products.find((p) => p.id === draft.product);

  const onProductChange = (e) => {
    const next = { ...draft, product: e.target.value };
    setDraft(next);
    setQuery(next);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    // New object so an unchanged form still re-runs the search (retry).
    setQuery({ ...draft });
  };

  const searched = !loading && !error && resultProduct && granules.length > 0;
  // Sharp imagery for this area ships with the app: show it at once, without
  // waiting on (or failing with) the live catalog search.
  const sharpReady = query.product === "GCOV" && imagery?.passes?.length > 0;
  const showResults = searched || sharpReady;

  useEffect(() => {
    if (showResults) return;
    const searchStatus = error ? "error" : loading || hits === null ? "loading" : "empty";
    onAreaSeries?.({ product: query.product, searchStatus });
  }, [showResults, loading, hits, error, query.product, onAreaSeries]);

  return (
    <section className="granules" aria-label="NISAR data">
      <h3>NISAR data over this area</h3>
      <form className="granule-form" onSubmit={onSubmit}>
        <label>
          Product
          <select value={draft.product} onChange={onProductChange}>
            {products.map((p) => (
              <option key={p.id} value={p.id} disabled={hasNone(p.id) || isLockedOut(p.id)}>
                {p.label}
                {isLockedOut(p.id) ? " (after the tour)" : hasNone(p.id) ? " (none here)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={draft.start}
            max={draft.end}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={draft.end}
            min={draft.start}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {productMeta && <p className="muted small">{productMeta.description}</p>}

      {error && <p className="error">{error}</p>}
      {!loading && !error && hits !== null && (
        <p className="muted small">
          {hits} granule{hits === 1 ? "" : "s"} found
          {hits > granules.length ? ` · using the newest ${granules.length}` : ""}
        </p>
      )}

      {showResults && (
        <DataExplorer
          // Sharp imagery doesn't depend on the search: its arrival mustn't restart the player.
          key={sharpReady ? `${bboxKey}:sharp:${imagery.slug ?? ""}` : `${bboxKey}:${resultProduct}:${granules.map((g) => g.id).join(",")}`}
          product={sharpReady ? "GCOV" : resultProduct}
          granules={granules}
          bbox={bbox}
          focus={focus}
          opacity={overlayOpacity}
          onOpacityChange={onOverlayOpacityChange}
          onMapLayers={onMapLayers}
          backscatterLegend={backscatterLegend}
          onAreaSeries={onAreaSeries}
          timelineHost={timelineHost}
          imagery={imagery}
          dateRange={{ start, end }}
        />
      )}

      {searched && (
        <details className="granule-list" open={granules.length <= LIST_OPEN_MAX}>
          <summary>All {granules.length} granules</summary>
          <ul className="granule-items">
            {granules.map((g) => {
              const date = g.start?.slice(0, 10);
              const active = focus?.id === g.id;
              return (
                <li
                  key={g.id}
                  className={`granule ${active ? "granule-active" : ""}`}
                >
                  {g.thumbnail_url && (
                    <img
                      src={g.thumbnail_url}
                      alt=""
                      loading="lazy"
                      className="thumb"
                    />
                  )}
                  <div className="granule-body">
                    <div>
                      <strong>{date}</strong>{" "}
                      <span className={`badge badge-${g.quality}`}>
                        {g.quality}
                      </span>
                    </div>
                    <div className="muted small" title={g.title}>
                      {g.product}
                      {g.size_mb ? ` · ${formatSize(g.size_mb)}` : ""}
                    </div>
                    <div className="granule-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setFocus({ id: g.id, date })}
                        title="Show this date in the time slider"
                      >
                        Show on map
                      </button>
                      {g.data_url && (
                        <a
                          href={g.data_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary btn-small"
                          title="Requires a free NASA Earthdata Login"
                        >
                          Download .h5
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
