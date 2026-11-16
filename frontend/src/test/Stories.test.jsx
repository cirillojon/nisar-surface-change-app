import { act, fireEvent, render, renderHook, screen, waitFor, within } from "./render.jsx";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", () => ({
  fetchStory: vi.fn(),
  fetchFinding: vi.fn(),
  fetchCoverageCheck: vi.fn(),
  absoluteApiUrl: (path) => `http://api.test${path}`,
}));

import CoverageCheck from "../components/CoverageCheck.jsx";
import FindingCard from "../components/FindingCard.jsx";
import StoryList from "../components/StoryList.jsx";
import StoryPanel from "../components/StoryPanel.jsx";
import { fetchCoverageCheck, fetchFinding, fetchStory } from "../services/api.js";
import { readNotebook, storyMarkdown, useNotebook } from "../services/notebook.js";

const hypothesis = {
  id: "upstream-pulse",
  driver: "Rain in Angola, months earlier",
  mechanism: "A flood pulse travels slowly through the delta.",
  channel: "HH: newly flooded lagoons turn dark.",
  consistent_with: "Inflow peaked on 19 Feb; open water peaked on 8 Jul.",
  alternative: "The box covers only part of the delta. The record also starts late.",
  test: "Compare with gauge levels at Maun.",
  moments: [0],
};

const story = {
  slug: "okavango-flood-pulse",
  source: "site",
  theme: "water",
  theme_label: "Water",
  title: "A flood that arrives in the dry season",
  question: "Where does the water come from?",
  place: "An inland delta in the Kalahari.",
  channel: "HH. Calm water reads dark.",
  hero_moment: 0,
  hypothesis_label: "Hypothesis: not tested here",
  site: { name: "Okavango Delta", scene_count: 10, first_date: "2026-06-26", last_date: "2026-10-24" },
  saw: {
    label: "Open water",
    unit: "%",
    moments: [
      { index: 0, title: "Early July", caption: "The highest reading.", start: "2026-07-08", end: "2026-07-08", display: "11.0%", detail: "8 Jul 2026" },
      { index: 1, title: "Jul–Oct", caption: "Open water falls.", start: "2026-07-08", end: "2026-10-24", display: "−9.3 pts", detail: "11.0 → 1.7%" },
    ],
  },
  compare_with: [{ id: "river", label: "Okavango inflow", summary: "Peak 1,201 m³/s on 19 Feb 2026" }],
  hypotheses: [hypothesis],
  cant_see: ["Water under papyrus."],
  next: { application: "Tracking a transboundary flood pulse.", who: "Basin commissions.", needs: "Several years of passes." },
  uses: [{ role: "Resource managers", use: "See how far the flood spread." }],
};

