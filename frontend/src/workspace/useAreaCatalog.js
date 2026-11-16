// The NISAR catalog search beside a drawn area or a study site, owned by the
// workspace: it puts the results on the map and the area's series in the
// evidence card, and shares the same object with the panels that show it
// (through CatalogContext), so nothing has to be handed back up.

import { freshExplorer } from "../components/catalog/explorer.js";
import { useCatalogSearch } from "../components/catalog/useCatalogSearch.js";
import { useExplorer } from "../components/catalog/useExplorer.js";

const sameSearch = (a, b) => a?.product === b?.product && a?.start === b?.start && a?.end === b?.end;

/** Which results the explorer shows, and the key that starts its view afresh when they change. */
function shownResults(target, results) {
  const { query, granules, resultProduct, loading, error } = results;
  // Sharp imagery for this area ships with the app: show it at once, without
  // waiting on (or failing with) the live catalog search.
  const sharp = query?.product === "GCOV" && target?.imagery?.passes?.length > 0;
  const searched = !loading && !error && Boolean(resultProduct) && granules.length > 0;
  const bboxKey = target?.bbox.join(",") ?? "";
  return {
    shown: Boolean(target) && (sharp || searched),
    searched: Boolean(target) && searched,
    product: sharp ? "GCOV" : resultProduct,
    key: sharp ? `${bboxKey}:sharp:${target.imagery.slug ?? ""}` : `${bboxKey}:${resultProduct}:${granules.map((g) => g.id).join(",")}`,
  };
}

/** While no results are shown: is the search running, failed, or empty? */
function searchStatus(results) {
  if (results.error) return "error";
  return results.loading || results.hits === null ? "loading" : "empty";
}

/**
 * @param {object} options
 * @param {null | { bbox, defaultProduct, imagery, lockedProduct }} options.target  the area searched (null: no catalog open)
 * @param {object | null} options.search  the submitted search (selection state; null: the default)
 * @param {object | null} options.explorer  the explorer's view (selection state)
 * @param {Function} options.setSearch
 * @param {Function} options.setExplorer
 */
export function useAreaCatalog({ target, search, explorer, setSearch, setExplorer, opacity, backscatterLegend }) {
  const results = useCatalogSearch(target, search);
  const shown = shownResults(target, results);
  const ui = explorer?.key === shown.key ? explorer : freshExplorer(shown.key);
  const view = useExplorer({
    product: shown.product,
    granules: results.granules,
    bbox: target?.bbox ?? [],
    imagery: target?.imagery,
    start: results.query?.start,
    end: results.query?.end,
    ui,
    opacity,
    backscatterLegend,
  });
  const last = view.days.length - 1;
  // Change the view of these results (a new set starts afresh).
  const update = (change) => setExplorer((prev) => {
    const base = prev?.key === shown.key ? prev : freshExplorer(shown.key);
    return { ...base, ...change(base) };
  });

  const actions = {
    // Search again (an unchanged form searches again, as a retry).
    submit: (draft) => (sameSearch(draft, results.query) ? results.retry() : setSearch({ ...draft })),
    setMode: (mode) => update(() => ({ mode })),
    setLayer: (layer) => update(() => ({ layer })),
    setIndex: (next) => update((base) => {
      const current = base.index === null ? last : Math.min(base.index, last);
      return { index: typeof next === "function" ? next(current) : next };
    }),
    // Show a date in the time slider (from a chart, the mosaic's legend or the granule list).
    selectDate: (date, granuleId = null) => update(() => {
      const index = view.days.findIndex((d) => d.date === date);
      return index >= 0 ? { mode: "time", index, granuleId } : { granuleId };
    }),
  };

  return {
    target,
    results,
    shown: shown.shown,
    searched: shown.searched,
    view,
    ui,
    actions,
    // On the map while results are shown.
    mapLayers: shown.shown ? view.mapLayers : null,
    // For the evidence card: the day shown and the area's series, or how the search is going.
    observation: target && (shown.shown ? view.observation : { product: results.query.product, searchStatus: searchStatus(results) }),
  };
}
