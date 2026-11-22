import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "./render.jsx";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  assetUrl: (path) => path,
  fetchChangeTypes: vi.fn(),
  fetchFinding: vi.fn(),
  fetchLandChange: vi.fn(),
  fetchProducts: vi.fn(),
  fetchSite: vi.fn(),
  fetchSites: vi.fn(),
  fetchStories: vi.fn(),
  fetchStory: vi.fn(),
  searchPlaces: vi.fn(),
  // An area's catalog stays loading: its panels have their own tests.
  fetchAreaContext: vi.fn(() => new Promise(() => {})),
  fetchCoverage: vi.fn(() => new Promise(() => {})),
  fetchCoverageCheck: vi.fn(() => new Promise(() => {})),
  searchGranules: vi.fn(() => new Promise(() => {})),
}));
// The map, the players and the charts have their own tests. Here they are
// stand-ins that show what the workspace hands them.
vi.mock("../components/ChangeMap.jsx", () => ({
  default: ({ selectedSiteId, selectedPlace, homeKey, onSelectSite }) => (
    <div data-testid="map" data-site={selectedSiteId ?? ""} data-place={selectedPlace ?? ""} data-home={homeKey}>
      <button type="button" onClick={() => onSelectSite(2)}>Okavango marker</button>
    </div>
  ),
}));
// The globe needs WebGL: a stand-in with its markers and its fallback.
vi.mock("../components/GlobeMap.jsx", () => ({
  default: ({ focusBbox, drawing, onSelectSite, onDrawArea, onUnavailable }) => (
    <div data-testid="globe" data-focus={focusBbox?.join(",") ?? ""} data-drawing={drawing ?? ""}>
      <button type="button" onClick={() => onSelectSite(2)}>Okavango on the globe</button>
      <button type="button" onClick={() => onDrawArea([10, 20, 11, 21])}>Drag a box on the globe</button>
      <button type="button" onClick={onUnavailable}>No WebGL</button>
    </div>
  ),
}));
vi.mock("../components/ImpactChain.jsx", () => ({
  default: ({ siteId }) => <div data-testid="charts" data-site={siteId ?? ""} />,
}));
vi.mock("../components/ScenePlayer.jsx", () => ({
  default: ({ scenes, index, comparison }) => (
    <p data-testid="player" data-before={scenes[comparison?.before]?.date}>{scenes[index]?.date}</p>
  ),
}));
vi.mock("../components/LandPlayer.jsx", () => ({
  default: ({ player, comparison }) => (
    <p data-testid="player" data-before={comparison ? player.compared.from : undefined}
      data-after={player.compared.to} data-layer={player.layer}>{player.site.slug}</p>
  ),
}));
vi.mock("../components/FindingCard.jsx", () => ({
  default: ({ slug, moment }) => <article aria-label="Evidence card">{`${slug}/${moment ?? ""}`}</article>,
}));

import SitePending from "../components/SitePending.jsx";
import { fetchChangeTypes, fetchFinding, fetchLandChange, fetchProducts, fetchSite, fetchSites, fetchStories, fetchStory, searchPlaces } from "../services/api.js";
import { testQueryClient as createQueryClient } from "./render.jsx";
import { TOUR_STORAGE_KEY } from "../services/tour.js";
import WorkspaceApp from "../workspace/WorkspaceApp.jsx";
import { MAP_VIEW_KEY } from "../workspace/useWorkspace.js";
import {
  DEFAULT_MODE,
  findingParam,
  historyAction,
  modeForPlace,
  modeFrom,
  panelView,
  parseFinding,
  readWorkspaceUrl,
  workspaceParams,
} from "../workspace/navigation.js";

