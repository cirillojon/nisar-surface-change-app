import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  api,
  fetchBrowseBounds,
  fetchHealth,
  fetchSites,
  invalidateCache,
  searchGranules,
} from "../services/api.js";

const ok = (data, status = 200) => ({
  data,
  status,
  statusText: "OK",
  headers: {},
  config: {},
});

function withAdapter(adapter, fn) {
  const prev = api.defaults.adapter;
  api.defaults.adapter = adapter;
  return Promise.resolve(fn()).finally(() => {
    api.defaults.adapter = prev;
  });
}

describe("services/api", () => {
  beforeEach(() => {
    invalidateCache();
  });

  it("fetchSites caches across calls and dedupes", async () => {
    const adapter = vi
      .fn()
      .mockResolvedValue(ok({ sites: [{ id: 1, name: "x" }] }));
    await withAdapter(adapter, async () => {
      const a = await fetchSites();
      const b = await fetchSites();
      expect(a).toEqual([{ id: 1, name: "x" }]);
      expect(b).toEqual(a);
      expect(adapter).toHaveBeenCalledTimes(1);
    });
  });

  it("searchGranules sends bbox/product/dates as query params", async () => {
    const adapter = vi
      .fn()
      .mockResolvedValue(ok({ product: "GUNW", hits: 0, granules: [] }));
    await withAdapter(adapter, async () => {
      const res = await searchGranules({
        bbox: [-99.3, 19.2, -98.9, 19.6],
        product: "GUNW",
        start: "2026-01-01",
        end: "2026-02-01",
      });
      expect(res.hits).toBe(0);
      const cfg = adapter.mock.calls[0][0];
      expect(cfg.url).toBe("/api/nisar/granules");
      expect(cfg.params).toMatchObject({
        bbox: "-99.3,19.2,-98.9,19.6",
        product: "GUNW",
        start: "2026-01-01",
        end: "2026-02-01",
      });
    });
  });

  it("fetchBrowseBounds returns the bbox and caches it", async () => {
    const adapter = vi.fn().mockResolvedValue(ok({ bbox: [1, 2, 3, 4] }));
    await withAdapter(adapter, async () => {
      const kml = "https://nisar.asf.earthdatacloud.nasa.gov/x_LATLON.kml";
      expect(await fetchBrowseBounds(kml)).toEqual([1, 2, 3, 4]);
      await fetchBrowseBounds(kml);
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(adapter.mock.calls[0][0].params).toEqual({ kml });
    });
  });

  it("fetchHealth returns parsed body", async () => {
    const adapter = vi
      .fn()
      .mockResolvedValue(ok({ status: "ok", site_count: 0 }));
    await withAdapter(adapter, async () => {
      const body = await fetchHealth();
      expect(body.status).toBe("ok");
    });
  });
});
