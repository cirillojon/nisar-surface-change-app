import { act, cleanup, fireEvent, render, screen } from "./render.jsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import HeroObservatory from "../platform/HeroObservatory.jsx";
import { fetchSite, fetchSites } from "../services/api.js";

vi.mock("../services/api.js", () => ({ assetUrl: (url) => url, fetchSites: vi.fn(), fetchSite: vi.fn() }));
const dates = ["2026-08-19", "2026-08-31", "2026-09-12"];
const site = {
  id: 3, slug: "sylhet-haor-floods", name: "Sylhet haor basin, Bangladesh",
  scenes: dates.map((date) => ({ date, image_url: `/api/scenes/sylhet/${date}.webp` })),
  observations: dates.map((date, index) => ({ observed_on: date, metric: "water_pct", value: [18, 24, 36.3][index] })),
};
let preference;
let intersection;

beforeEach(() => {
  vi.useFakeTimers();
  preference = new EventTarget();
  preference.matches = false;
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback) { intersection = callback; }
    observe() {}
    disconnect() {}
  });
  fetchSites.mockResolvedValue([site]);
  fetchSite.mockResolvedValue(site);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function mount({ loadImage = true, isIntersecting = true } = {}) {
  let result;
  await act(async () => { result = render(<MemoryRouter><HeroObservatory /></MemoryRouter>); });
  await act(async () => intersection([{ isIntersecting }]));
  const image = result.container.querySelector(".pf-hero-frame img");
  if (loadImage && image) fireEvent.load(image);
  return result;
}

describe("NISAR hero imagery", () => {
  it("loads the Sylhet scene only when its tile comes into view", async () => {
    await mount({ isIntersecting: false });
    expect(fetchSites).not.toHaveBeenCalled();
    await act(async () => intersection([{ isIntersecting: true }]));
    expect(fetchSite).toHaveBeenCalledWith(site.id);
  });

  it("waits for the opening map before showing the playback controls", async () => {
    const { container } = await mount({ loadImage: false });
    const image = container.querySelector(".pf-hero-frame img");
    await act(async () => vi.advanceTimersByTime(5400));
    expect(screen.queryByRole("button", { name: "Play all 3 radar passes" })).toBeNull();
    expect(image).toHaveAttribute("src", "/api/scenes/sylhet/2026-08-31.webp");
    fireEvent.load(image);
    expect(screen.getByRole("img", { name: /2026-08-31, 24.0 percent open water/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all 3 radar passes" })).toBeInTheDocument();
  });

  it("keeps the selected real pass, water value, and accessible image description together", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Play all 3 radar passes" }));
    await act(async () => vi.advanceTimersByTime(1800));
    expect(screen.getByRole("img", { name: /2026-08-31, 24.0 percent open water/ })).toBeInTheDocument();
    fireEvent.load(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.getByRole("img", { name: /2026-09-12, 36.3 percent open water/ }))
      .toHaveAttribute("src", "/api/scenes/sylhet/2026-09-12.webp");
    expect(screen.getByRole("link", { name: /Sylhet haor basin.*Sep 12/ }))
      .toHaveAttribute("href", expect.stringContaining("date=2026-09-12"));
  });

  it("opens on July and keeps six radar cards linked to their real passes", async () => {
    const july = "2026-07-14";
    const november = "2026-11-11";
    fetchSite.mockResolvedValue({
      ...site,
      scenes: [july, ...dates, november].map((date) => ({ date, image_url: `/api/scenes/sylhet/${date}.webp` })),
      observations: [
        ...site.observations,
        { observed_on: july, metric: "water_pct", value: 53.3 },
        { observed_on: november, metric: "water_pct", value: 13.7 },
      ],
    });
    const { container } = await mount();
    expect(screen.getByRole("img", { name: /2026-07-14, 53.3 percent open water/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all 5 radar passes" })).toBeInTheDocument();
    expect(container.querySelectorAll(".pf-hero-tile")).toHaveLength(6);
    expect(screen.getByRole("link", { name: /Sylhet haor basin.*Jul 14/ }))
      .toHaveAttribute("href", expect.stringContaining("date=2026-07-14"));
    expect(screen.getByRole("link", { name: "Langtang Lirung" }))
      .toHaveAttribute("href", "/workspace?mode=stories&place=langtang&date=2026-11-11");
    // Every small card has an image on phones, without a desktop-only source.
    for (const image of container.querySelectorAll("a.pf-hero-tile img")) {
      expect(image).toHaveAttribute("src", expect.stringContaining("/api/scenes/"));
    }
  });

  it("clears the old map and labels a pass whose image fails", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Play all 3 radar passes" }));
    await act(async () => vi.advanceTimersByTime(1800));
    fireEvent.error(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Image unavailable");
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-09-12");
    expect(screen.queryByText(/24.0% open water/)).toBeNull();
  });

  it("starts paused for reduced motion and plays only after an explicit request", async () => {
    preference.matches = true;
    const { container } = await mount();
    await act(async () => vi.advanceTimersByTime(4000));
    expect(screen.getByRole("img", { name: /2026-08-31, 24.0 percent open water/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play all 3 radar passes" }));
    await act(async () => vi.advanceTimersByTime(1800));
    fireEvent.load(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.getByRole("img", { name: /2026-09-12, 36.3 percent open water/ })).toBeInTheDocument();
  });

  it("suspends playback offscreen and releases its timer on unmount", async () => {
    const { container, unmount } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Play all 3 radar passes" }));
    act(() => intersection([{ isIntersecting: false }]));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("img", { name: /2026-08-31, 24.0 percent open water/ })).toBeInTheDocument();
    act(() => intersection([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTime(1800));
    fireEvent.load(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.getByRole("img", { name: /2026-09-12, 36.3 percent open water/ })).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the workspace link usable when the data request fails", async () => {
    fetchSites.mockRejectedValue(new Error("Offline"));
    const { container } = await mount();
    expect(screen.getByText("Radar image unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sylhet haor basin/ })).toHaveAttribute("href", expect.stringContaining("sylhet-haor-floods"));
    expect(container.querySelector(".pf-hero-frame img")).toBeNull();
    expect(screen.queryByRole("button", { name: /radar passes/ })).toBeNull();
  });
});