const finding = {
  id: "okavango-flood-pulse/1",
  story: { slug: "okavango-flood-pulse", title: story.title, question: story.question, source: "site" },
  site: { slug: "okavango-flood-pulse", name: "Okavango Delta", product: "GCOV", frame: "172_A_168" },
  claim: {
    title: "Jul–Oct", display: "−9.3 pts", detail: "11.0 → 1.7%", caption: "Open water falls.",
    start: "2026-07-08", end: "2026-10-24", label: "Open water", unit: "%", measured: true,
  },
  moments: story.saw.moments.map(({ index, title, display }) => ({ index, title, display })),
  moment: 1,
  evidence: {
    passes: [
      { date: "2026-07-08", value: 11.0, quality: "provisional", valid_pct: 99.4, granule_id: "G1" },
      { date: "2026-10-24", value: 1.7, quality: "validated", valid_pct: 99.4, granule_id: "G2" },
    ],
    record_passes: 10,
  },
  confidence: { passes: 2, provisional: 1, partial_coverage: [], longest_gap_days: 24, record_days: 120,
    notes: ["1 of 2 passes are provisional, early-mission products."] },
  hypotheses: [hypothesis],
  hypothesis_label: "Hypothesis: not tested here",
  compare_with: [{ label: "Okavango inflow", summary: "Peak 1,201 m³/s" }],
  comparison_note: "Shown for comparison.",
  cant_see: ["Water under papyrus."],
  next: story.next,
  links: {
    workspace: "/workspace?mode=stories&finding=okavango-flood-pulse:1",
    api: "/api/findings/okavango-flood-pulse?moment=1",
    csv: "/api/stories/okavango-flood-pulse/series.csv",
    mcp: { tool: "build_finding", arguments: { story: "okavango-flood-pulse", moment: 1 } },
  },
  citation: "NISAR Surface Change Explorer, finding okavango-flood-pulse/1. Distributed by ASF DAAC.",
  caveat: "Most NISAR granules here are PROVISIONAL.",
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("StoryList", () => {
  it("groups stories by theme and selects one", () => {
    const onSelect = vi.fn();
    render(
      <StoryList
        data={{
          themes: [{ id: "water", label: "Water" }, { id: "ice", label: "Ice" }],
          stories: [
            { slug: "okavango-flood-pulse", theme: "water", title: story.title, question: story.question },
            { slug: "jakobshavn", theme: "ice", title: "Greenland's fastest glacier", question: "What does radar see on ice?" },
          ],
        }}
        selected="jakobshavn"
        onSelect={onSelect}
      />,
    );
    const ice = screen.getByRole("region", { name: "Ice" });
    const glacier = within(ice).getByRole("button", { name: /Greenland's fastest glacier/ });
    expect(glacier).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /A flood that arrives/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ slug: "okavango-flood-pulse" }));
  });
});