describe("the navigation model", () => {
  it("shows a tab's view of the selection where it has one, else its list", () => {
    expect(panelView({ mode: "stories" })).toBe("stories");
    expect(panelView({ mode: "investigate" })).toBe("places");
    expect(panelView({ mode: "mine" })).toBe("mine");
    // The same place, seen from each tab.
    const place = { hasSelection: true, hasStory: true };
    expect(panelView({ mode: "stories", ...place })).toBe("story");
    expect(panelView({ mode: "investigate", ...place })).toBe("details");
    expect(panelView({ mode: "mine", ...place })).toBe("mine");
    // A story's evidence card opens in Stories, over the story.
    expect(panelView({ mode: "stories", ...place, findingOpen: true })).toBe("finding");
    // A drawn area, or a place without a story, has nothing to show in Stories.
    expect(panelView({ mode: "stories", hasSelection: true })).toBe("stories");
  });

  it("reads what a workspace link asks for", () => {
    expect(readWorkspaceUrl("mode=stories&site=sylhet&date=2026-07-14&finding=sylhet:2&demo=1")).toEqual({
      mode: "stories", site: "sylhet", date: "2026-07-14", place: null, comparison: null, finding: "sylhet:2", demo: true,
    });
    expect(readWorkspaceUrl(new URLSearchParams("place=etna&site="))).toEqual({
      mode: null, site: null, date: null, place: "etna", comparison: null, finding: null, demo: false,
    });
  });

  it("writes a link that reopens the same view", () => {
    expect(workspaceParams({ mode: "stories" })).toEqual({ mode: "stories" });
    expect(workspaceParams({ mode: "investigate", site: "punjab-crop-cycles", date: "2026-03-21" })).toEqual({
      mode: "investigate",
      site: "punjab-crop-cycles",
      date: "2026-03-21",
    });
    // A date belongs to a study site's passes, not to a gallery place.
    expect(workspaceParams({ mode: "investigate", place: "kilauea", date: "2026-03-21" })).toEqual({
      mode: "investigate",
      place: "kilauea",
    });
    // An open evidence card is part of the link in Stories.
    const finding = { slug: "okavango-flood-pulse", moment: 1 };
    expect(workspaceParams({ mode: "stories", site: "okavango-flood-pulse", finding })).toEqual({
      mode: "stories",
      site: "okavango-flood-pulse",
      finding: "okavango-flood-pulse:1",
    });
    expect(workspaceParams({ mode: "investigate", site: "okavango-flood-pulse", finding })).not.toHaveProperty("finding");
  });

  it("reads a finding link back, with or without a moment", () => {
    expect(parseFinding("okavango-flood-pulse:1")).toEqual({ slug: "okavango-flood-pulse", moment: 1 });
    expect(parseFinding("jakobshavn")).toEqual({ slug: "jakobshavn", moment: null });
    expect(parseFinding("jakobshavn:latest")).toEqual({ slug: "jakobshavn", moment: null });
    expect(parseFinding("")).toBeNull();
    for (const finding of [{ slug: "a", moment: 0 }, { slug: "a", moment: null }]) {
      expect(parseFinding(findingParam(finding))).toEqual(finding);
    }
  });

  it("opens a link with no tab, or an unknown one, on the default tab", () => {
    expect(modeFrom("investigate")).toBe("investigate");
    expect(modeFrom(null)).toBe(DEFAULT_MODE);
    expect(modeFrom("elsewhere")).toBe(DEFAULT_MODE);
    // Links from before the Findings tab became part of each story.
    expect(modeFrom("findings", DEFAULT_MODE, { hasFinding: true })).toBe("stories");
    expect(modeFrom("findings")).toBe("mine");
  });

  it("makes a new tab, place or finding a step for Back, but not a new date", () => {
    // The first URL the workspace settles on replaces the bare /workspace.
    expect(historyAction("", { mode: "stories" })).toBe("replace");
    expect(historyAction("mode=stories", { mode: "stories", site: "punjab" })).toBe("push");
    expect(historyAction("mode=stories&site=punjab&date=2026-03-09", { mode: "stories", site: "punjab", date: "2026-03-21" }))
      .toBe("replace");
    expect(historyAction("mode=stories&site=punjab", { mode: "investigate", site: "punjab" })).toBe("push");
    expect(historyAction("mode=stories", { mode: "stories", finding: "punjab:1" })).toBe("push");
  });

  it("opens a clicked marker in a tab that can show its place", () => {
    expect(modeForPlace("investigate", true)).toBe("investigate");
    expect(modeForPlace("stories", true)).toBe("stories");
    expect(modeForPlace("stories", false)).toBe("investigate");
    expect(modeForPlace("mine", true)).toBe("stories");
    expect(modeForPlace("mine", false)).toBe("investigate");
  });
});

