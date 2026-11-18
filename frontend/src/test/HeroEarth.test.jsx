import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HeroEarth from "../platform/HeroEarth.jsx";
import { createEarthHero } from "../platform/earth/earth-hero";

vi.mock("../platform/earth/earth-hero", () => ({ createEarthHero: vi.fn() }));
let instance;
let onChange;
beforeEach(() => {
  instance = { dispose: vi.fn(), ready: Promise.resolve(), setDescentTarget: vi.fn() };
  createEarthHero.mockImplementation((host, options) => { onChange = options.onChange; return instance; });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("renders the globe without an overlay control", async () => {
  let view;
  await act(async () => { view = render(<HeroEarth />); });
  expect(createEarthHero.mock.calls[0][1].loadReference).toBe(false);
  act(() => onChange({ ready: true, autoRotate: true }));
  expect(view.container.querySelector(".pf-hero-earth-poster")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("retargets the existing globe when the displayed topic changes", async () => {
  const initial = { latitude: 69.17, longitude: -49.85, region: "greenland" };
  const next = { latitude: 30.9, longitude: 75.85, region: "south-asia" };
  let view;
  await act(async () => { view = render(<HeroEarth landing={initial} />); });
  expect(createEarthHero.mock.calls[0][1].descentTarget).toBe(initial);
  view.rerender(<HeroEarth landing={next} />);
  expect(instance.setDescentTarget).toHaveBeenCalledWith(next);
  expect(createEarthHero).toHaveBeenCalledTimes(1);
  expect(instance.dispose).not.toHaveBeenCalled();
});

it("shows a fallback only if the GPU context is lost and removes it after recovery", async () => {
  let view;
  await act(async () => { view = render(<HeroEarth />); });
  act(() => onChange({ ready: false, autoRotate: true, contextLost: true }));
  expect(view.container.querySelector(".pf-hero-earth-poster")).not.toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Earth preview");
  act(() => onChange({ ready: true, autoRotate: true, contextLost: false }));
  expect(view.container.querySelector(".pf-hero-earth-poster")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("preserves the visible fallback when WebGL cannot initialize", async () => {
  createEarthHero.mockImplementation(() => { throw new Error("No WebGL"); });
  let view;
  await act(async () => { view = render(<HeroEarth />); });
  expect(screen.getByRole("status")).toHaveTextContent("Earth preview");
  expect(view.container.querySelector(".pf-hero-earth-poster")).toHaveAttribute("src", "/earth/reference.png");
  expect(screen.queryByRole("button")).toBeNull();
});

it("releases the renderer while texture loading is still pending, without recreating it on completion", async () => {
  let finish;
  instance.ready = new Promise((resolve) => { finish = resolve; });
  let view;
  await act(async () => { view = render(<HeroEarth />); });
  view.unmount();
  expect(instance.dispose).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(createEarthHero).toHaveBeenCalledTimes(1);
  expect(instance.dispose).toHaveBeenCalledTimes(1);
});
