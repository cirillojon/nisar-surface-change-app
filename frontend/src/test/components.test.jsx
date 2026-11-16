import { act, fireEvent, render, screen, waitFor } from "./render.jsx";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", () => ({
  searchGranules: vi.fn(),
  fetchCoverage: vi.fn(() => new Promise(() => {})),
  fetchSme2Scene: vi.fn(),
  fetchBrowseBounds: vi.fn(),
  assetUrl: (path) => path,
}));

import GranulePanel from "../components/GranulePanel.jsx";
import ScenePlayer from "../components/ScenePlayer.jsx";
import SiteDetail from "../components/SiteDetail.jsx";
import TimeSeriesChart from "../components/TimeSeriesChart.jsx";
import { fetchCoverage, searchGranules } from "../services/api.js";
import { LOAD_TIMEOUT_MS } from "../services/imageCache.js";
import { CatalogHarness } from "./catalogHarness.jsx";
import { pauseAllPlayback } from "../services/usePlayback.js";

const scenes = [
  { date: "2026-06-01", quality: "provisional", image_url: "/a.webp" },
  { date: "2026-06-13", quality: "validated", image_url: "/b.webp" },
];

describe("<TimeSeriesChart />", () => {
  const series = [
    {
      id: "hv_db",
      label: "HV backscatter",
      color: "#0f0",
      points: [
        { date: "2026-01-01", value: -18 },
        { date: "2026-01-13", value: -16 },
      ],
    },
    {
      id: "hh_db",
      label: "HH backscatter",
      color: "#f0f",
      points: [
        { date: "2026-01-01", value: -10 },
        { date: "2026-01-13", value: -9 },
      ],
    },
  ];

  it("draws every series and reports the clicked date", () => {
    const onSelectDate = vi.fn();
    render(
      <TimeSeriesChart
        series={series}
        unit="dB"
        title="HV backscatter, HH backscatter"
        onSelectDate={onSelectDate}
      />,
    );
    const points = screen.getAllByTestId("chart-point");
    expect(points).toHaveLength(4);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "HV backscatter, HH backscatter from 2026-01-01 to 2026-01-13",
    );
    expect(screen.getByText("HH backscatter")).toBeInTheDocument();
    fireEvent.click(points[1]);
    expect(onSelectDate).toHaveBeenCalledWith("2026-01-13");
  });

  it("shows an empty state", () => {
    render(<TimeSeriesChart series={[]} unit="dB" title="HV" />);
    expect(screen.getByText(/no observations yet/i)).toBeInTheDocument();
  });
});

