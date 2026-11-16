// Every backend read the app makes, as TanStack Query definitions: a key that
// names what it holds and the request that fetches it. Components use them
// with useQuery (or queryClient.fetchQuery from an event), so the app shares
// one cache: a site, story or search fetched by one panel is there for the
// next, concurrent requests for the same key are made once, and an answer for
// an earlier key never lands in a newer view. Freshness and retries are set
// once, in queryClient.js.

import { queryOptions } from "@tanstack/react-query";

import {
  fetchBrowseBounds,
  fetchChangeTypes,
  fetchCoverage,
  fetchCoverageCheck,
  fetchFinding,
  fetchLandChange,
  fetchProducts,
  fetchProfile,
  fetchSite,
  fetchSiteChain,
  fetchSites,
  fetchSme2Scene,
  fetchStories,
  fetchStory,
  searchGranules,
  startProfile,
} from "./api.js";
import { loadAreaChain } from "./chain.js";

// The catalog: change types, NISAR products, study sites.
export const changeTypesQuery = () => queryOptions({ queryKey: ["change-types"], queryFn: fetchChangeTypes });
export const productsQuery = () => queryOptions({ queryKey: ["products"], queryFn: fetchProducts });
export const sitesQuery = () => queryOptions({ queryKey: ["sites"], queryFn: fetchSites });

/** One study site with its passes and observations (`id` null: none). */
export const siteQuery = (id) =>
  queryOptions({ queryKey: ["site", id], queryFn: () => fetchSite(id), enabled: id != null });

/** A site's NISAR record: its series, moments and related series. */
export const siteChainQuery = (id) =>
  queryOptions({ queryKey: ["site-chain", id], queryFn: () => fetchSiteChain(id), enabled: id != null });

/**
 * A drawn area's record: its dates and the related series (daily rain at
 * its centre) for the chart. Waits for the area's dates (its first search).
 */
export const areaChainQuery = (bbox, start, end) =>
  queryOptions({
    queryKey: ["area-chain", bbox, start, end],
    queryFn: () => loadAreaChain(bbox, start, end),
    enabled: Boolean(bbox && start && end),
  });

/** The land-change gallery: { sites, imagery, db_range, … }. */
export const landChangeQuery = () => queryOptions({ queryKey: ["landchange"], queryFn: fetchLandChange });

/** Curated stories: themes and every story's summary. */
export const storiesQuery = () => queryOptions({ queryKey: ["stories"], queryFn: fetchStories });

/** One story: question, moments, hypotheses, limits and future uses. */
export const storyQuery = (slug) =>
  queryOptions({ queryKey: ["story", slug], queryFn: () => fetchStory(slug), enabled: Boolean(slug) });

/** One moment of a story as an evidence card (`moment` null: the key moment). */
export const findingQuery = (slug, moment = null) =>
  queryOptions({ queryKey: ["finding", slug, moment], queryFn: () => fetchFinding(slug, moment), enabled: Boolean(slug) });

/** Which NISAR products cover a box, how often, on which frames (`bbox` as a comma string). */
export const coverageCheckQuery = (bbox) =>
  queryOptions({ queryKey: ["coverage-check", bbox], queryFn: () => fetchCoverageCheck(bbox), enabled: Boolean(bbox) });

/** How many granules of each product cover a box between two dates. */
export const coverageQuery = ({ bbox, start, end }) =>
  queryOptions({
    queryKey: ["coverage", bbox.join(","), start, end],
    queryFn: () => fetchCoverage({ bbox, start, end }),
  });

/** NISAR granules of a product over a box between two dates (NASA CMR, via the backend). */
export const granulesQuery = ({ bbox, product = "GCOV", start, end, limit = 20 }) =>
  queryOptions({
    queryKey: ["granules", product, bbox.join(","), start, end, limit],
    queryFn: () => searchGranules({ bbox, product, start, end, limit }),
  });

/** Map bounds of a granule's browse image (from its KML). */
export const browseBoundsQuery = (kmlUrl) =>
  queryOptions({ queryKey: ["browse-bounds", kmlUrl], queryFn: () => fetchBrowseBounds(kmlUrl) });

/** One SME2 granule rendered over a box. */
export const sme2SceneQuery = ({ granule, bbox }) =>
  queryOptions({
    queryKey: ["sme2-scene", granule, bbox.join(",")],
    queryFn: () => fetchSme2Scene({ granule, bbox }),
  });

/** The height-profile job for a line: started (or found) on the backend. */
export const profileJobQuery = (line) =>
  queryOptions({ queryKey: ["profile-job", JSON.stringify(line)], queryFn: () => startProfile(line), enabled: Boolean(line) });

// How often a running height-profile job is asked how it is doing.
export const PROFILE_POLL_MS = 2000;

/** A height-profile job's state, asked again until it is done or failed. */
export const profileQuery = (id) =>
  queryOptions({
    queryKey: ["profile", id],
    queryFn: () => fetchProfile(id),
    enabled: id != null,
    staleTime: 0,
    // Until the job is done or failed, or the backend loses track of it.
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      const over = state === "done" || state === "error" || query.state.status === "error";
      return over ? false : PROFILE_POLL_MS;
    },
  });
