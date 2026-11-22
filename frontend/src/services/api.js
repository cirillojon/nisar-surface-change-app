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
 * Tiny in-memory cache + in-flight dedupe
 *   - prevents duplicate parallel requests for the same key
 *   - serves cached responses for `ttlMs` after success
 * ------------------------------------------------------------------*/
const cache = new Map(); // key -> { value, expiresAt }
const inflight = new Map(); // key -> Promise

async function cached(key, ttlMs, fetcher) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await fetcher();
      cache.set(key, { value, expiresAt: now + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function invalidateCache(prefix = "") {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

/* ------------------------------------------------------------------
 * Endpoints
 * ------------------------------------------------------------------*/
export const fetchHealth = () => api.get("/api/health").then((r) => r.data);

const TEN_MINUTES = 10 * 60 * 1000;
// Longer than the backend's own NASA timeouts, so its error message wins.
const NISAR_TIMEOUT_MS = 40 * 1000;

export const fetchChangeTypes = () =>
  cached("change-types", TEN_MINUTES, async () => {
    const r = await api.get("/api/change-types");
    return r.data.change_types;
  });

export const fetchProducts = () =>
  cached("nisar-products", TEN_MINUTES, async () => {
    const r = await api.get("/api/nisar/products");
    return r.data.products;
  });

export const fetchSites = () =>
  cached("sites", 30 * 1000, async () => {
    const r = await api.get("/api/sites", { params: { limit: 500 } });
    return r.data.sites;
  });

export const fetchSite = (siteId) =>
  cached(`site:${siteId}`, 30 * 1000, async () => {
    const r = await api.get(`/api/sites/${siteId}`);
    return r.data;
  });

/**
 * A site's NISAR story: its series, moments computed from it, related
 * series on the same dates and, for open water, the shared footprint.
 * `{ available: false }` when none is set up.
 */
export const fetchSiteChain = (siteId) =>
  cached(`site-chain:${siteId}`, TEN_MINUTES, async () => {
    const r = await api.get(`/api/sites/${siteId}/chain`);
    return r.data;
  });

/** Daily rain at the centre of a drawn area (`bbox` as a comma string). */
export const fetchAreaContext = (bbox, start, end) =>
  cached(`area-context:${bbox}:${start}:${end}`, TEN_MINUTES, async () => {
    const r = await api.get("/api/area-context", {
      params: { bbox, start, end },
      timeout: 30 * 1000,
    });
    return r.data;
  });

/**
 * Search NASA CMR (via our backend) for NISAR granules.
 * bbox: [minLon, minLat, maxLon, maxLat]; start/end: "YYYY-MM-DD".
 * Resolves to { product, hits, granules, start, end }.
 */
/**
 * How many granules of each product cover a box: { GCOV: 15, GUNW: 0, ... }
 * (null for a product whose search failed).
 */
export const fetchCoverage = ({ bbox, start, end }) =>
  cached(`coverage:${bbox.join(",")}:${start}:${end}`, 5 * 60 * 1000, async () => {
    const r = await api.get("/api/nisar/coverage", {
      params: { bbox: bbox.join(","), start, end },
      timeout: NISAR_TIMEOUT_MS,
    });
    return r.data.products;
  });

export const searchGranules = ({
  bbox,
  product = "GCOV",
  start,
  end,
  limit = 20,
}) => {
  const key = `granules:${product}:${bbox.join(",")}:${start}:${end}:${limit}`;
  return cached(key, 5 * 60 * 1000, async () => {
    const r = await api.get("/api/nisar/granules", {
      params: { bbox: bbox.join(","), product, start, end, limit },
      timeout: NISAR_TIMEOUT_MS,
    });
    return r.data;
  });
};

/**
 * Map bounds [minLon, minLat, maxLon, maxLat] of a granule's browse image
 * (larger than its footprint). Rejects when they can't be resolved.
 */
export const fetchBrowseBounds = (kmlUrl) =>
  cached(`browse-bounds:${kmlUrl}`, TEN_MINUTES, async () => {
    const r = await api.get("/api/nisar/browse-bounds", {
      params: { kml: kmlUrl },
      timeout: NISAR_TIMEOUT_MS,
    });
    return r.data.bbox;
  });

/** Land-change gallery: { sites, method, db_range, generated_at }. */
export const fetchLandChange = () =>
  cached("landchange", TEN_MINUTES, async () => {
    const r = await api.get("/api/landchange");
    return r.data;
  });

/**
 * Start (or find) the height-profile job for a line ([[lon, lat], ...]).
 * Resolves to { id, state }; poll fetchProfile(id) until state is
 * "done" (with `result`) or "error" (with `error`).
 */
export const startProfile = async (line) => {
  const r = await api.post("/api/nisar/profiles", { line });
  return r.data;
};

export const fetchProfile = async (id) => {
  const r = await api.get(`/api/nisar/profiles/${id}`);
  return r.data;
};

// Rendering a new SME2 pass reads NISAR data on the backend (5-20 s).
const SME2_TIMEOUT_MS = 90 * 1000;

/**
 * One SME2 granule rendered over `bbox`: { date, quality, values,
 * valid_pct, images: { backscatter, soil_moisture } } (image paths are
 * backend-relative; pass them through `assetUrl`).
 */
export const fetchSme2Scene = ({ granule, bbox }) =>
  cached(`sme2:${granule}:${bbox.join(",")}`, TEN_MINUTES, async () => {
    const r = await api.get("/api/nisar/sme2/scene", {
      params: { granule, bbox: bbox.join(",") },
      timeout: SME2_TIMEOUT_MS,
    });
    return r.data;
  });

/* Re-export retry helper for components that want optimistic flows */
export async function retry(fn, { tries = 3, delayMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err?.status && err.status < 500 && err.status !== 429) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------
 * Stories, findings and the coverage check (the workspace's modes)
 * ------------------------------------------------------------------*/

/** Themes and every story's summary. */
export const fetchStories = () =>
  cached("stories", TEN_MINUTES, async () => {
    const r = await api.get("/api/stories");
    return r.data;
  });

/**
 * Stories newest first (by the end of the period each one shows), a page at a
 * time: `{ stories, total, next_offset, latest_detection, themes }`. Filters:
 * theme, since / until (YYYY-MM-DD), origin ("curated" | "auto").
 */
export const fetchStoryFeed = ({ theme, since, until, origin, limit = 20, offset = 0 } = {}) => {
  const params = Object.fromEntries(
    Object.entries({ theme, since, until, origin, limit, offset }).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return cached(`story-feed:${new URLSearchParams(params)}`, TEN_MINUTES, async () => {
    const r = await api.get("/api/stories/feed", { params });
    return r.data;
  });
};

/** One story: question, moments, hypotheses, limits and future uses. */
export const fetchStory = (slug) =>
  cached(`story:${slug}`, TEN_MINUTES, async () => {
    const r = await api.get(`/api/stories/${encodeURIComponent(slug)}`);
    return r.data;
  });

/** One moment of a story as a finding card (`moment` null = the key moment). */
export const fetchFinding = (slug, moment = null) =>
  cached(`finding:${slug}:${moment ?? ""}`, TEN_MINUTES, async () => {
    const r = await api.get(`/api/findings/${encodeURIComponent(slug)}`, {
      params: moment == null ? {} : { moment },
    });
    return r.data;
  });

/** Which NISAR products cover a box, how often, on which frames. */
export const fetchCoverageCheck = (bbox) =>
  cached(`coverage-check:${bbox}`, TEN_MINUTES, async () => {
    const r = await api.get("/api/coverage-check", {
      params: { bbox },
      timeout: 60 * 1000,
    });
    return r.data;
  });

/** Absolute URL of a backend path, for links people copy or download. */
export const absoluteApiUrl = (path) => {
  const base = import.meta.env.VITE_API_BASE_URL || window.location.origin;
  return `${base}${path}`;
};