const CHANGE_TYPES = [
  { id: "agriculture", label: "Crops & farming", color: "#0f0", product: "GUNW", metrics: [] },
  { id: "flood_wetland", label: "Floods & wetlands", color: "#08f", product: "GUNW", metrics: [] },
];
const SITES = [
  {
    id: 1, slug: "punjab-crop-cycles", name: "Punjab", change_type: "agriculture", scene_count: 2,
    bbox: [75, 30, 76, 31], latitude: 30.5, longitude: 75.5, first_date: "2026-03-09", last_date: "2026-03-21",
    description: "Irrigated fields.",
  },
  {
    id: 2, slug: "okavango-flood-pulse", name: "Okavango Delta", change_type: "flood_wetland", scene_count: 2,
    bbox: [22, -20, 23, -19], latitude: -19.5, longitude: 22.5, first_date: "2026-03-09", last_date: "2026-03-21",
    description: "An inland delta.",
  },
];
const DATES = ["2026-03-09", "2026-03-21"];
/** A site as the API returns it once its passes have loaded. */
const loaded = (row) => ({
  ...row,
  product: "GUNW",
  scenes: DATES.map((date) => ({ date, quality: "provisional", image_url: `/${row.slug}/${date}.webp` })),
  observations: [],
});
const SUMMARY = {
  slug: "okavango-flood-pulse", source: "site", theme: "water", theme_label: "Water", name: "Okavango Delta",
  title: "A flood that arrives in the dry season", question: "Where does the water come from?",
};
const STORY = {
  ...SUMMARY,
  place: "An inland delta in the Kalahari.",
  channel: "HH. Calm water reads dark.",
  hero_moment: 0,
  hypothesis_label: "Hypothesis: not tested here",
  site: { name: "Okavango Delta", scene_count: 2, first_date: DATES[0], last_date: DATES[1] },
  saw: { label: "Open water", unit: "%", moments: [] },
  hypotheses: [],
  cant_see: ["Water under papyrus."],
  next: { application: "Tracking a flood pulse.", needs: "Several years of passes." },
};
const KILAUEA = {
  slug: "kilauea", name: "Kīlauea summit", region: "Hawaiʻi, USA", kind: "Volcano", status: "visible",
  headline: "Lava refills the crater", story: "Episodes of fountaining.", look_for: "The crater floor.",
  bbox: [-155.31, 19.38, -155.25, 19.43], lat: 19.4, lon: -155.28, frame: "072_D_079", pixel_m: 20,
  passes: [{ date: "2025-11-03", image_url: "/kilauea/2025-11-03.webp" }], sources: [],
};

