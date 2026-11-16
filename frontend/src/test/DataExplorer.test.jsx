import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", () => ({
  fetchBrowseBounds: vi.fn(),
  fetchSme2Scene: vi.fn(),
  assetUrl: (path) => path,
}));

import DataExplorer from "../components/DataExplorer.jsx";
import { fetchBrowseBounds, fetchSme2Scene } from "../services/api.js";

const BBOX = [0, 0, 2, 2];
const ALL = [
  [-1, -1],
  [-1, 3],
  [3, 3],
  [3, -1],
];
const WEST = [
  [-1, -1],
  [-1, 1],
  [3, 1],
  [3, -1],
];

const l2 = (id, day, footprint) => ({
  id,
  title: `NISAR_L2_PR_GCOV_001_010_A_020_${id}`,
  product: "GCOV",
  quality: "provisional",
  start: `${day}T12:00:00Z`,
  footprint,
  bbox: [-1, -1, 3, 3],
  browse_url: `https://browse.test/${id}.png`,
  browse_kml_url: `https://browse.test/${id}_LATLON.kml`,
});

const sme2 = (id, day, footprint) => ({
  ...l2(id, day, footprint),
  title: `NISAR_L3_PR_SME2_001_010_A_020_${id}`,
  product: "SME2",
  browse_url: null,
  browse_kml_url: null,
});

const lastLayers = (fn) => fn.mock.calls.at(-1)[0];

const props = (overrides = {}) => ({
  product: "GCOV",
  granules: [l2("old", "2026-10-01", ALL), l2("new", "2026-10-13", WEST)],
  bbox: BBOX,
  opacity: 0.85,
  onOpacityChange: () => {},
  onMapLayers: vi.fn(),
  ...overrides,
});

describe("<DataExplorer /> sharp imagery", () => {
  const imagery = {
    slug: "kilauea-tour",
    frame: "072_D_079",
    pixel_m: 20,
    bbox: [0, 0, 2, 2],
    passes: ["2026-09-01", "2026-09-13", "2026-09-25"].map((date) => ({
      date,
      quality: "provisional",
      image_url: `/api/scenes/landchange/kilauea-tour/${date}.webp`,
    })),
  };

  it("shows the sharp pass images in the area, with the layer picker", async () => {
    fetchBrowseBounds.mockReset();
    const p = props({ imagery, dateRange: { start: "2026-09-01", end: "2026-09-20" } });
    render(<DataExplorer {...p} />);

    await waitFor(() => expect(p.onMapLayers).toHaveBeenCalled());
    const tile = lastLayers(p.onMapLayers).tiles[0];
    expect(tile.url).toBe("/api/scenes/landchange/kilauea-tour/2026-09-13.webp");
    expect(tile.bounds).toEqual(imagery.bbox);
    // Only the passes inside the date range, and no browse-image lookups.
    expect(screen.getByText(/pass 2 of 2/)).toBeInTheDocument();
    expect(fetchBrowseBounds).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Mosaic/ })).toBeNull();
    const layers = screen.getByRole("combobox", { name: "Image layer" });
    expect(within(layers).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Colour (HH, HV)", "HH brightness", "HV brightness", "Very dark pixels",
    ]);
  });

  it("ignores the sharp imagery for other products", () => {
    const p = props({ imagery, product: "GUNW" });
    render(<DataExplorer {...p} />);
    expect(screen.queryByRole("combobox", { name: "Image layer" })).toBeNull();
  });
});

