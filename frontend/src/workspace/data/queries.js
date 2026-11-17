// The workspace's server data, as hooks over the app's query definitions
// (services/queries.js). Each query's key names what it holds, so a newer
// selection never sees an older answer and a place opened twice is served
// from the cache.

import { useQueries, useQuery } from "@tanstack/react-query";

import {
  changeTypesQuery,
  landChangeQuery,
  productsQuery,
  siteQuery,
  sitesQuery,
  storiesQuery,
} from "../../services/queries.js";

export { siteQuery };

const NO_PLACES = { sites: [] };
const NO_STORIES = { themes: [], stories: [] };
const NONE = [];

/**
 * What the workspace needs before anything else: change types, products and
 * the study sites. Loading until all three have answered or one has failed;
 * a failure says the backend can't be reached.
 */
export function useCatalog() {
  return useQueries({
    queries: [changeTypesQuery(), productsQuery(), sitesQuery()],
    combine: ([types, products, sites]) => {
      const failed = [types, products, sites].find((q) => q.isError);
      return {
        changeTypes: types.data ?? NONE,
        products: products.data ?? NONE,
        sites: sites.data ?? NONE,
        loading: !failed && [types, products, sites].some((q) => q.isPending),
        error: failed ? `Can't reach the backend: ${failed.error?.message || "unknown error"}` : null,
      };
    },
  });
}

/** The land-change gallery: null while loading, no places if it failed. */
export function useLandChange() {
  const { data, isError } = useQuery(landChangeQuery());
  return isError ? NO_PLACES : data ?? null;
}

/** The curated stories: null while loading, none if they failed. */
export function useStories() {
  const { data, isError } = useQuery(storiesQuery());
  return isError ? NO_STORIES : data ?? null;
}

/**
 * The selected study site (`id` null: none). `error` is why it couldn't
 * load, cleared while another try is under way; `retry` tries again.
 */
export function useSite(id) {
  const { data, error, isError, isFetching, refetch } = useQuery(siteQuery(id));
  return {
    data: id == null ? null : data ?? null,
    error: isError && !isFetching ? error?.message || "Couldn't load this site." : null,
    retry: refetch,
  };
}