describe("<ScenePlayer />", () => {
  const props = {
    scenes,
    opacity: 0.8,
    onOpacityChange: () => {},
    product: "GUNW",
    imageRange: 40,
    legend: "red = away",
  };

  it("steps through scenes with the slider", () => {
    const onIndexChange = vi.fn();
    render(<ScenePlayer {...props} index={1} onIndexChange={onIndexChange} />);
    expect(screen.getByText("pass 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("validated")).toBeInTheDocument();
    expect(screen.getByText(/−40 mm \(away\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Scene date"), {
      target: { value: "0" },
    });
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("marks frames with clickable yellow lines when the tour asks", () => {
    const onIndexChange = vi.fn();
    render(<ScenePlayer {...props} index={1} onIndexChange={onIndexChange} guide={[{ index: 0, label: "2026-08-19" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2026-08-19" }));
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("plays onto a frame as soon as its image has loaded, and stops when paused from outside", async () => {
    vi.useFakeTimers();
    try {
      const onIndexChange = vi.fn();
      // jsdom never loads images, so each frame waits for the load timeout.
      // Fresh URLs: earlier tests already started loading the shared ones.
      const played = [...scenes, { ...scenes[0], date: "2026-06-25" }].map((s, i) => ({ ...s, image_url: `/play-${i}.webp` }));
      render(<ScenePlayer {...props} scenes={played} index={0} onIndexChange={onIndexChange} />);
      fireEvent.click(screen.getByRole("button", { name: /Play/ }));
      await act(() => vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1));
      expect(onIndexChange).not.toHaveBeenCalled();
      // Not held until a later tick: it moves on the moment the image is ready.
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(onIndexChange).toHaveBeenCalledWith(1);
      act(() => pauseAllPlayback());
      expect(screen.getByRole("button", { name: /Play/ })).toHaveAttribute("aria-pressed", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("compares a chosen before date with the current scene", () => {
    render(<ScenePlayer {...props} index={1} onIndexChange={() => {}} />);
    expect(screen.getByAltText("Site on 2026-06-01")).toHaveAttribute(
      "src",
      "/a.webp",
    );
    expect(screen.getByAltText("Site on 2026-06-13")).toHaveAttribute(
      "src",
      "/b.webp",
    );
    fireEvent.change(screen.getByLabelText("Before date"), {
      target: { value: "1" },
    });
    expect(screen.getAllByAltText("Site on 2026-06-13")).toHaveLength(2);
  });
});

describe("<GranulePanel />", () => {
  beforeEach(() => searchGranules.mockReset());

  const granule = {
    id: "G1",
    title: "NISAR_L2_PR_GCOV_X",
    product: "GCOV",
    quality: "validated",
    start: "2026-11-06T12:05:39.000Z",
    size_mb: 250.1,
    bbox: [0, 0, 1, 1],
    browse_url: "https://example.test/x_LATLON.png",
    thumbnail_url: null,
    data_url: "https://example.test/x.h5",
  };
  const panel = (products, harness = {}) =>
    render(
      <CatalogHarness bbox={[0, 0, 1, 1]} {...harness}>
        <GranulePanel products={products} />
      </CatalogHarness>,
    );

  it("searches on mount and reports results", async () => {
    searchGranules.mockResolvedValueOnce({ hits: 1, granules: [granule] });
    const onResults = vi.fn();
    panel(
      [
        { id: "GCOV", label: "Backscatter", description: "" },
        { id: "GUNW", label: "Interferogram", description: "" },
      ],
      { defaultProduct: "GUNW", onResults },
    );
    await waitFor(() => expect(onResults).toHaveBeenCalledWith([granule]));
    expect(searchGranules.mock.calls[0][0]).toMatchObject({ bbox: [0, 0, 1, 1], product: "GUNW" });
    expect(screen.getByText(/1 granule found/i)).toBeInTheDocument();
  });

  it("stays on the locked product, whatever the default", async () => {
    searchGranules.mockResolvedValueOnce({ hits: 1, granules: [granule] });
    panel(
      [
        { id: "GCOV", label: "Backscatter", description: "" },
        { id: "GUNW", label: "Interferogram", description: "" },
      ],
      { defaultProduct: "GUNW", lockedProduct: "GCOV" },
    );
    await waitFor(() => expect(searchGranules).toHaveBeenCalled());
    expect(searchGranules.mock.calls[0][0]).toMatchObject({ product: "GCOV" });
    expect(screen.getByRole("option", { name: /Interferogram \(after the tour\)/ })).toBeDisabled();
  });

  it("offers only the products that have data over the area", async () => {
    searchGranules.mockResolvedValue({ hits: 1, granules: [granule] });
    fetchCoverage.mockResolvedValueOnce({ GCOV: 12, GUNW: 0, SME2: null });
    panel([
      { id: "GCOV", label: "Backscatter", description: "" },
      { id: "GUNW", label: "Interferogram", description: "" },
      { id: "SME2", label: "Soil moisture", description: "" },
    ]);
    const none = await screen.findByRole("option", { name: "Interferogram (none here)" });
    expect(none).toBeDisabled();
    // A product whose search failed (null) stays selectable.
    expect(screen.getByRole("option", { name: "Soil moisture" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Backscatter" })).toBeEnabled();
  });

  it("lists granules with downloads and sizes in GB", async () => {
    const big = { ...granule, size_mb: 20981.3 };
    searchGranules.mockResolvedValue({ hits: 1, granules: [big] });
    panel([{ id: "GCOV", label: "Backscatter", description: "" }]);
    expect(await screen.findByText(/20\.5 GB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("href", granule.data_url);
    expect(screen.getByRole("button", { name: /show on map/i })).toBeInTheDocument();
    // Asks for enough granules to fill a large drawn area.
    expect(searchGranules.mock.calls[0][0].limit).toBe(200);
  });

  it("shows backend errors", async () => {
    searchGranules.mockRejectedValueOnce({ message: "NASA CMR search is unavailable" });
    panel([]);
    expect(await screen.findByText(/cmr search is unavailable/i)).toBeInTheDocument();
  });

  it("retries an unchanged search after an error", async () => {
    searchGranules
      .mockRejectedValueOnce({ message: "NASA CMR search is unavailable" })
      .mockResolvedValueOnce({ hits: 1, granules: [granule] });
    const onResults = vi.fn();
    panel([], { onResults });
    await screen.findByText(/cmr search is unavailable/i);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(onResults).toHaveBeenCalledWith([granule]));
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });
});

describe("<SiteDetail />", () => {
  const changeType = {
    id: "flood_wetland",
    label: "Floods & wetlands",
    metrics: [
      { id: "water_pct", label: "Open water", unit: "%", description: "Calm water share." },
      { id: "hh_db", label: "HH backscatter", unit: "dB", description: "HH." },
      { id: "hv_db", label: "HV backscatter", unit: "dB", description: "HV." },
    ],
  };
  const observations = ["2026-06-01", "2026-06-13"].flatMap((date, i) => [
    { observed_on: date, metric: "water_pct", value: 30 + i },
    { observed_on: date, metric: "hh_db", value: -16 + i },
    { observed_on: date, metric: "hv_db", value: -22 + i },
  ]);
  const site = {
    id: 3,
    name: "Haor",
    change_type: "flood_wetland",
    bbox: [91, 24.6, 91.6, 25.2],
    scenes,
    observations,
  };
  const props = {
    changeType,
    selectedDate: "2026-06-13",
    onSceneIndexChange: vi.fn(),
    onBack: vi.fn(),
    onCatalogToggle: vi.fn(),
  };

  it("leaves the charts to the story panel and opens the notes when the site has a story", () => {
    const { container } = render(
      <SiteDetail {...props} site={{ ...site, story_metric: "water_pct", description: "A seasonal wetland." }} />,
    );

    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryByText("31%")).toBeNull();
    expect(screen.getByText("2 NISAR passes · 1 provisional")).toBeInTheDocument();
    expect(container.querySelector(".site-notes")).toHaveAttribute("open");
    expect(screen.getByText("A seasonal wetland.")).toBeVisible();
  });

  it("charts every series, with the headline reading, when the site has no story", () => {
    render(<SiteDetail {...props} site={{ ...site, story_metric: null }} />);

    expect(screen.getByRole("heading", { name: "Open water" })).toBeInTheDocument();
    expect(screen.getByText("31%")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
