import { act, fireEvent, render, screen, within } from "./render.jsx";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", () => ({
  fetchSiteChain: vi.fn(),
  fetchAreaContext: vi.fn(),
}));

import ImpactChain from "../components/ImpactChain.jsx";
import {
  fetchAreaContext,
  fetchSiteChain,
} from "../services/api.js";

const source = { name: "Open-Meteo", url: "https://open-meteo.com", license: "CC BY 4.0" };
const daily = (start, values) =>
  values.map((value, i) => ({
    date: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
    value,
  }));

const chain = {
  available: true,
  window_days: 12,
  radar: {
    metric: "water_pct",
    label: "Open water",
    unit: "%",
    summary: "0.1% to 9.6%",
    points: [
      { date: "2026-08-18", value: 3.7, coverage: 100, quality: "provisional" },
      { date: "2026-08-30", value: 7, coverage: 83.3, quality: "provisional" },
      { date: "2026-09-11", value: 9.6, coverage: 100, quality: "validated" },
    ],
  },
  moments: [
    {
      id: "spreads",
      title: "Aug–Sep",
      season: null,
      caption: "Open water spreads across the box.",
      start: "2026-08-18",
      end: "2026-08-30",
      focus: "2026-08-30",
      stat: "change",
      display: "+3.3 pts",
      detail: "3.7% → 7.0%",
      layer: "water",
      related: { id: "rain", label: "Rain", value: 38.1, display: "38 mm", span: "total" },
    },
    {
      id: "peak",
      title: "Mid Sep",
      season: "Flood season",
      caption: "The highest reading in the record.",
      start: "2026-09-11",
      end: "2026-09-11",
      focus: "2026-09-11",
      stat: "value",
      display: "9.6%",
      detail: "11 Sep 2026",
      related: null,
    },
  ],
  drivers: [
    {
      id: "river",
      kind: "river",
      label: "Mekong flow",
      place: "near Tan Chau",
      unit: "m³/s",
      chart: "area",
      aggregate: "mean",
      source,
      note: "Modelled discharge.",
      series: daily("2026-08-01", [18000, 30000, 45003]),
      per_pass: [{ date: "2026-08-30", value: 45003 }],
      summary: "Peak 57,147 m³/s on 16 Sep 2026",
    },
    {
      id: "rain",
      kind: "rain",
      label: "Rain",
      place: "An Giang",
      unit: "mm",
      chart: "bars",
      aggregate: "sum",
      source,
      note: "A weather model.",
      series: daily("2026-08-01", [4, 0, 12]),
      per_pass: [{ date: "2026-08-30", value: 38.1 }],
      summary: "1,015 mm over the radar record",
    },
  ],
  season_source: { name: "FAO GIEWS crop calendar, India", url: "https://www.fao.org/giews/" },
};

const readouts = () =>
  screen.getAllByTestId("chain-readout").map((el) => el.textContent);

function selectPlotEdge(plot, clientX) {
  vi.spyOn(plot.querySelector(".lane-series"), "getBoundingClientRect")
    .mockReturnValue({ left: 8, width: 84 });
  fireEvent(plot, new MouseEvent("pointerdown", { bubbles: true, clientX }));
}

