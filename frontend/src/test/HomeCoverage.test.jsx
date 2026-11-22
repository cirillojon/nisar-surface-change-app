import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import HomeCoverage from "../platform/HomeCoverage.jsx";
import { loadImage } from "../services/imageCache.js";

vi.mock("../services/imageCache.js", () => ({ loadImage: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
  cleanup();
  loadImage.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("switches the background after loading and updates the observation and Workspace destination", async () => {
  render(<MemoryRouter><HomeCoverage /></MemoryRouter>);
  const section = within(screen.getByRole("region", { name: "What NISAR sees" }));
  const topics = [
    ["Glaciers & ice", "glaciers", "Jakobshavn Glacier, Greenland", "place=jakobshavn", "2026-06-18,2026-10-28,hh", "gl", "HH backscatter", "The fjord brightened in radar"],
    ["Crops & farming", "crops", "Punjab rice–wheat belt, India", "site=punjab-crop-cycles", "2026-03-21,2026-04-26,hv", "in", "HV backscatter", "Crop radar signal fell 3.8 dB"],
    ["Floods & wetlands", "wetlands", "Sylhet haor basin, Bangladesh", "site=sylhet-haor-floods", "2026-07-14,2026-11-11,water", "bd", "HH backscatter", "53% → 14% open water"],
    ["Volcanoes & lava", "volcanoes", "Kīlauea summit, Hawaiʻi", "place=kilauea", "2025-11-03,2026-11-10,colour", "us-hi", "HH and HV backscatter", "Lava spread across the crater floor"],
    ["Landslides", "landslides", "Langtang Lirung, Nepal", "place=langtang", "2026-08-19,2026-08-31,change", "np", "HH change map", "A streak appeared down the valley"],
    ["Ground motion", "ground_motion", "Mexico City", "site=mexico-city-subsidence", "2025-10-30,2026-10-13", "mx", "Radar phase (InSAR)", "−204 mm relative LOS (negative = away)"],
  ];

  expect(section.getByRole("tab", { name: /Glaciers & ice/ })).toHaveAttribute("aria-selected", "true");
  for (const [title, background, example, selection, comparison, flag, signal, finding] of topics) {
    const tab = section.getByRole("tab", { name: new RegExp(title) });
    fireEvent.click(tab);
    expect(section.getAllByRole("tab", { selected: true })).toEqual([tab]);
    const panel = section.getByRole("tabpanel", { name: new RegExp(title) });
    const location = await within(panel).findByRole("heading", { name: example });
    expect(location).toBeVisible();
    expect(location.querySelector("img")).toHaveAttribute("src", expect.stringContaining(`/flags/${flag}.png`));
    expect(panel.querySelector(".pf-coverage-photo").getAttribute("src")).toMatch(new RegExp(background + "\\.webp$"));
    const detail = panel.querySelector(".pf-coverage-detail");
    expect(detail.querySelector(".pf-coverage-preview img")).toHaveAttribute("src", expect.stringContaining(background + "-wireframe.webp"));
    expect(detail).not.toHaveTextContent("Terrain illustration");
    expect(within(panel).getByText(finding)).toBeVisible();
    expect(panel.querySelector(".pf-coverage-context")).toHaveTextContent(signal);
    expect(panel.querySelector(".pf-coverage-caveat")).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Explore the radar passes" }))
      .toHaveAttribute("href", `/workspace?mode=stories&${selection}&compare=${encodeURIComponent(comparison)}`);
  }
  expect(section.getByRole("link", { name: /Browse the land-change gallery/ }))
    .toHaveAttribute("href", "/docs/data/study-sites#land-change-gallery");
});

it("waits for the wireframe before fading and changes the landing when the scene settles", async () => {
  let finishWireframe;
  const wireframe = new Promise((resolve) => { finishWireframe = resolve; });
  loadImage.mockImplementation((url) => url.endsWith("wetlands-wireframe.webp") ? wireframe : Promise.resolve());
  const onLandingChange = vi.fn();
  render(<MemoryRouter><HomeCoverage onLandingChange={onLandingChange} /></MemoryRouter>);

  fireEvent.click(screen.getByRole("tab", { name: /Floods & wetlands/ }), { detail: 1 });
  const panel = screen.getByRole("tabpanel", { name: /Floods & wetlands/ });
  expect(panel).toHaveAttribute("aria-busy", "true");
  expect(within(panel).getByRole("heading", { name: "Jakobshavn Glacier, Greenland" })).toBeVisible();
  expect(within(panel).getByText("The fjord brightened in radar")).toBeVisible();
  expect(panel.querySelector(".pf-coverage-photo")).toHaveAttribute("data-topic", "ice");
  expect(onLandingChange.mock.calls).toEqual([[{ latitude: 69.17, longitude: -49.85, region: "greenland" }]]);

  await act(async () => { finishWireframe(); });

  const photo = panel.querySelector('.pf-coverage-photo[data-phase="fading"]');
  const detail = panel.querySelector('.pf-coverage-detail-content[data-phase="fading"]');
  expect(panel.querySelector('.pf-coverage-photo[data-phase="leaving"]')).toHaveAttribute("data-topic", "ice");
  expect(photo).toHaveAttribute("data-topic", "floods");
  expect(detail).toHaveAttribute("data-topic", "floods");
  expect(Number(panel.style.getPropertyValue("--coverage-flight-east"))).toBeGreaterThan(0);
  expect(Number(panel.style.getPropertyValue("--coverage-flight-south"))).toBeGreaterThan(0);
  expect(within(detail).getByText("53% → 14% open water")).toBeVisible();
  expect(panel.querySelector('.pf-coverage-detail-content[data-phase="leaving"]')).toHaveAttribute("inert");
  expect(onLandingChange).toHaveBeenCalledTimes(1);

  fireEvent.animationEnd(photo);
  expect(panel).toHaveAttribute("aria-busy", "false");
  expect(panel.style.getPropertyValue("--coverage-flight-east")).toBe("");
  expect(panel.querySelectorAll(".pf-coverage-detail-content")).toHaveLength(1);
  expect(within(panel).getByRole("heading", { name: "Sylhet haor basin, Bangladesh" })).toBeVisible();
  expect(onLandingChange).toHaveBeenLastCalledWith({ latitude: 24.9, longitude: 91.3, region: "south-asia" });
});

it("preloads the same terrain tier that the frame and device pixel ratio select", async () => {
  let height = 500;
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.classList.contains("pf-coverage-photos") ? { width: 390, height } : measure.call(this);
  });
  vi.stubGlobal("devicePixelRatio", 2);
  const { container } = render(<MemoryRouter><HomeCoverage /></MemoryRouter>);
  expect(container.querySelector(".pf-coverage-photo")).toHaveAttribute("src", expect.stringContaining("glaciers-810.webp"));

  fireEvent.click(screen.getByRole("tab", { name: /Crops & farming/ }));
  expect(await screen.findByRole("heading", { name: "Punjab rice–wheat belt, India" })).toBeVisible();
  const compact = container.querySelector(".pf-coverage-photo").getAttribute("src");
  expect(compact).toContain("crops-810.webp");
  expect(loadImage).toHaveBeenCalledWith(compact);

  // The taller frame requires the native asset even at the same viewport width.
  height = 1000;
  fireEvent(window, new Event("resize"));
  expect(container.querySelector(".pf-coverage-photo")).toHaveAttribute("src", expect.stringContaining("crops.webp"));
});

it("preloads the desktop landscape and keeps the selected topic when resizing to mobile", async () => {
  const desktop = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", (query) => query.includes("min-width: 781px") ? desktop : { matches: false });
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.classList.contains("pf-coverage-photos")
      ? { width: 1910, height: 1774 }
      : measure.call(this);
  });
  const { container } = render(<MemoryRouter><HomeCoverage /></MemoryRouter>);
  expect(container.querySelector(".pf-coverage-photo")).toHaveAttribute("src", expect.stringContaining("/desktop/glaciers-1080p.webp"));

  fireEvent.click(screen.getByRole("tab", { name: /Floods & wetlands/ }));
  expect(await screen.findByRole("heading", { name: "Sylhet haor basin, Bangladesh" })).toBeVisible();
  const photo = container.querySelector(".pf-coverage-photo");
  expect(photo).toHaveAttribute("src", expect.stringContaining("/desktop/wetlands-1080p.webp"));
  expect(photo).toHaveAttribute("width", "2300");
  expect(photo).toHaveAttribute("height", "1840");
  expect(loadImage).toHaveBeenCalledWith(photo.getAttribute("src"));

  act(() => {
    desktop.matches = false;
    desktop.dispatchEvent(new Event("change"));
  });
  expect(screen.getByRole("tab", { name: /Floods & wetlands/, selected: true })).toBeVisible();
  expect(container.querySelector(".pf-coverage-photo")).toHaveAttribute("src", expect.stringContaining("/coverage/wetlands.webp"));
});

