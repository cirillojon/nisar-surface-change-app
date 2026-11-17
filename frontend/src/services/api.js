import axios from "axios";

/* ------------------------------------------------------------------
 * HTTP client
 * ------------------------------------------------------------------*/
const api = axios.create({
  // In dev: empty baseURL → relative /api/* → Vite proxy → backend.
  // In prod: VITE_API_BASE_URL → absolute URL of deployed backend.
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

// Exposed for tests so they can swap `api.defaults.adapter`.
export { api };

/** Backend origin ("" in dev, where Vite proxies /api). */
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * Absolute URL for a backend-relative path such as a scene's `image_url`.
 * Absolute URLs (e.g. NASA browse images) pass through unchanged.
 */
export const assetUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${import.meta.env.VITE_API_BASE_URL || ""}${path}`;
};

// Normalize errors so callers always see {status, message}.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.error || err?.message || "Network error";
    return Promise.reject({ status, message, original: err });
  },
);

/* ------------------------------------------------------------------
 * Endpoints: one request each. Caching, de-duplication and retries are
 * the query cache's (services/queries.js, services/queryClient.js).
 * ------------------------------------------------------------------*/
const get = (path, config) => api.get(path, config).then((r) => r.data);

export const fetchHealth = () => get("/api/health");

// Longer than the backend's own NASA timeouts, so its error message wins.
const NISAR_TIMEOUT_MS = 40 * 1000;
// Rendering a new SME2 pass reads NISAR data on the backend (5-20 s).
const SME2_TIMEOUT_MS = 90 * 1000;

export const fetchChangeTypes = () => get("/api/change-types").then((d) => d.change_types);

export const fetchProducts = () => get("/api/nisar/products").then((d) => d.products);

export const fetchSites = () => get("/api/sites", { params: { limit: 500 } }).then((d) => d.sites);

export const fetchSite = (siteId) => get(`/api/sites/${siteId}`);

/**
 * A site's NISAR story: its series, moments computed from it, related
 * series on the same dates and, for open water, the shared footprint.
 * `{ available: false }` when none is set up.
 */
export const fetchSiteChain = (siteId) => get(`/api/sites/${siteId}/chain`);

/** Daily rain at the centre of a drawn area (`bbox` as a comma string). */
export const fetchAreaContext = (bbox, start, end) =>
  get("/api/area-context", { params: { bbox, start, end }, timeout: 30 * 1000 });

/**
 * How many granules of each product cover a box: { GCOV: 15, GUNW: 0, ... }
 * (null for a product whose search failed).
 */
export const fetchCoverage = ({ bbox, start, end }) =>
  get("/api/nisar/coverage", { params: { bbox: bbox.join(","), start, end }, timeout: NISAR_TIMEOUT_MS })
    .then((d) => d.products);

/**
 * Search NASA CMR (via our backend) for NISAR granules.
 * bbox: [minLon, minLat, maxLon, maxLat]; start/end: "YYYY-MM-DD".
 * Resolves to { product, hits, granules, start, end }.
 */
export const searchGranules = ({ bbox, product = "GCOV", start, end, limit = 20 }) =>
  get("/api/nisar/granules", {
    params: { bbox: bbox.join(","), product, start, end, limit },
    timeout: NISAR_TIMEOUT_MS,
  });

/**
 * Map bounds [minLon, minLat, maxLon, maxLat] of a granule's browse image
 * (larger than its footprint). Rejects when they can't be resolved.
 */
export const fetchBrowseBounds = (kmlUrl) =>
  get("/api/nisar/browse-bounds", { params: { kml: kmlUrl }, timeout: NISAR_TIMEOUT_MS }).then((d) => d.bbox);

/** Land-change gallery: { sites, method, db_range, generated_at }. */
export const fetchLandChange = () => get("/api/landchange");

/**
 * Start (or find) the height-profile job for a line ([[lon, lat], ...]).
 * Resolves to { id, state }; poll fetchProfile(id) until state is
 * "done" (with `result`) or "error" (with `error`).
 */
export const startProfile = (line) => api.post("/api/nisar/profiles", { line }).then((r) => r.data);

export const fetchProfile = (id) => get(`/api/nisar/profiles/${id}`);

/**
 * One SME2 granule rendered over `bbox`: { date, quality, values,
 * valid_pct, images: { backscatter, soil_moisture } } (image paths are
 * backend-relative; pass them through `assetUrl`).
 */
export const fetchSme2Scene = ({ granule, bbox }) =>
  get("/api/nisar/sme2/scene", { params: { granule, bbox: bbox.join(",") }, timeout: SME2_TIMEOUT_MS });

/* ------------------------------------------------------------------
 * Stories, findings and the coverage check (the workspace's modes)
 * ------------------------------------------------------------------*/

/** Themes and every story's summary. */
export const fetchStories = () => get("/api/stories");

/** One story: question, moments, hypotheses, limits and future uses. */
export const fetchStory = (slug) => get(`/api/stories/${encodeURIComponent(slug)}`);

/** One moment of a story as a finding card (`moment` null = the key moment). */
export const fetchFinding = (slug, moment = null) =>
  get(`/api/findings/${encodeURIComponent(slug)}`, { params: moment == null ? {} : { moment } });

/** Which NISAR products cover a box, how often, on which frames. */
export const fetchCoverageCheck = (bbox) => get("/api/coverage-check", { params: { bbox }, timeout: 60 * 1000 });

/** Absolute URL of a backend path, for links people copy or download. */
export const absoluteApiUrl = (path) => {
  const base = import.meta.env.VITE_API_BASE_URL || window.location.origin;
  return `${base}${path}`;
};