describe("<DataExplorer /> time slider", () => {
  beforeEach(() => {
    fetchBrowseBounds.mockReset();
    fetchBrowseBounds.mockResolvedValue([-1.2, -1.2, 3.2, 3.2]);
    fetchSme2Scene.mockReset();
  });

  it("starts on the newest date and draws its images clipped to the area", async () => {
    const p = props();
    render(<DataExplorer {...p} />);
    await waitFor(() => expect(lastLayers(p.onMapLayers).tiles).toHaveLength(1));
    const { tiles, outlines, opacity } = lastLayers(p.onMapLayers);
    expect(tiles[0].url).toBe("https://browse.test/new.png");
    expect(tiles[0].bounds).toEqual([-1.2, -1.2, 3.2, 3.2]);
    // Clip = footprint ∩ area: the west half of the box.
    const lons = tiles[0].clip[0][0].map(([lon]) => lon);
    expect(Math.min(...lons)).toBeCloseTo(0);
    expect(Math.max(...lons)).toBeCloseTo(1);
    expect(outlines).toHaveLength(1);
    expect(opacity).toBe(0.85);
    expect(screen.getByText(/pass 2 of 2/i)).toBeInTheDocument();
    // Both granules share a frame: its bounds are fetched once.
    expect(fetchBrowseBounds).toHaveBeenCalledTimes(1);
  });

  it("scrubs to another date", async () => {
    const p = props();
    render(<DataExplorer {...p} />);
    await waitFor(() => expect(lastLayers(p.onMapLayers).tiles).toHaveLength(1));
    fireEvent.change(screen.getByRole("slider", { name: /scene date/i }), {
      target: { value: "0" },
    });
    await waitFor(() =>
      expect(lastLayers(p.onMapLayers).tiles[0].url).toBe(
        "https://browse.test/old.png",
      ),
    );
  });

  it("places the catalog timeline below the map and removes it in mosaic mode", async () => {
    const timelineHost = document.createElement("div");
    const { container } = render(<DataExplorer {...props()} timelineHost={timelineHost} />);
    await waitFor(() => expect(within(timelineHost).getByRole("slider", { name: "Scene date" }))
      .toHaveAttribute("aria-valuetext", "2026-10-13"));
    expect(container.querySelector('[aria-label="Scene date"]')).toBeNull();

    fireEvent.click(within(timelineHost).getByRole("button", { name: /mosaic/i }));
    expect(within(timelineHost).queryByRole("slider", { name: "Scene date" })).toBeNull();

    fireEvent.click(within(timelineHost).getByRole("button", { name: /time slider/i }));
    expect(within(timelineHost).getByRole("slider", { name: "Scene date" }))
      .toHaveAttribute("aria-valuetext", "2026-10-13");
  });

  it("falls back to the footprint when exact bounds are unavailable", async () => {
    fetchBrowseBounds.mockRejectedValue({ status: 502 });
    const p = props();
    render(<DataExplorer {...p} />);
    expect(await screen.findByText(/placed approximately/i)).toBeInTheDocument();
    expect(lastLayers(p.onMapLayers).tiles[0].bounds).toEqual([-1, -1, 3, 3]);
  });

  it("jumps to a date picked in the granule list", async () => {
    const p = props();
    const { rerender } = render(<DataExplorer {...p} />);
    await screen.findByText(/pass 2 of 2/i);
    rerender(<DataExplorer {...p} focus={{ id: "old", date: "2026-10-01" }} />);
    expect(await screen.findByText(/pass 1 of 2/i)).toBeInTheDocument();
  });

  it("clears the map when closed", async () => {
    const p = props();
    const { unmount } = render(<DataExplorer {...p} />);
    await screen.findByText(/pass 2 of 2/i);
    unmount();
    expect(lastLayers(p.onMapLayers)).toBeNull();
  });
});

