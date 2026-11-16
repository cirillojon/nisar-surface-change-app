// The workspace's server data, as TanStack Query hooks. Each query's key
// names what it holds, so a newer selection never sees an older answer and
// a place opened twice is served from the cache.

import { queryOptions, useQuery } from "@tanstack/react-query";

import {
  fetchChangeTypes,
  fetchLandChange,
  fetchProducts,
  fetchSite,
  fetchSites,
  fetchStories,
} from "../../services/api.js";

const NO_PLACES = { sites: [] };
const NO_STORIES = { themes: [], stories: [] };
const NONE = [];

/** One study site with its passes and observations. */
export const siteQuery = (id) =>
  queryOptions({
    queryKey: ["site", id],
    queryFn: () => fetchSite(id),
    enabled: id != null,
  });

/**
 * What the workspace needs before anything else: change types, products and
 * the study sites. One query, so the map waits for all three, and one error
 * says the backend can't be reached.
 */
export function useCatalog() {
  const { data, error, isPending } = useQuery({
    queryKey: ["catalog"],
    queryFn: async () => {
      const [changeTypes, products, sites] = await Promise.all([fetchChangeTypes(), fetchProducts(), fetchSites()]);
      return { changeTypes, products, sites };
    },
  });
  return {
    changeTypes: data?.changeTypes ?? NONE,
    products: data?.products ?? NONE,
    sites: data?.sites ?? NONE,
    loading: isPending,
    error: error ? `Can't reach the backend: ${error?.message || "unknown error"}` : null,
  };
}

/** The land-change gallery: null while loading, no places if it failed. */
export function useLandChange() {
  const { data, isError } = useQuery({ queryKey: ["landChange"], queryFn: fetchLandChange });
  return isError ? NO_PLACES : data ?? null;
}

/** The curated stories: null while loading, none if they failed. */
export function useStories() {
  const { data, isError } = useQuery({ queryKey: ["stories"], queryFn: fetchStories });
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