describe("<ImpactChain />", () => {
  beforeEach(() => {
    fetchSiteChain.mockReset();
    fetchAreaContext.mockReset();
  });

  it("leads with the NISAR series and sums up its moments without verdicts", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const onSelectDate = vi.fn();
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" onSelectDate={onSelectDate} />);

    const observation = await screen.findByRole("region", { name: "NISAR observation" });
    expect(within(observation).getByRole("heading", { name: /Open water/ })).toBeInTheDocument();
    expect(within(observation).queryByText("NISAR · L2 backscatter (GCOV)")).toBeNull();
    expect(within(observation).queryByText("0.1% to 9.6%")).toBeNull();
    expect(readouts()[0]).toBe("7%");

    const moments = screen.getByRole("region", { name: "Moments in the record" });
    expect(moments.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(within(moments).getByText("Moments", { exact: true }));
    const spreads = within(moments).getByRole("button", { name: /Aug–Sep/ });
    expect(spreads).toHaveAttribute("aria-pressed", "true");
    expect(within(spreads).getByText("+3.3 pts")).toBeInTheDocument();
    fireEvent.click(within(moments).getByRole("button", { name: /Mid Sep/ }));
    expect(onSelectDate).toHaveBeenLastCalledWith("2026-09-11");

    expect(screen.queryByText(/Moves together|Partly linked|No clear link|Correlation/)).toBeNull();

    const radarPlot = screen.getByRole("img", { name: "Open water on 3 NISAR passes" });
    selectPlotEdge(radarPlot, 100);
    expect(onSelectDate).toHaveBeenLastCalledWith("2026-09-11");
    selectPlotEdge(radarPlot, 0);
    expect(onSelectDate).toHaveBeenLastCalledWith("2026-08-18");
  });

  it("pops the selected moment up over the map and steps through the record", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const host = document.createElement("div");
    document.body.append(host);
    const onSelectDate = vi.fn();
    const onSaveMoment = vi.fn();
    const { rerender } = render(
      <ImpactChain siteId={2} selectedDate="2026-08-30" onSelectDate={onSelectDate} momentHost={host} onSaveMoment={onSaveMoment} />,
    );

    const popup = await within(host).findByRole("complementary", { name: "What NISAR shows here" });
    expect(within(popup).getByText("Open water spreads across the box.")).toBeInTheDocument();
    expect(within(popup).queryByText(/Rain|On the map:/)).toBeNull();
    const compare = screen.getByText("Compare");
    expect(compare.closest("details")).toHaveAttribute("open");
    expect(within(screen.getByRole("region", { name: "Related data" })).getByText("Rain · 38 mm")).toBeVisible();
    expect(within(popup).getByText("NISAR observation · 1 of 2")).toBeInTheDocument();
    // The number is in the pop-up, so the moment's tile beside the chart doesn't repeat it.
    expect(within(popup).getByText("+3.3")).toBeInTheDocument();
    const tile = screen.getByRole("button", { name: /Aug–Sep/ });
    expect(within(tile).queryByText(/3\.3/)).toBeNull();
    fireEvent.click(within(popup).getByRole("button", { name: "Save" }));
    expect(onSaveMoment).toHaveBeenCalledWith(expect.objectContaining({ id: "spreads", index: 0 }));
    fireEvent.click(within(popup).getByRole("button", { name: "Next ›" }));
    expect(onSelectDate).toHaveBeenLastCalledWith("2026-09-11");

    // Scrubbing to a pass outside every moment clears the pop-up.
    rerender(<ImpactChain siteId={2} selectedDate="2026-08-18" onSelectDate={onSelectDate} momentHost={host} />);
    expect(within(host).getByText("Open water spreads across the box.")).toBeInTheDocument();
    fireEvent.click(within(host).getByRole("button", { name: "Hide explanation" }));
    expect(host).toBeEmptyDOMElement();

    rerender(
      <ImpactChain
        siteId={2}
        selectedDate="2026-09-11"
        onSelectDate={onSelectDate}
        momentHost={host}
        showMomentPopup={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mid Sep/ }));
    expect(host).toBeEmptyDOMElement();
    host.remove();
  });

  it("keeps the selected pass and comparison when the card is closed and reopened", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const onOpenChange = vi.fn();
    const onSelectDate = vi.fn();
    const props = { siteId: 2, selectedDate: "2026-09-11", keepDate: true, onOpenChange, onSelectDate };
    const { rerender } = render(<ImpactChain {...props} open />);

    const reading = await screen.findByRole("region", { name: "NISAR observation" });
    const rain = screen.getByRole("button", { name: "Rain", exact: true });
    fireEvent.click(rain);
    expect(reading.closest(".chain-body")).toBeNull();
    expect(rain).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(rain, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    rerender(<ImpactChain {...props} open={false} />);
    expect(screen.queryByRole("region", { name: "NISAR story" })).toBeNull();
    const reopen = screen.getByRole("button", { name: "What NISAR saw" });
    expect(reopen).toHaveFocus();
    fireEvent.click(reopen);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    rerender(<ImpactChain {...props} open />);
    expect(screen.getByRole("button", { name: "Close NISAR card" })).toHaveFocus();
    expect(screen.getByText(/Sep 11, 2026/)).toHaveAttribute("datetime", "2026-09-11");
    expect(screen.getByRole("button", { name: "Rain", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(fetchSiteChain).toHaveBeenCalledOnce();
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it("keeps the pass if the card is dismissed while the record is loading", async () => {
    let resolveRecord;
    fetchSiteChain.mockReturnValueOnce(new Promise((resolve) => { resolveRecord = resolve; }));
    const onSelectDate = vi.fn();
    const props = { siteId: 2, selectedDate: "2026-09-11", onSelectDate, onOpenChange: vi.fn() };
    const { rerender } = render(<ImpactChain {...props} open />);
    fireEvent.click(screen.getByRole("button", { name: "Close NISAR card" }));
    rerender(<ImpactChain {...props} open={false} />);

    await act(async () => resolveRecord(chain));
    rerender(<ImpactChain {...props} open />);
    expect(screen.getByText(/Sep 11, 2026/)).toHaveAttribute("datetime", "2026-09-11");
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it("opens the story on its first moment, not the one holding the latest pass", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const onSelectDate = vi.fn();
    render(<ImpactChain siteId={2} selectedDate="2026-09-11" onSelectDate={onSelectDate} />);
    await screen.findByRole("region", { name: "Moments in the record" });
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-30");
  });

  it("stays on a pass that a link or a finding asked for", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const onSelectDate = vi.fn();
    render(<ImpactChain siteId={2} selectedDate="2026-09-11" onSelectDate={onSelectDate} keepDate />);
    await screen.findByRole("region", { name: "Moments in the record" });
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it("charts the site's other NISAR series on the same passes", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const more = [{
      id: "hh_db",
      label: "HH backscatter",
      unit: "dB",
      description: "HH.",
      points: [{ date: "2026-08-18", value: -12 }, { date: "2026-08-30", value: -10.5 }],
    }];
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" moreSeries={more} />);
    fireEvent.click(await screen.findByText("More NISAR measurements"));
    const section = screen.getByRole("region", { name: "More NISAR measurements" });
    expect(within(section).getByText("HH backscatter")).toBeInTheDocument();
    expect(within(section).getByTestId("more-readout")).toHaveTextContent("−10.5 dB");
    expect(within(section).getByRole("img", { name: "HH backscatter on 2 NISAR passes" })).toBeInTheDocument();
  });

  it("charts one related series at a time, labelled as context only, and no prices", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" />);

    const related = await screen.findByRole("region", { name: "Related data" });
    expect(within(related).getByText(/Supporting context, not a NISAR measurement/)).toBeInTheDocument();
    expect(within(related).getByText(/doesn’t show that one affects the other/)).toBeInTheDocument();
    expect(readouts()).toEqual(["7%", "45,003 m³/s"]);

    fireEvent.click(within(related).getByRole("button", { name: "Rain" }));
    expect(readouts()).toEqual(["7%", "38.1 mm"]);
    expect(within(related).getByText("12 days to the pass")).toBeInTheDocument();

    expect(within(related).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mekong flow", "Rain", "Off"]);
    fireEvent.click(within(related).getByRole("button", { name: "Off" }));
    expect(readouts()).toEqual(["7%"]);
    expect(screen.queryByText(/price|market/i)).toBeNull();
  });

  it("explains the measurement and the selected pass's coverage on request", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" />);

    fireEvent.click(await screen.findByRole("button", { name: "About this measurement" }));
    expect(screen.getByText("NISAR · L2 backscatter (GCOV)")).toBeVisible();
    expect(screen.getByText("0.1% to 9.6%")).toBeVisible();
    expect(screen.getByText(/HH below −18 dB/)).toBeVisible();
    expect(screen.getByText("83% of the box imaged · provisional data")).toBeVisible();
    expect(screen.getByText("Pass covering less of the box")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sources & method"));
    expect(screen.getByRole("link", { name: "FAO GIEWS crop calendar, India" })).toBeVisible();
  });

  it("keeps the NISAR plot fixed when a related series has a different date range", async () => {
    const [river, rain] = chain.drivers;
    fetchSiteChain.mockResolvedValueOnce({
      ...chain,
      drivers: [river, { ...rain, series: daily("2026-07-15", [0, 4, 0]) }],
    });
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" />);

    const radar = await screen.findByRole("img", { name: "Open water on 3 NISAR passes" });
    const radarPath = radar.querySelector("path").getAttribute("d");
    fireEvent.click(screen.getByRole("button", { name: "Rain" }));

    expect(screen.getByRole("img", { name: /Rain, daily/ })).toBeInTheDocument();
    expect(radar.querySelector("path")).toHaveAttribute("d", radarPath);
  });

  it("says so when the selected related series has no daily data", async () => {
    const [river, rain] = chain.drivers;
    fetchSiteChain.mockResolvedValueOnce({
      ...chain,
      drivers: [river, { ...rain, series: [], per_pass: [] }],
    });
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" />);

    fireEvent.click(await screen.findByRole("button", { name: "Rain" }));
    expect(screen.getByText(/No daily data for rain/)).toBeVisible();
    expect(screen.getByRole("img", { name: "Open water on 3 NISAR passes" })).toBeVisible();
  });

  it("plots a baseline when the selected rain series contains only zeroes", async () => {
    const [river, rain] = chain.drivers;
    fetchSiteChain.mockResolvedValueOnce({
      ...chain,
      drivers: [river, { ...rain, series: daily("2026-08-20", [0, 0, 0]), per_pass: [] }],
    });
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" />);

    fireEvent.click(await screen.findByRole("button", { name: "Rain" }));
    const plot = screen.getByRole("img", { name: /Rain, daily/ });
    expect(within(plot).getByText("0 mm/day")).toBeVisible();
    expect(plot.querySelector("path").getAttribute("d")).toMatch(/^M[\d.]+,100H[\d.]+$/);
  });

  it("shows the direction of cumulative ground movement and the fitted pace", async () => {
    fetchSiteChain.mockResolvedValueOnce({
      ...chain,
      radar: {
        metric: "los_mm",
        label: "Line-of-sight displacement",
        unit: "mm",
        summary: "−204 mm in 11 months",
        points: [
          { date: "2025-10-30", value: 0 },
          { date: "2026-10-13", value: -204 },
        ],
      },
      moments: [{
        id: "all",
        title: "Nov–Oct",
        caption: "Average pace.",
        start: "2025-10-30",
        end: "2026-10-13",
        focus: "2026-10-13",
        stat: "rate",
        display: "−17.1 mm/month",
        detail: "±0.4 · 2 passes",
        fit: { start: 0, end: -204 },
        related: null,
      }],
    });
    render(<ImpactChain siteId={3} selectedDate="2026-10-13" />);

    expect(await screen.findByRole("heading", { name: /Ground movement/ })).toBeInTheDocument();
    expect(screen.getByText("Away from the satellite")).toBeInTheDocument();
    expect(readouts()[0]).toBe("204 mm");
    expect(screen.getByText("Fitted pace")).toBeInTheDocument();
    expect(screen.getByText("Relative to the white reference point on the map.")).toBeInTheDocument();
    expect(document.querySelector(".lane-fit")).not.toBeNull();
  });

  it("picks a moment's map layer with its pass", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const onSelectLayer = vi.fn();
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" onSelectLayer={onSelectLayer} />);
    // The story opens on its first moment, and the map on the layer that shows it.
    await screen.findByRole("region", { name: "Moments in the record" });
    expect(onSelectLayer).toHaveBeenCalledWith("water");
  });

  it("compares open water over the shared footprint and marks each acquisition mode", async () => {
    const points = [
      { date: "2026-08-19", value: 34, coverage: 100, mode: "4005_DHDH" },
      { date: "2026-08-31", value: 24, coverage: 83.3, mode: "2005_QPDH" },
      { date: "2026-09-12", value: 37.7, coverage: 100, mode: "4005_DHDH" },
    ];
    fetchSiteChain.mockResolvedValueOnce({
      ...chain,
      radar: { ...chain.radar, points },
      footprint: {
        status: "ok", pct_of_box: 83.1, passes: 12, method: "image",
        estimated: ["2026-08-19", "2026-09-12"], uncertainty_pp: 0.6, min_pct: 50,
      },
      moments: [],
    });
    render(<ImpactChain siteId={2} selectedDate="2026-08-31" />);

    const coverage = await screen.findByText(/Over the 83\.1% of the box every pass imaged/);
    expect(coverage).not.toBeVisible();
    fireEvent.click(screen.getByText("Sources & method"));
    expect(coverage).toBeVisible();
    expect(coverage).toHaveTextContent("Passes that imaged more are estimated to within about ±0.6 points.");
    // Coverage no longer biases these values, so partial passes aren't flagged; modes are.
    expect(screen.queryByText("Pass covering less of the box")).toBeNull();
    expect(screen.getByText("Mode 4005_DHDH")).toBeInTheDocument();
    expect(screen.getByText("Mode 2005_QPDH")).toBeInTheDocument();
    const dots = [...document.querySelectorAll(".lane-hero .lane-dot")];
    expect(dots.map((d) => d.dataset.mode)).toEqual(["0", "1", "0"]);
    expect(dots.every((d) => d.dataset.partial === "false")).toBe(true);
  });

  it("says why there is nothing to chart when the passes share too little of the box", async () => {
    fetchSiteChain.mockResolvedValueOnce({
      available: false,
      reason: "The passes share only 31.0% of the box, under the 50% needed to compare open water between them.",
    });
    render(<ImpactChain siteId={9} />);
    expect(await screen.findByText(/share only 31.0% of the box/)).toBeInTheDocument();
  });

  it("keeps the panel in place for a site without a story", async () => {
    fetchSiteChain.mockResolvedValueOnce({ site_slug: "new-site", available: false });
    render(<ImpactChain siteId={9} />);
    const panel = screen.getByRole("region", { name: "NISAR story" });
    expect(await within(panel).findByText("This study site has no story yet.")).toBeInTheDocument();
  });

  it("keeps the analysis open when the map shows catalog imagery", async () => {
    fetchSiteChain.mockResolvedValueOnce(chain);
    const onReturnToStudy = vi.fn();
    render(<ImpactChain siteId={2} selectedDate="2026-08-30" onReturnToStudy={onReturnToStudy} />);
    const panel = screen.getByRole("region", { name: "NISAR story" });
    expect(await within(panel).findByText("+3.3 pts")).toBeInTheDocument();
    expect(within(panel).queryByRole("slider", { name: "Scene date" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Return to study images" }));
    expect(onReturnToStudy).toHaveBeenCalledOnce();
  });

  it("recovers from a failed load without reselecting the site", async () => {
    fetchSiteChain.mockRejectedValueOnce({ message: "Network error" }).mockResolvedValueOnce(chain);
    render(<ImpactChain siteId={2} />);
    expect(await screen.findByText(/could not be loaded \(Network error\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("+3.3 pts")).toBeInTheDocument();
  });

  it("shows a drawn area's data side by side without testing a relationship", async () => {
    fetchAreaContext.mockResolvedValueOnce({
      window_days: 12,
      drivers: [
        {
          id: "rain",
          kind: "rain",
          label: "Rainfall",
          place: "at the centre of the area",
          unit: "mm",
          chart: "bars",
          aggregate: "sum",
          source,
          note: "A weather model.",
          series: daily("2026-08-01", [...Array(12).fill(2), 5]),
          summary: "29 mm",
        },
      ],
    });
    const onSelectDate = vi.fn();
    render(
      <ImpactChain
        area={{ bbox: "-117.5,46.5,-117,47", start: "2026-08-01", end: "2026-08-13" }}
        areaObservation={{ product: "GCOV" }}
        passDates={["2026-08-01", "2026-08-13"]}
        selectedDate="2026-08-13"
        onSelectDate={onSelectDate}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Acquisition dates" })).toBeInTheDocument();
    // Browse imagery has no measured series: rain waits for one.
    expect(screen.queryAllByTestId("chain-readout")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Rainfall" })).toBeNull();
    expect(screen.queryByText("Compare")).toBeNull();
    expect(screen.getByText(/for a measured series/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Moments in the record" })).toBeNull();
    selectPlotEdge(screen.getByRole("img", { name: "2 NISAR passes" }), 0);
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-01");
    expect(fetchAreaContext).toHaveBeenCalledWith("-117.5,46.5,-117,47", "2026-08-01", "2026-08-13");
  });

  it("compares rain with a drawn area's measured series", async () => {
    fetchAreaContext.mockResolvedValueOnce({
      window_days: 12,
      drivers: [{
        id: "rain",
        kind: "rain",
        label: "Rainfall",
        place: "at the centre of the area",
        unit: "mm",
        chart: "bars",
        aggregate: "sum",
        source,
        note: "A weather model.",
        series: daily("2026-08-01", [...Array(12).fill(2), 5]),
      }],
    });
    render(
      <ImpactChain
        area={{ bbox: "-117.5,46.5,-117,47", start: "2026-08-01", end: "2026-08-13" }}
        areaObservation={{
          product: "SME2",
          series: { id: "soil_moisture", label: "Soil moisture", unit: "m³/m³", points: [{ date: "2026-08-13", value: 0.24 }] },
        }}
        selectedDate="2026-08-13"
      />,
    );
    const compare = await screen.findByText("Compare");
    expect(compare.closest("details")).toHaveAttribute("open");
    // Right under the NISAR series, before anything else.
    expect(compare.closest("details").previousElementSibling).toHaveClass("observation-record");
    // 11 days of 2 mm plus 5 mm on the pass day.
    expect(readouts()).toEqual(["0.24 m³/m³", "27 mm"]);
  });

  it("identifies soil moisture as a derived estimate", async () => {
    fetchAreaContext.mockResolvedValueOnce({ window_days: 12, drivers: [] });
    render(
      <ImpactChain
        area={{ bbox: "-117.5,46.5,-117,47", start: "2026-08-01", end: "2026-08-13" }}
        areaObservation={{
          product: "SME2",
          series: {
            id: "soil_moisture",
            label: "Soil moisture",
            unit: "m³/m³",
            points: [{ date: "2026-08-13", value: 0.24 }],
          },
        }}
        selectedDate="2026-08-13"
      />,
    );

    expect(await screen.findByRole("heading", { name: /Surface soil moisture/ })).toBeInTheDocument();
    expect(readouts()).toEqual(["0.24 m³/m³"]);
    fireEvent.click(screen.getByRole("button", { name: "About this measurement" }));
    expect(screen.getByText("NISAR · L3 soil moisture (SME2)")).toBeVisible();
    expect(screen.getByText(/weighted by coverage/)).toBeVisible();
  });
});
