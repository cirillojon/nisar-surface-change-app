import { useQuery } from "@tanstack/react-query";

import { coverageQuery, granulesQuery } from "../../services/queries.js";

// Granules fetched per search: enough to fill a time slider or mosaic over a
// large drawn area (matches MAX_RESULTS in app/nisar.py).
export const SEARCH_LIMIT = 200;

const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * The search a catalog starts with: the area's product (the tour's, if it
 * locks one) over the last 90 days, or over the whole year its sharp
 * imagery covers.
 */
export function defaultSearch(target) {
  return {
    product: target.lockedProduct ?? target.defaultProduct,
    start: target.imagery?.passes?.[0]?.date ?? isoDay(90),
    end: isoDay(0),
  };
}

/**
 * One NISAR product over a box: the granules NASA's catalog lists (through
 * the backend), and how many of each product cover it, so the menu can offer
 * only those. `target` is { bbox, defaultProduct, imagery, lockedProduct }
 * (null: no catalog open); `search` the submitted { product, start, end }
 * (null: the default).
 */
export function useCatalogSearch(target, search) {
  const query = target ? search ?? defaultSearch(target) : null;
  const bbox = target?.bbox ?? [];
  const results = useQuery({
    ...granulesQuery({ bbox, ...query, limit: SEARCH_LIMIT }),
    enabled: Boolean(target),
  });
  // Unknown coverage leaves every product selectable.
  const coverage = useQuery({ ...coverageQuery({ bbox, start: query?.start, end: query?.end }), enabled: Boolean(target) });
  const data = results.isError ? null : results.data;
  return {
    query,
    granules: data?.granules ?? [],
    hits: data?.hits ?? null,
    resultProduct: data ? data.product ?? query.product : null,
    loading: results.isFetching,
    error: results.error ? results.error.message || "Search failed" : null,
    coverage: coverage.data ?? null,
    retry: () => results.refetch(),
  };
}