describe("StoryPanel", () => {
  it("keeps the title and action row mounted while the details load", async () => {
    let resolveStory;
    fetchStory.mockReturnValue(new Promise((resolve) => { resolveStory = resolve; }));
    render(<StoryPanel slug={story.slug} summary={story} onBack={() => {}} />);

    const title = screen.getByRole("heading", { name: story.title });
    const back = screen.getByRole("button", { name: "← All stories" });
    const share = screen.getByRole("button", { name: "Save / share" });
    expect(share).toBeDisabled();
    expect(screen.getByText("Loading the story…")).toBeVisible();
    expect(screen.queryByText(story.question)).toBeNull();

    await act(async () => resolveStory(story));
    // The query cache passes the story on in its next tick.
    await waitFor(() => expect(screen.getByText(story.question)).toBeVisible());

    expect(screen.getByRole("heading", { name: story.title })).toBe(title);
    expect(screen.getByRole("button", { name: "← All stories" })).toBe(back);
    expect(screen.getByRole("button", { name: "Save / share" })).toBe(share);
    expect(share).toBeEnabled();
    expect(screen.getByRole("group", { name: "Featured NISAR evidence" })).toBeVisible();
    expect(screen.getByText(story.question)).toBeVisible();
  });

  it("shows the map link and key caveat before the reasoning is expanded", async () => {
    fetchStory.mockResolvedValue(story);
    const onSelectDate = vi.fn();
    const onOpenFinding = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(
      <StoryPanel slug="okavango-flood-pulse" onSelectDate={onSelectDate} onOpenFinding={onOpenFinding} onSave={onSave}>
        <p>site data</p>
      </StoryPanel>,
    );
    expect(await screen.findByRole("heading", { name: story.title })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Featured NISAR evidence" })).toHaveTextContent("11.0%");
    for (const name of ["Possible explanations", "Method & limits", "Why it matters"]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.getByText("Untested", { exact: true })).toBeVisible();

    const card = screen.getByRole("heading", { level: 4, name: /Rain in Angola/ }).closest("li");
    expect(within(card).getByText(hypothesis.consistent_with)).toBeVisible();
    expect(within(card).getByText("Caveat").closest("p")).toHaveTextContent("The box covers only part of the delta.");
    expect(within(card).getByText("The record also starts late.")).not.toBeVisible();
    expect(within(card).getByText(hypothesis.mechanism)).not.toBeVisible();
    expect(within(card).getByText(hypothesis.test)).not.toBeVisible();

    // The heading opens the reasoning and exposes its state to assistive tech.
    const more = within(card).getByRole("button", { name: hypothesis.driver });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(card).getByRole("button", { name: "Show Early July on the map · 11.0%" }));
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-08", undefined);
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    for (const text of [hypothesis.mechanism, hypothesis.channel, hypothesis.test, "The record also starts late."]) {
      expect(within(card).getByText(text)).toBeVisible();
    }

    // Unlinked moments stay with the map and chart.
    expect(screen.queryByText("−9.3 pts")).not.toBeInTheDocument();
    expect(screen.queryByText(/See how far the flood spread/)).not.toBeInTheDocument();

    // Save / share: the viewer's notebook, the evidence card, a brief, the data.
    fireEvent.click(screen.getByRole("button", { name: "Save / share" }));
    const menu = screen.getByRole("group", { name: "Save or share this story" });
    expect(within(menu).getByRole("link", { name: "Printable brief" })).toHaveAttribute("href", "/brief/okavango-flood-pulse?moment=0");
    expect(within(menu).getByRole("link", { name: "CSV" })).toHaveAttribute(
      "href", "http://api.test/api/stories/okavango-flood-pulse/series.csv",
    );
    fireEvent.click(within(menu).getByRole("button", { name: "Evidence card" }));
    expect(onOpenFinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: "okavango-flood-pulse", moment: 0, label: "Early July · 11.0%" }),
    );
    fireEvent.click(within(menu).getByRole("button", { name: /Save to My findings/ }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ momentIndex: 0 }));

    // It follows the moment on the map.
    rerender(
      <StoryPanel slug="okavango-flood-pulse" selectedDate="2026-10-24" onOpenFinding={onOpenFinding}>
        <p>site data</p>
      </StoryPanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Evidence card" }));
    expect(onOpenFinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ moment: 1, label: "Jul–Oct · −9.3 pts" }),
    );
    expect(screen.getByRole("link", { name: "Printable brief" })).toHaveAttribute("href", "/brief/okavango-flood-pulse?moment=1");
    expect(screen.getByText("site data").closest("details")).not.toBeNull();
  });

  it("uses the suggested gallery pair for its main action and keeps its notes available", async () => {
    fetchStory.mockResolvedValue({
      ...story,
      slug: "jakobshavn",
      source: "landchange",
      title: "A Greenland fjord brightens",
      site: {
        name: "Jakobshavn Isbræ", scene_count: 11, first_date: "2026-06-18", last_date: "2026-10-28", pixel_m: 62,
        channels: { passes: 11, hv_passes: 0, label: "HH only on all 11 passes; HV was not collected" },
      },
      saw: {
        status: "likely", headline: "A broad area of the fjord brightened.", look_for: "Brighter areas near the ice front.",
        suggested: ["2026-06-18", "2026-10-28"],
      },
      hypotheses: [{
        ...hypothesis, moments: [], imagery_pair: ["2026-06-18", "2026-07-12"],
        caveat_summary: "Wind can brighten open water.",
      }],
    });
    const onOpenFinding = vi.fn();
    const onCompareImages = vi.fn();
    const panel = (activeChangePair) => (
      <StoryPanel slug="jakobshavn" onOpenFinding={onOpenFinding} onCompareImages={onCompareImages} activeChangePair={activeChangePair}>
        <p>dates and change map</p>
      </StoryPanel>
    );
    const { rerender } = render(panel(null));
    const evidence = await screen.findByRole("group", { name: "Featured NISAR evidence" });
    expect(within(evidence).getByText("Brighter areas near the ice front.")).toBeVisible();
    fireEvent.click(within(evidence).getByRole("button", { name: "Show the change map" }));
    expect(onCompareImages).toHaveBeenCalledWith("2026-06-18", "2026-10-28", "change");
    rerender(panel({ from: "2026-06-18", to: "2026-10-28" }));
    fireEvent.click(within(evidence).getByRole("button", { name: "Show the images" }));
    expect(onCompareImages).toHaveBeenLastCalledWith("2026-06-18", "2026-10-28", null);
    const notes = screen.getByText("dates and change map");
    expect(notes).not.toBeVisible();
    fireEvent.click(screen.getByText("Image notes & sources"));
    expect(notes).toBeVisible();
    expect(screen.getByText("Likely: verify")).toBeInTheDocument();
    const more = screen.getByRole("button", { name: hypothesis.driver });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Wind can brighten open water.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Compare Jun 18.*Jul 12.*on the map/ }));
    expect(onCompareImages).toHaveBeenLastCalledWith("2026-06-18", "2026-07-12");
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(screen.getByText(hypothesis.alternative)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save / share" }));
    expect(screen.queryByRole("link", { name: "CSV" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evidence card" }));
    expect(onOpenFinding).toHaveBeenCalledWith(expect.objectContaining({ slug: "jakobshavn", moment: null }));
  });

  it("can select either measured pass of the featured change", async () => {
    const moments = [story.saw.moments[0], {
      ...story.saw.moments[1], stat: "change", layer: "water", readings: [
        { date: "2026-07-08", display: "11.0%" }, { date: "2026-10-24", display: "1.7%" },
      ],
    }];
    fetchStory.mockResolvedValue({ ...story, hero_moment: 1, saw: { ...story.saw, moments } });
    const onSelectDate = vi.fn();
    render(<StoryPanel slug={story.slug} onSelectDate={onSelectDate} selectedDate="2026-07-08" />);
    const early = await screen.findByRole("button", { name: /Show Jul 8.*11\.0%/ });
    expect(early).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /Show Oct 24.*1\.7%/ }));
    fireEvent.click(early);
    expect(onSelectDate.mock.calls).toEqual([["2026-10-24", "water"], ["2026-07-08", "water"]]);
  });

  it("shows an error when the story can't load", async () => {
    fetchStory.mockRejectedValue({ message: "No story 'x'" });
    render(<StoryPanel slug="x" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No story 'x'");
  });
});

