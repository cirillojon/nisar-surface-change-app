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

async function mount({ loadImage = true } = {}) {
  let result;
  await act(async () => { result = render(<MemoryRouter><HeroObservatory /></MemoryRouter>); });
  const image = result.container.querySelector(".pf-hero-frame img");
  if (loadImage && image) fireEvent.load(image);
  return result;
}

describe("NISAR hero imagery", () => {
  it("waits for the opening map before showing the playback controls", async () => {
    const { container } = await mount({ loadImage: false });
    const image = container.querySelector(".pf-hero-frame img");
    await act(async () => vi.advanceTimersByTime(5400));
    expect(screen.queryByRole("group", { name: "Radar passes" })).toBeNull();
    expect(image).toHaveAttribute("src", "/api/scenes/sylhet/2026-08-31.webp");
    fireEvent.load(image);
    expect(screen.getByRole("button", { name: "2026-08-31, 24.0% open water" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the selected real pass, water value, and accessible image description together", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "2026-09-12, 36.3% open water" }));
    expect(screen.getByRole("button", { name: "Play radar time-lapse" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /2026-08-31, 24.0 percent open water/ })).toBeInTheDocument();
    fireEvent.load(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.getByRole("img", { name: /2026-09-12, 36.3 percent open water/ }))
      .toHaveAttribute("src", "/api/scenes/sylhet/2026-09-12.webp");
    expect(screen.getByRole("button", { name: "2026-09-12, 36.3% open water" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clears the old map and labels a pass whose image fails", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "2026-09-12, 36.3% open water" }));
    fireEvent.error(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Radar images unavailable");
    expect(container.querySelector("time")).toHaveTextContent("2026-09-12");
    expect(screen.queryByText("24.0% open water")).toBeNull();
  });

  it("starts paused for reduced motion and plays only after an explicit request", async () => {
    preference.matches = true;
    const { container } = await mount();
    await act(async () => vi.advanceTimersByTime(4000));
    expect(screen.getByRole("button", { name: "2026-08-31, 24.0% open water" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Play radar time-lapse" }));
    await act(async () => vi.advanceTimersByTime(1800));
    fireEvent.load(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.getByRole("button", { name: "2026-09-12, 36.3% open water" })).toHaveAttribute("aria-pressed", "true");
  });

  it("suspends playback offscreen and releases its timer on unmount", async () => {
    const { container, unmount } = await mount();
    act(() => intersection([{ isIntersecting: false }]));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("button", { name: "2026-08-31, 24.0% open water" })).toHaveAttribute("aria-pressed", "true");
    act(() => intersection([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTime(1800));
    fireEvent.load(container.querySelector('.pf-hero-frame img[src$="2026-09-12.webp"]'));
    expect(screen.getByRole("button", { name: "2026-09-12, 36.3% open water" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the workspace link usable when the data request fails", async () => {
    fetchSites.mockRejectedValue(new Error("Offline"));
    const { container } = await mount();
    expect(screen.getByText("Radar images unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sylhet haor basin/ })).toHaveAttribute("href", expect.stringContaining("sylhet-haor-floods"));
    expect(container.querySelector(".pf-hero-frame img")).toBeNull();
    expect(screen.queryByRole("button", { name: /radar time-lapse/ })).toBeNull();
  });
});