it("uses the smallest landscape export that covers the full frame at the current density", async () => {
  const desktop = Object.assign(new EventTarget(), { matches: true });
  const density = new EventTarget();
  vi.stubGlobal("matchMedia", (query) => query.includes("min-width: 781px") ? desktop : density);
  vi.stubGlobal("devicePixelRatio", 1);
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.classList.contains("pf-coverage-photos")
      ? { width: 2000, height: 2000 }
      : measure.call(this);
  });
  const { container } = render(<MemoryRouter><HomeCoverage /></MemoryRouter>);
  const photo = container.querySelector(".pf-coverage-photo");
  // The 1080p export covers the width, but the handoff needs more height.
  expect(photo).toHaveAttribute("src", expect.stringContaining("/desktop/glaciers-1440p.webp"));
  expect(photo).toHaveAttribute("width", "2700");
  expect(photo).toHaveAttribute("height", "2160");

  vi.stubGlobal("devicePixelRatio", 2);
  act(() => { density.dispatchEvent(new Event("change")); });
  expect(photo).toHaveAttribute("src", expect.stringContaining("/desktop/glaciers-4500master.webp"));
});

it("moves keyboard focus between topics and opens the focused topic on activation", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><HomeCoverage /></MemoryRouter>);
  const list = within(screen.getByRole("tablist", { name: "NISAR topics" }));
  const ice = list.getByRole("tab", { name: /Glaciers & ice/ });
  const ground = list.getByRole("tab", { name: /Ground motion/ });

  await user.tab();
  expect(ice).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(ground).toHaveFocus();
  expect(ice).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(ground).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("heading", { name: "Mexico City" })).toBeVisible();
  await user.keyboard("{Home}");
  expect(ice).toHaveFocus();
  await user.keyboard(" ");
  expect(ice).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("heading", { name: "Jakobshavn Glacier, Greenland" })).toBeVisible();
});