describe("<DataExplorer /> mosaic", () => {
  beforeEach(() => {
    fetchBrowseBounds.mockReset();
    fetchBrowseBounds.mockResolvedValue([-1.2, -1.2, 3.2, 3.2]);
  });

  it("tiles the area newest first and outlines each date", async () => {
    const p = props();
    render(<DataExplorer {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /mosaic/i }));
    await waitFor(() => expect(lastLayers(p.onMapLayers).tiles).toHaveLength(2));
    const { tiles, outlines } = lastLayers(p.onMapLayers);
    // Oldest drawn first so the newest is on top.
    expect(tiles.map((t) => t.url)).toEqual([
      "https://browse.test/old.png",
      "https://browse.test/new.png",
    ]);
    expect(outlines.map((o) => o.label)).toEqual([
      "2026-10-13 · 50% of the area",
      "2026-10-01 · 50% of the area",
    ]);
    expect(outlines[0].color).not.toBe(outlines[1].color);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText(/no GCOV data/i)).not.toBeInTheDocument();
  });

  it("says how much of the area is still empty", () => {
    render(
      <DataExplorer
        {...props({ granules: [l2("new", "2026-10-13", WEST)] })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mosaic/i }));
    expect(screen.getByText(/has no GCOV data in these dates/i)).toBeInTheDocument();
  });

  it("opens a date from the legend in the time slider", async () => {
    render(<DataExplorer {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /mosaic/i }));
    fireEvent.click(screen.getByRole("button", { name: /2026-10-01/ }));
    expect(await screen.findByText(/pass 1 of 2/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /time slider/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("<DataExplorer /> SME2", () => {
  beforeEach(() => {
    fetchSme2Scene.mockReset();
    fetchSme2Scene.mockImplementation(({ granule }) =>
      Promise.resolve({
        date: granule.endsWith("old") ? "2026-10-01" : "2026-10-13",
        quality: "provisional",
        image_bbox: [-1.5, -1.5, 3.5, 3.5],
        values: { hh_db: -10, hv_db: -20, water_pct: 5, soil_moisture: 0.3 },
        valid_pct: { backscatter: 90, soil_moisture: 80 },
        images: {
          backscatter: `/bs/${granule}.webp`,
          soil_moisture: `/sm/${granule}.webp`,
        },
      }),
    );
  });

  const sme2Props = () =>
    props({
      product: "SME2",
      granules: [sme2("old", "2026-10-01", ALL), sme2("new", "2026-10-13", WEST)],
    });

  it("renders passes on the backend and toggles soil moisture", async () => {
    const p = sme2Props();
    const onAreaSeries = vi.fn();
    render(<DataExplorer {...p} onAreaSeries={onAreaSeries} />);
    await waitFor(() =>
      expect(lastLayers(p.onMapLayers).tiles[0]?.url).toBe(
        "/bs/NISAR_L3_PR_SME2_001_010_A_020_new.webp",
      ),
    );
    // The newest (shown) pass is requested first.
    expect(fetchSme2Scene.mock.calls[0][0]).toEqual({
      granule: "NISAR_L3_PR_SME2_001_010_A_020_new",
      bbox: BBOX,
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Image layer" }), { target: { value: "soil_moisture" } });
    await waitFor(() =>
      expect(lastLayers(p.onMapLayers).tiles[0].url).toBe(
        "/sm/NISAR_L3_PR_SME2_001_010_A_020_new.webp",
      ),
    );
    expect(await screen.findByText(/Measured values/)).toBeInTheDocument();
    expect(onAreaSeries).toHaveBeenLastCalledWith({
      date: "2026-10-13",
      mode: "time",
      product: "SME2",
      series: expect.objectContaining({
        id: "soil_moisture",
        points: expect.arrayContaining([{ date: "2026-10-13", value: 0.3 }]),
      }),
      dates: ["2026-10-01", "2026-10-13"],
    });
  });

  it("stops after a missing login and explains it", async () => {
    fetchSme2Scene.mockReset();
    fetchSme2Scene.mockRejectedValue({
      status: 503,
      message: "Showing SME2 needs a NASA Earthdata Login",
    });
    render(<DataExplorer {...sme2Props()} />);
    expect(await screen.findByText(/needs a NASA Earthdata Login/)).toBeInTheDocument();
    // Two workers each tried once, then stopped.
    expect(fetchSme2Scene.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("places whole-frame images by their bounds and clips them to the area", async () => {
    const p = sme2Props();
    render(<DataExplorer {...p} bbox={[0, 0, 2, 2]} />);
    await waitFor(() => expect(lastLayers(p.onMapLayers).tiles).toHaveLength(1));
    const tile = lastLayers(p.onMapLayers).tiles[0];
    expect(tile.bounds).toEqual([-1.5, -1.5, 3.5, 3.5]);
    const lons = tile.clip[0][0].map(([lon]) => lon);
    expect(Math.min(...lons)).toBeCloseTo(0);
    expect(Math.max(...lons)).toBeCloseTo(1);
  });

  it("explores areas of any size", () => {
    render(<DataExplorer {...sme2Props()} bbox={[-125, 45, -116, 49]} />);
    expect(screen.queryByText(/per side/)).not.toBeInTheDocument();
  });
});