describe("<SitePending />", () => {
  const props = { site: SITES[1], changeType: CHANGE_TYPES[1] };

  it("shows what the list knows about a picked site while its passes load", () => {
    const onBack = vi.fn();
    render(<SitePending {...props} onBack={onBack} />);
    const panel = screen.getByRole("article", { name: "Okavango Delta" });
    expect(panel).toHaveAttribute("aria-busy", "true");
    expect(within(panel).getByRole("status")).toHaveTextContent("Loading the NISAR passes…");
    expect(within(panel).getByText("Floods & wetlands")).toBeInTheDocument();
    expect(within(panel).getByText("2 NISAR passes")).toBeInTheDocument();
    expect(within(panel).getByText("An inland delta.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← All places" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("says what went wrong and offers another try", () => {
    const onRetry = vi.fn();
    render(<SitePending {...props} error="The server is busy." onRetry={onRetry} onBack={() => {}} />);
    expect(screen.getByRole("article", { name: "Okavango Delta" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("The server is busy.");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("<WorkspaceApp />", () => {
  function Back() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Browser back</button>;
  }
  function Where() {
    const { pathname, search } = useLocation();
    return <output data-testid="url">{pathname + search}</output>;
  }
  // A fresh query cache per test, so no test sees another's answers.
  const open = (url = "/workspace", comparisonLink = null) =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[url]}>
          <Link to="/workspace">Top bar: Workspace</Link>
          {comparisonLink && <Link to={comparisonLink}>Open radar comparison</Link>}
          <WorkspaceApp />
          <Where />
          <Back />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  // The address follows the selection in an effect, just after the view changes.
  const urlIs = (expected) => waitFor(() => expect(screen.getByTestId("url").textContent).toBe(expected));
  const title = () => screen.getByRole("heading", { level: 1 });
  const map = () => screen.getByTestId("map");
  const panel = () => document.getElementById("workspace-panel");

  it("keeps a new comparison link while the previous study site is still loaded", async () => {
    const linked = "/workspace?mode=stories&site=okavango-flood-pulse&compare=2026-03-09%2C2026-03-21";
    open("/workspace?mode=stories&site=punjab-crop-cycles&date=2026-03-09", linked);
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-09");
    let finish;
    fetchSite.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("link", { name: "Open radar comparison" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await urlIs(linked);
    await act(async () => finish(loaded(SITES[1])));
    await waitFor(() => expect(screen.getByTestId("player")).toHaveAttribute("data-before", "2026-03-09"));
    expect(screen.getByTestId("player")).toHaveTextContent("2026-03-21");
    await urlIs(linked);
  });

  it("restores both gallery dates and the layer requested by a comparison link", async () => {
    fetchLandChange.mockResolvedValueOnce({
      db_range: [-30, 5],
      sites: [{ ...KILAUEA, passes: [
        ...KILAUEA.passes,
        { date: "2026-11-10", image_url: "/kilauea/2026-11-10.webp" },
      ] }],
    });
    const linked = "/workspace?mode=stories&place=kilauea&compare=2025-11-03%2C2026-11-10%2Chh";
    open(linked);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-before", "2025-11-03");
    expect(player).toHaveAttribute("data-after", "2026-11-10");
    expect(player).toHaveAttribute("data-layer", "hh");
    await urlIs(linked);
  });

  const scrollTo = Element.prototype.scrollTo;
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(TOUR_STORAGE_KEY, "done");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    // jsdom has no layout, so there is nothing to scroll.
    Element.prototype.scrollTo = () => {};
    fetchChangeTypes.mockResolvedValue(CHANGE_TYPES);
    fetchProducts.mockResolvedValue([]);
    fetchSites.mockResolvedValue(SITES);
    fetchLandChange.mockResolvedValue({ db_range: [-30, 5], sites: [KILAUEA] });
    fetchStories.mockResolvedValue({ themes: [{ id: "water", label: "Water" }], stories: [SUMMARY] });
    fetchStory.mockResolvedValue(STORY);
    fetchFinding.mockImplementation((slug, moment) => Promise.resolve({
      story: { slug, source: "site", title: "Okavango" },
      site: { slug },
      moment,
      claim: { end: "2026-03-09" },
    }));
    fetchSite.mockImplementation((id) => Promise.resolve(loaded(SITES.find((s) => s.id === id))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.scrollTo = scrollTo;
    window.localStorage.clear();
  });

  it("starts on the Stories list with nothing selected", async () => {
    open();
    expect(await screen.findByRole("button", { name: /Okavango Delta/ })).toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Workspace sidebar" });
    const tabs = within(sidebar).getByRole("tablist", { name: "Workspace mode" });
    expect(within(tabs).getByRole("tab", { name: "Stories" })).toHaveAttribute("aria-selected", "true");
    expect(tabs.querySelector("svg")).toBeNull();
    expect(title()).toHaveTextContent("NISAR map");
    expect(title()).toHaveClass("visually-hidden");
    expect(map()).toHaveAttribute("data-site", "");
    await urlIs("/workspace?mode=stories");
    // Drawing belongs to Investigate.
    expect(screen.queryByRole("button", { name: "Draw line" })).toBeNull();
    const investigate = within(tabs).getByRole("tab", { name: "Investigate" });
    fireEvent.click(investigate);
    expect(title()).toHaveClass("visually-hidden");
    const drawingTools = screen.getByRole("group", { name: "Drawing tools" });
    expect(within(drawingTools).getByRole("button", { name: "Draw line" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(panel()).not.toBeVisible();
    expect(tabs).toBeVisible();
    expect(within(drawingTools).getByRole("button", { name: "Draw area" })).toBeVisible();
    fireEvent.keyDown(investigate, { key: "ArrowRight" });
    expect(within(tabs).getByRole("tab", { name: "My findings" })).toHaveFocus();
    expect(within(sidebar).getByRole("tabpanel", { name: "My findings" })).toBeVisible();
  });

  it("shows a picked site at once, and keeps the latest pick when an earlier one answers late", async () => {
    const answer = {};
    fetchSite.mockImplementation((id) => new Promise((resolve) => (answer[id] = resolve)));
    open("/workspace?mode=investigate");
    fireEvent.click(await screen.findByRole("button", { name: /Punjab/ }));
    // Before any answer: the pick is named, its panel and charts are in place.
    expect(title()).toHaveTextContent("Punjab");
    expect(title()).not.toHaveClass("visually-hidden");
    const pending = screen.getByRole("article", { name: "Punjab" });
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(within(pending).getByRole("status")).toHaveTextContent("Loading the NISAR passes…");
    expect(map()).toHaveAttribute("data-site", "1");
    expect(screen.getByTestId("charts")).toHaveAttribute("data-site", "1");

    fireEvent.click(screen.getByRole("button", { name: "Okavango marker" }));
    expect(title()).toHaveTextContent("Okavango Delta");
    // The first pick's passes arrive late: they must not replace the newer pick.
    await act(async () => answer[1](loaded(SITES[0])));
    expect(title()).toHaveTextContent("Okavango Delta");
    expect(screen.queryByRole("article", { name: "Punjab" })).toBeNull();
    expect(screen.queryByTestId("player")).toBeNull();

    await act(async () => answer[2](loaded(SITES[1])));
    // The query cache passes the answer on in its next tick.
    await waitFor(() => expect(screen.getByRole("article", { name: "Okavango Delta" })).not.toHaveAttribute("aria-busy"));
    expect(screen.getByTestId("player")).toHaveTextContent("2026-03-21");
    await urlIs("/workspace?mode=investigate&site=okavango-flood-pulse&date=2026-03-21");
  });

  it("opens a place found by name as an area to search, centered on a big one", async () => {
    searchPlaces.mockResolvedValue({
      query: "Lake Chad",
      results: [{ name: "Lake Chad", label: "Lake Chad, Chad", kind: "water", latitude: 13.2, longitude: 14.1, bbox: [13, 12.3, 15.2, 14.4] }],
      attribution: { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
    });
    open("/workspace?mode=investigate");
    const field = await screen.findByRole("combobox", { name: "Place name" });
    fireEvent.change(field, { target: { value: "  Lake   Chad " } });
    fireEvent.submit(field);
    expect(await screen.findByRole("option", { name: /Lake Chad, Chad/ })).toHaveAttribute("aria-selected", "true");
    expect(searchPlaces).toHaveBeenCalledWith("Lake Chad");
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeVisible();
    // Enter on the same name opens the highlighted place.
    fireEvent.submit(field);
    await waitFor(() => expect(title()).toHaveTextContent("Lake Chad"));
    expect(screen.queryByRole("listbox", { name: "Places" })).toBeNull();
    expect(screen.getByRole("article", { name: "Selected area" })).toHaveTextContent("box 13.00, 12.30, 15.20, 14.40");
  });

  it("says when no place matches", async () => {
    searchPlaces.mockResolvedValue({ query: "Qwzx", results: [], attribution: null });
    open("/workspace?mode=investigate");
    const field = await screen.findByRole("combobox", { name: "Place name" });
    fireEvent.change(field, { target: { value: "Qwzx" } });
    fireEvent.submit(field);
    expect(await screen.findByText(/No places found/)).toBeVisible();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByText(/No places found/)).toBeNull();
  });

  it("switches between the 2D map and the 3D globe, and remembers the choice", async () => {
    open("/workspace?mode=investigate");
    const views = await screen.findByRole("group", { name: "Map view" });
    expect(within(views).getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(views).getByRole("button", { name: "3D" }));
    expect(await screen.findByTestId("globe")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
    expect(window.localStorage.getItem(MAP_VIEW_KEY)).toBe("3d");
    // The globe's markers open their places, and it flies to them.
    fireEvent.click(screen.getByRole("button", { name: "Okavango on the globe" }));
    await waitFor(() => expect(title()).toHaveTextContent("Okavango Delta"));
    expect(screen.getByTestId("globe")).toHaveAttribute("data-focus", "22,-20,23,-19");
    fireEvent.click(within(views).getByRole("button", { name: "2D" }));
    expect(await screen.findByTestId("map")).toHaveAttribute("data-site", "2");
    expect(window.localStorage.getItem(MAP_VIEW_KEY)).toBe("2d");
  });

  it("draws areas on the globe itself, without leaving 3D", async () => {
    window.localStorage.setItem(MAP_VIEW_KEY, "3d");
    open("/workspace?mode=investigate");
    const globe = await screen.findByTestId("globe");
    const draw = screen.getByRole("button", { name: "Draw area" });
    fireEvent.click(draw);
    expect(globe).toHaveAttribute("data-drawing", "area");
    expect(screen.queryByTestId("map")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Drag a box on the globe" }));
    await waitFor(() => expect(title()).toHaveTextContent("Drawn area"));
    expect(globe).toHaveAttribute("data-drawing", "");
    expect(globe).toHaveAttribute("data-focus", "10,20,11,21");
    expect(draw).toHaveAttribute("aria-pressed", "false");
  });

  it("stays on the 2D map where the browser can't draw the globe", async () => {
    window.localStorage.setItem(MAP_VIEW_KEY, "3d");
    open("/workspace?mode=investigate");
    fireEvent.click(await screen.findByRole("button", { name: "No WebGL" }));
    expect(await screen.findByTestId("map")).toBeInTheDocument();
    const views = screen.getByRole("group", { name: "Map view" });
    expect(within(views).getByRole("button", { name: "3D" })).toBeDisabled();
    expect(within(views).getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when the backend can't be reached", async () => {
    fetchSites.mockRejectedValueOnce({ message: "Network error" });
    open("/workspace?mode=investigate");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the backend: Network error");
  });

  it("keeps a linked site and date in the address when the site list can't be loaded", async () => {
    fetchSites.mockRejectedValueOnce({ message: "Network error" });
    open("/workspace?mode=investigate&site=okavango-flood-pulse&date=2026-03-09");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the backend");
    await urlIs("/workspace?mode=investigate&site=okavango-flood-pulse&date=2026-03-09");
  });

  it("says why a site couldn't load, and loads it on another try", async () => {
    fetchSite.mockRejectedValueOnce({ message: "The server is busy." });
    open("/workspace?mode=investigate");
    fireEvent.click(await screen.findByRole("button", { name: /Punjab/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The server is busy.");
    // The pick stays named, with no charts waiting on data that isn't coming.
    expect(title()).toHaveTextContent("Punjab");
    expect(screen.queryByTestId("charts")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-21");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchSite).toHaveBeenCalledTimes(2);
  });

  it("keeps the selection across tabs and when the panel is hidden", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Okavango Delta/ }));
    // The story's heading is there before the story itself.
    expect(screen.getByRole("heading", { level: 2, name: SUMMARY.title })).toBeInTheDocument();
    const why = { level: 3, name: "Possible explanations" };
    expect(await screen.findByRole("heading", why)).toBeInTheDocument();

    // Investigate: the same site, as data rather than a story.
    fireEvent.click(screen.getByRole("tab", { name: "Investigate" }));
    expect(screen.queryByRole("heading", why)).toBeNull();
    expect(screen.getByRole("button", { name: "← All places" })).toBeInTheDocument();
    expect(screen.getByTestId("player")).toHaveTextContent("2026-03-21");
    // My findings has the viewer's own work; the site stays on the map.
    fireEvent.click(screen.getByRole("tab", { name: "My findings" }));
    expect(within(panel()).getByRole("region", { name: "My findings" })).toBeVisible();
    expect(map()).toHaveAttribute("data-site", "2");
    fireEvent.click(screen.getByRole("tab", { name: "Stories" }));
    expect(await screen.findByRole("heading", why)).toBeInTheDocument();
    expect(fetchSite).toHaveBeenCalledTimes(1);

    // Hiding the panel is not going back: the story is still the selection,
    // and its question moves up beside the map.
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(panel()).not.toBeVisible();
    expect(title()).toHaveTextContent("Okavango Delta");
    expect(within(screen.getByRole("region", { name: "Map controls" })).getByText(SUMMARY.question)).toBeVisible();
    expect(map()).toHaveAttribute("data-site", "2");
    fireEvent.click(screen.getByRole("button", { name: "Show story" }));
    expect(screen.getByRole("heading", why)).toBeVisible();
  });

  it("returns from a story to the list and the whole world with its back link", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Okavango Delta/ }));
    await screen.findByRole("heading", { level: 3, name: "Possible explanations" });
    await urlIs("/workspace?mode=stories&site=okavango-flood-pulse&date=2026-03-21");
    const home = Number(map().dataset.home);

    fireEvent.click(screen.getByRole("button", { name: "← All stories" }));
    expect(title()).toHaveClass("visually-hidden");
    expect(screen.getByRole("button", { name: /Okavango Delta/ })).toBeVisible();
    expect(map()).toHaveAttribute("data-site", "");
    expect(Number(map().dataset.home)).toBe(home + 1);
    expect(screen.queryByTestId("player")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide panel" })).toHaveFocus();
    // The link no longer names the site, and the site isn't reopened from it.
    await urlIs("/workspace?mode=stories");
    expect(fetchSite).toHaveBeenCalledTimes(1);
  });

  it("opens a linked site on the linked date, and a linked gallery place", async () => {
    const { unmount } = open("/workspace?site=okavango-flood-pulse&date=2026-03-09");
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-09");
    expect(title()).toHaveTextContent("Okavango Delta");
    await urlIs("/workspace?mode=stories&site=okavango-flood-pulse&date=2026-03-09");
    unmount();

    open("/workspace?mode=investigate&place=kilauea");
    expect(await screen.findByTestId("player")).toHaveTextContent("kilauea");
    expect(title()).toHaveTextContent("Kīlauea summit");
    expect(map()).toHaveAttribute("data-place", "kilauea");
    fireEvent.click(screen.getByRole("button", { name: "← All places" }));
    expect(screen.getByRole("region", { name: "Before & after" })).toBeVisible();
    await urlIs("/workspace?mode=investigate");
  });

  it("goes back from a story to the list with the browser's Back button", async () => {
    open();
    await urlIs("/workspace?mode=stories");
    fireEvent.click(await screen.findByRole("button", { name: /Okavango Delta/ }));
    await urlIs("/workspace?mode=stories&site=okavango-flood-pulse&date=2026-03-21");
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await urlIs("/workspace?mode=stories");
    await waitFor(() => expect(title()).toHaveClass("visually-hidden"));
    expect(map()).toHaveAttribute("data-site", "");
    expect(screen.queryByTestId("player")).toBeNull();
  });

  it("goes back from one site to the one before with Back, and forward again", async () => {
    function Forward() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate(1)}>Browser forward</button>;
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/workspace?mode=investigate"]}>
          <WorkspaceApp />
          <Where />
          <Back />
          <Forward />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Punjab/ }));
    await urlIs("/workspace?mode=investigate&site=punjab-crop-cycles&date=2026-03-21");
    fireEvent.click(screen.getByRole("button", { name: "Okavango marker" }));
    await urlIs("/workspace?mode=investigate&site=okavango-flood-pulse&date=2026-03-21");
    // Back to an address the workspace wrote itself is still a navigation.
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await waitFor(() => expect(title()).toHaveTextContent("Punjab"));
    expect(map()).toHaveAttribute("data-site", "1");
    await urlIs("/workspace?mode=investigate&site=punjab-crop-cycles&date=2026-03-21");
    fireEvent.click(screen.getByRole("button", { name: "Browser forward" }));
    await waitFor(() => expect(title()).toHaveTextContent("Okavango Delta"));
  });

  it("keeps a linked site and date in the address while its passes load", async () => {
    let answer;
    fetchSite.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    open("/workspace?site=okavango-flood-pulse&date=2026-03-09");
    await waitFor(() => expect(title()).toHaveTextContent("Okavango Delta"));
    await urlIs("/workspace?mode=stories&site=okavango-flood-pulse&date=2026-03-09");
    await act(async () => answer(loaded(SITES[1])));
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-09");
    await urlIs("/workspace?mode=stories&site=okavango-flood-pulse&date=2026-03-09");
  });

  it("opens the list, not an empty place, from a link to a place with nothing visible", async () => {
    fetchLandChange.mockResolvedValue({
      db_range: [-30, 5],
      sites: [KILAUEA, { slug: "mayon", name: "Mayon", status: "not_visible", reason: "No change since June." }],
    });
    open("/workspace?mode=investigate&place=mayon");
    expect(await screen.findByRole("region", { name: "Before & after" })).toBeVisible();
    expect(title()).toHaveClass("visually-hidden");
    expect(map()).toHaveAttribute("data-place", "");
  });

  it("puts an evidence card's place and pass on the map when it opens", async () => {
    open("/workspace?mode=stories&finding=okavango-flood-pulse:1");
    expect(await screen.findByRole("article", { name: "Evidence card" })).toHaveTextContent("okavango-flood-pulse/1");
    await waitFor(() => expect(map()).toHaveAttribute("data-site", "2"));
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-09");
    expect(fetchFinding).toHaveBeenCalledWith("okavango-flood-pulse", 1);
  });

  it("has no Findings tab, and opens old Findings links where their content now lives", async () => {
    const { unmount } = open("/workspace?mode=findings&finding=okavango-flood-pulse:1");
    expect(await screen.findByRole("article", { name: "Evidence card" })).toHaveTextContent("okavango-flood-pulse/1");
    expect(screen.getByRole("tab", { name: "Stories" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Findings" })).toBeNull();
    await urlIs("/workspace?mode=stories&finding=okavango-flood-pulse%3A1");
    unmount();

    open("/workspace?mode=findings");
    expect(await within(panel()).findByRole("region", { name: "My findings" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "My findings" })).toHaveAttribute("aria-selected", "true");
  });

  it("saves what is on the map with the viewer's notes, apart from the app's evidence", async () => {
    open("/workspace?mode=investigate&site=okavango-flood-pulse&date=2026-03-09");
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-09");
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const dialog = screen.getByRole("dialog", { name: "Save to My findings" });
    expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue("Okavango Delta, Mar 9, 2026");
    const evidence = within(dialog).getByRole("region", { name: "From the data" });
    expect(within(evidence).getByText("2026-03-09")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Your notes/ }), {
      target: { value: "Dark patches by the channels: worth checking against a gauge." },
    });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "__new__" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /New story/ }), { target: { value: "Delta watch" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Saved “Okavango Delta, Mar 9, 2026” to My findings.")).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem("nisar.notebook.v1"));
    expect(stored.findings[0]).toMatchObject({
      kind: "view",
      notes: "Dark patches by the channels: worth checking against a gauge.",
      view: { site: "okavango-flood-pulse", date: "2026-03-09", layer: "color" },
      evidence: { date: "2026-03-09", quality: "provisional" },
    });
    expect(stored.stories[0]).toMatchObject({ title: "Delta watch", findingIds: [stored.findings[0].id] });

    // The tab counts what is saved.
    fireEvent.click(screen.getByRole("tab", { name: "My findings 1" }));
    const story = screen.getByRole("region", { name: "Delta watch" });
    const notes = within(story).getAllByRole("region", { name: "Your notes" });
    expect(notes.at(-1)).toHaveTextContent("Dark patches by the channels");
    expect(within(story).getByRole("region", { name: "From the data" })).toHaveTextContent("Okavango Delta");
    expect(within(story).getByRole("button", { name: "Export (Markdown)" })).toBeEnabled();
  });

  it("keeps findings saved by the earlier version of the app", async () => {
    window.localStorage.setItem("nisar.findings.v1", JSON.stringify([
      { slug: "okavango-flood-pulse", moment: 1, title: "A flood that arrives in the dry season", label: "Jul–Oct · −9.3 pts" },
    ]));
    open("/workspace?mode=mine");
    const mine = await within(panel()).findByRole("region", { name: "My findings" });
    expect(within(mine).getByText("A flood that arrives in the dry season")).toBeInTheDocument();
    expect(within(mine).getByText("Story moment")).toBeInTheDocument();
    // The old list is left where it was.
    expect(window.localStorage.getItem("nisar.findings.v1")).toContain("okavango-flood-pulse");
    fireEvent.click(within(mine).getByRole("button", { name: "Evidence card" }));
    expect(await screen.findByRole("article", { name: "Evidence card" })).toHaveTextContent("okavango-flood-pulse/1");
  });

  it("goes to the default workspace when the top bar's Workspace link is clicked from inside it", async () => {
    open("/workspace?mode=investigate&site=punjab-crop-cycles");
    expect(await screen.findByTestId("player")).toHaveTextContent("2026-03-21");
    fireEvent.click(screen.getByRole("link", { name: "Top bar: Workspace" }));
    expect(screen.getByRole("tab", { name: "Stories" })).toHaveAttribute("aria-selected", "true");
    expect(title()).toHaveClass("visually-hidden");
    expect(map()).toHaveAttribute("data-site", "");
    expect(screen.queryByTestId("player")).toBeNull();
    await urlIs("/workspace?mode=stories");
  });
});