describe("FindingCard", () => {
  it("shows the measured claim, evidence, confidence and ways to reproduce it", async () => {
    fetchFinding.mockResolvedValue(finding);
    const onSave = vi.fn();
    const onShowOnMap = vi.fn();
    render(<FindingCard slug="okavango-flood-pulse" moment={1} onSave={onSave} onShowOnMap={onShowOnMap} />);
    expect(await screen.findByText("−9.3 pts")).toBeInTheDocument();
    expect(fetchFinding).toHaveBeenCalledWith("okavango-flood-pulse", 1);
    expect(screen.getByText("Measured")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("validated");
    expect(screen.getByText(/1 of 2 passes are provisional/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href", "http://api.test/api/stories/okavango-flood-pulse/series.csv",
    );
    expect(screen.getByRole("link", { name: "Printable brief" })).toHaveAttribute("href", "/brief/okavango-flood-pulse?moment=1");

    expect(screen.getByText(/Evidence card · generated by the app/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save to My findings/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ slug: "okavango-flood-pulse", moment: 1 }), finding);
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(onShowOnMap).toHaveBeenCalledWith(finding);
  });

  it("names the shared area, each pass's own value and its acquisition mode for open water", async () => {
    fetchFinding.mockResolvedValue({
      ...finding,
      evidence: {
        passes: [
          { date: "2026-09-12", value: 37.7, visible_value: 36.3, mode: "4005_DHDH", quality: "provisional", valid_pct: 100 },
          { date: "2026-09-24", value: 23.1, visible_value: 23.1, mode: "2005_QPDH", quality: "provisional", valid_pct: 83.3 },
        ],
        record_passes: 12,
        footprint: { status: "ok", pct_of_box: 83.1, passes: 12, method: "image", estimated: ["2026-09-12"], uncertainty_pp: 0.6 },
      },
    });
    render(<FindingCard slug="sylhet-haor-floods" moment={2} />);
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Pass", "%, shared area", "%, pixels it imaged", "Mode", "Quality", "Box imaged"]);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("37.736.34005_DHDH");
    expect(screen.getByText(/compared over the 83.1% of the box that all 12 passes imaged/)).toBeInTheDocument();
    expect(screen.getByText(/within about ±0.6 points/)).toBeInTheDocument();
  });

  it("copies the MCP call", async () => {
    fetchFinding.mockResolvedValue(finding);
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<FindingCard slug="okavango-flood-pulse" moment={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy MCP call" }));
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(finding.links.mcp);
    expect(await screen.findByRole("button", { name: "Copied ✓" })).toBeInTheDocument();
  });

  it("hides the actions in the printable brief", async () => {
    fetchFinding.mockResolvedValue(finding);
    render(<FindingCard slug="okavango-flood-pulse" moment={1} variant="brief" />);
    await screen.findByText("−9.3 pts");
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
  });

  it("offers no explanation for a moment that no hypothesis addresses", async () => {
    fetchFinding.mockResolvedValue({ ...finding, hypotheses: [], compare_with: [] });
    render(<FindingCard slug="okavango-flood-pulse" moment={1} />);
    await screen.findByText("−9.3 pts");
    expect(screen.queryByRole("heading", { name: "Possible explanations" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What this rests on" })).toBeInTheDocument();
  });
});

describe("My findings (the notebook)", () => {
  const moment = {
    kind: "moment",
    title: "Okavango: Jul–Oct",
    notes: "Falls steadily; I'd check the gauge at Maun.",
    source: { slug: "okavango-flood-pulse", moment: 1 },
    view: { mode: "stories", site: "okavango-flood-pulse", name: "Okavango Delta", date: "2026-10-24", layer: "water", layerLabel: "Very dark pixels" },
    evidence: { label: "Open water", display: "−9.3 pts", caption: "Open water falls.", start: "2026-07-08", end: "2026-10-24", source: "NASA/ISRO NISAR L2 GCOV" },
  };

  it("saves findings with notes into the viewer's own stories, and edits and orders them", () => {
    const { result } = renderHook(() => useNotebook());
    let story;
    let a;
    let b;
    act(() => {
      story = result.current.createStory("Delta watch");
    });
    act(() => {
      a = result.current.saveFinding(moment, { storyId: story });
    });
    act(() => {
      b = result.current.saveFinding({ ...moment, kind: "view", title: "Second", source: null });
    });
    act(() => result.current.addToStory(story, b));
    expect(result.current.stories[0].findingIds).toEqual([a, b]);
    act(() => result.current.moveInStory(story, b, -1));
    expect(result.current.stories[0].findingIds).toEqual([b, a]);
    act(() => result.current.updateFinding(a, { notes: "Edited." }));
    expect(readNotebook().findings.find((f) => f.id === a).notes).toBe("Edited.");
    expect(result.current.isSaved({ slug: "okavango-flood-pulse", moment: 1 })).toBe(true);
    // Deleting a finding takes it out of every story too.
    act(() => result.current.removeFinding(b));
    expect(result.current.stories[0].findingIds).toEqual([a]);
  });

  it("brings in findings saved by the earlier version, and survives broken storage", () => {
    window.localStorage.setItem("nisar.findings.v1", JSON.stringify([{ slug: "a", moment: 1, title: "A", label: "Jul · 3%" }]));
    const { findings } = readNotebook();
    expect(findings).toEqual([expect.objectContaining({
      kind: "moment", title: "A", notes: "", source: { slug: "a", moment: 1 }, evidence: { label: "Jul · 3%" },
    })]);
    // Read once: the notebook keeps them from then on.
    expect(JSON.parse(window.localStorage.getItem("nisar.notebook.v1")).findings).toHaveLength(1);

    window.localStorage.setItem("nisar.notebook.v1", "not json");
    expect(readNotebook()).toEqual({ findings: [], stories: [] });
  });

  it("exports a story with the viewer's words clearly apart from the app's evidence", () => {
    const f = { ...moment, id: "f1" };
    const text = storyMarkdown(
      { title: "Delta watch", notes: "Why I looked.", findingIds: ["f1"] },
      [f],
      { origin: "https://app.test", today: new Date("2026-11-15T00:00:00Z") },
    );
    expect(text).toContain("# Delta watch");
    expect(text).toContain("## Your notes\n\nWhy I looked.");
    const yours = text.indexOf("**Your notes**");
    const data = text.indexOf("**From the data (generated by the app)**");
    expect(yours).toBeGreaterThan(0);
    expect(data).toBeGreaterThan(yours);
    expect(text.slice(yours, data)).toContain("Falls steadily");
    expect(text.slice(data)).toContain("- Measurement: Open water: −9.3 pts");
    expect(text.slice(data)).toContain("- Map layer: Very dark pixels");
    expect(text.slice(data)).not.toContain("Falls steadily");
    expect(text).toContain("[Open in the workspace](https://app.test/workspace?mode=stories&finding=okavango-flood-pulse:1)");
    expect(text).toContain("not tested causes");
  });
});

describe("CoverageCheck", () => {
  it("summarises passes per product on the best frame", async () => {
    fetchCoverageCheck.mockResolvedValue({
      summary: "NISAR has GCOV passes here.",
      start: "2025-11-15",
      end: "2026-11-15",
      products: [
        { product: "GCOV", pass_dates: 30, best_frame: "172_A_168", frames: [{ frame: "172_A_168", pass_dates: 11, median_revisit_days: 12 }], verdict: "Enough passes to chart a seasonal series." },
        { product: "GOFF", pass_dates: 0, frames: [], verdict: "No passes in this window." },
        { product: "SME2", error: "NASA CMR search is unavailable" },
      ],
    });
    render(<CoverageCheck bbox={[22.5, -19.7, 23.2, -19.1]} />);
    const gcov = (await screen.findByText("GCOV")).closest("li");
    expect(fetchCoverageCheck).toHaveBeenCalledWith("22.5,-19.7,23.2,-19.1");
    expect(gcov).toHaveTextContent("11 passes, every 12 d");
    expect(gcov).toHaveTextContent("Enough passes to chart a seasonal series.");
    expect(screen.getByText("GOFF").closest("li")).toHaveTextContent("none");
    expect(screen.getByText("SME2").closest("li")).toHaveTextContent("not checked");
    expect(screen.getByText("SME2").closest("li")).toHaveTextContent("unavailable");
    expect(screen.getByText(/frame with most passes \(172_A_168\)/)).toBeInTheDocument();
  });

  it("says once when the catalog is down, and tries again on request", async () => {
    const down = { error: "NASA CMR search is unavailable; try again shortly" };
    fetchCoverageCheck.mockResolvedValueOnce({
      start: "2025-11-15",
      end: "2026-11-15",
      products: ["GCOV", "GUNW", "GOFF", "SME2"].map((product) => ({ product, ...down })),
    });
    render(<CoverageCheck bbox={[22.5, -19.7, 23.2, -19.1]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("NASA CMR search is unavailable");
    expect(screen.getAllByText(/unavailable/)).toHaveLength(1);
    expect(screen.queryByText("GCOV")).toBeNull();

    fetchCoverageCheck.mockResolvedValueOnce({
      start: "2025-11-15",
      end: "2026-11-15",
      products: [{ product: "GCOV", pass_dates: 3, frames: [{ pass_dates: 3 }], verdict: "A few passes." }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("GCOV")).toBeInTheDocument();
    expect(fetchCoverageCheck).toHaveBeenCalledTimes(2);
  });
});
