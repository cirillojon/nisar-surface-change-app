import { fireEvent, render, screen, waitFor } from "./render.jsx";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", () => ({
  fetchCoverageMapInfo: vi.fn(),
  fetchCoverageMapGrid: vi.fn(),
}));

import CoveragePanel from "../components/CoveragePanel.jsx";
import { fetchCoverageMapGrid, fetchCoverageMapInfo } from "../services/api.js";
import { cellIndex, colorAt, decodeGrid, paintHeatmap, valueAt } from "../services/coverageMap.js";
import { positionAt, splitAtAntimeridian, swathEdges } from "../services/orbit.js";

// jsdom has no 2D canvas: the panel then draws no image (and says nothing about it).
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

/** A 360x180 grid with `cells` ({index: value}) set, packed as the API packs it. */
function packedGrid(cells, extra = {}) {
  const raw = new Uint16Array(360 * 180).fill(65535);
  for (const [i, v] of Object.entries(cells)) raw[i] = v;
  const bytes = new Uint8Array(raw.buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return {
    product: "GCOV", metric: "passes", label: "Passes", unit: "passes", month: "2026-10", window: "month",
    start: "2026-10-01", end: "2026-10-31", cell_deg: 1, width: 360, height: 180, bbox: [-180, -90, 180, 90],
    scale: 1, nodata: 65535, values: btoa(binary), stats: { cells: Object.keys(cells).length, min: 1, max: 9 },
    color_max: 8, generated_at: "2026-11-20T00:00:00Z", ...extra,
  };
}

// The cell holding 41.5°N 11.5°E: row 48 (from 90°N), column 191 (from 180°W).
const ROME = 48 * 360 + 191;

describe("coverage heatmap", () => {
  it("decodes the packed grid and reads a cell under a point", () => {
    const grid = packedGrid({ [ROME]: 5 });
    const values = decodeGrid(grid);
    expect(valueAt(grid, values, 41.5, 11.5)).toBe(5);
    expect(valueAt(grid, values, 41.5, 11.5 + 360)).toBe(5); // a world copy east of the first
    expect(Number.isNaN(valueAt(grid, values, 0, 0))).toBe(true);
    expect(cellIndex(grid, 95, 0)).toBe(-1);
  });

  it("paints a cell where it is in each projection, and leaves empty cells clear", () => {
    const grid = packedGrid({ [ROME]: 8 });
    const values = decodeGrid(grid);
    const alphaAt = (pixels, width, x, y) => pixels[(y * width + x) * 4 + 3];

    const geo = paintHeatmap(grid, values, { width: 360, height: 180, projection: "geographic" });
    expect(alphaAt(geo, 360, 191, 48)).toBeGreaterThan(0);
    expect(alphaAt(geo, 360, 190, 48)).toBe(0);

    // Web Mercator: 41.5°N is ~25.5% down a square image spanning ±85.05°.
    const merc = paintHeatmap(grid, values, { width: 360, height: 360, projection: "mercator" });
    const y = Math.round(360 * (0.5 - Math.log(Math.tan(Math.PI / 4 + (41.5 * Math.PI) / 360)) / (2 * Math.PI)));
    expect(alphaAt(merc, 360, 191, y)).toBeGreaterThan(0);
    expect(alphaAt(merc, 360, 191, y + 6)).toBe(0);
  });

  it("colors along the palette's ends", () => {
    expect(colorAt(0)).toEqual([40, 11, 84]);
    expect(colorAt(1)).toEqual([252, 255, 164]);
    expect(colorAt(5)).toEqual(colorAt(1));
  });

  it("offers products and metrics in the API's order and reads the cell under the pointer", async () => {
    fetchCoverageMapInfo.mockResolvedValue({
      generated_at: "2026-11-20T00:00:00Z",
      months: ["2026-09", "2026-10"],
      products: [
        { id: "GCOV", label: "Backscatter (GCOV)", unit: "passes", granules: 10 },
        { id: "GUNW", label: "Interferogram (GUNW)", unit: "pairs", granules: 5 },
      ],
      metrics: [
        { id: "passes", label: "Passes", description: "How many passes." },
        { id: "days_since", label: "Days since last pass", description: "Days since." },
      ],
    });
    fetchCoverageMapGrid.mockImplementation(async (params) => packedGrid({ [ROME]: 5 }, params));
    const onLayer = vi.fn();
    render(<CoveragePanel pointer={{ lat: 41.6, lon: 11.4 }} onLayer={onLayer} />);

    expect(await screen.findByText("5 passes")).toBeInTheDocument();
    expect(fetchCoverageMapGrid).toHaveBeenLastCalledWith({ product: "GCOV", metric: "passes", month: "2026-10", window: "month" });
    const product = screen.getByRole("combobox", { name: "Product" });
    expect([...product.options].map((o) => o.value)).toEqual(["GCOV", "GUNW"]);

    // Pair products count pairs; days since the last pass ignores the period.
    fireEvent.change(product, { target: { value: "GUNW" } });
    expect(screen.getByRole("option", { name: "Pairs" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Metric" }), { target: { value: "days_since" } });
    expect(screen.getByRole("combobox", { name: "Period" })).toBeDisabled();

    fireEvent.change(screen.getByRole("slider", { name: "Month" }), { target: { value: "0" } });
    await waitFor(() =>
      expect(fetchCoverageMapGrid).toHaveBeenLastCalledWith({ product: "GUNW", metric: "days_since", month: "2026-09", window: "month" }),
    );
  });
});

describe("orbit", () => {
  const track = {
    startMs: Date.parse("2026-11-22T00:00:00Z"),
    stepS: 60,
    points: [
      [0, 179, 0, 750],
      [60, -179, 2, 752],
      [120, -177, 4, 754],
    ],
  };

  it("interpolates the satellite between points, across the antimeridian", () => {
    const p = positionAt(track, track.startMs + 30 * 1000);
    expect(Math.abs(p.lon)).toBeCloseTo(180, 5);
    expect(p.lat).toBeCloseTo(1, 5);
    expect(p.altKm).toBeCloseTo(751, 5);
    expect(p.ascending).toBe(true);
    expect(positionAt(track, track.startMs - 1)).toBeNull();
  });

  it("splits a line where it crosses the antimeridian", () => {
    const pieces = splitAtAntimeridian(track.points.map((p) => [p[1], p[2]]));
    expect(pieces).toHaveLength(2);
    expect(pieces[0].at(-1)).toEqual([1, 180]);
    expect(pieces[1][0]).toEqual([1, -180]);
  });

  it("puts the swath to the left of the direction of travel", () => {
    const north = swathEdges([[10, -1], [10, 0], [10, 1]]);
    const [lon, lat] = north.near[1];
    expect(lon).toBeLessThan(10); // heading north, left is west
    expect(lat).toBeCloseTo(0, 1);
    // 430 km at the equator is ~3.87°.
    expect(10 - lon).toBeCloseTo(3.87, 1);
    const south = swathEdges([[10, 1], [10, 0], [10, -1]]);
    expect(south.far[1][0]).toBeGreaterThan(10);
  });
});
