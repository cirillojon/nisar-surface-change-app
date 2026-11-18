import { afterEach, expect, it, vi } from "vitest";
import { bindHomeDescent, COMPACT_DESCENT_QUERY } from "../platform/earth/home-descent.js";

let stop;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountDescent(decode = () => Promise.resolve()) {
  vi.useFakeTimers();
  vi.stubGlobal("scrollY", 0);
  const reducedMotion = Object.assign(new EventTarget(), { matches: false });
  const compact = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", (query) => query === COMPACT_DESCENT_QUERY ? compact : reducedMotion);
  document.body.innerHTML = `
    <div class="pf-home">
      <div class="pf-hero-track">
        <section class="pf-hero"><div class="pf-hero-earth"></div></section>
      </div>
      <section class="pf-home-coverage"><img class="pf-coverage-photo"></section>
    </div>
  `;
  const track = document.querySelector(".pf-hero-track");
  const hero = track.firstElementChild;
  const coverage = document.querySelector(".pf-home-coverage");
  const photo = coverage.querySelector("img");
  track.getBoundingClientRect = () => ({ top: -window.scrollY });
  Object.defineProperty(hero, "clientHeight", { value: 844 });
  Object.defineProperty(photo, "naturalWidth", { value: 1086 });
  photo.decode = decode;
  const view = vi.fn();
  stop = bindHomeDescent(hero, view);

  function scroll(y) {
    window.scrollY = y;
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersToNextFrame();
  }
  return { scroll, view, coverage, track, reducedMotion };
}

it("brings the heading over a moving globe without a full-screen terrain reveal", () => {
  const { scroll, view, coverage, track } = mountDescent();
  scroll(340);
  const earlierZoom = view.mock.lastCall[0];
  expect(view.mock.lastCall[2]).toBe(true);
  expect(parseFloat(coverage.style.getPropertyValue("--coverage-heading-overlap"))).toBeGreaterThan(0);

  const earth = track.querySelector(".pf-hero-earth");
  scroll(515);
  expect(view.mock.lastCall[0]).toBeGreaterThan(earlierZoom);
  expect(Number(coverage.style.getPropertyValue("--coverage-entry"))).toBeGreaterThan(0);
  expect(view.mock.lastCall[2]).toBe(true);
  scroll(650);
  expect(Number(earth.style.getPropertyValue("--hero-earth-presence"))).toBeLessThan(1);
  expect(coverage.style.getPropertyValue("--coverage-terrain-opacity")).toBe("");

  scroll(900);
  expect(view.mock.lastCall[2]).toBe(false);
  expect(Number(coverage.style.getPropertyValue("--coverage-entry"))).toBe(1);

  scroll(0);
  expect(view.mock.lastCall.slice(0, 3)).toEqual([1, 0, true]);
});

it("reveals the topics independently of the photo and clears the effect for reduced motion", () => {
  const decode = vi.fn(() => new Promise(() => {}));
  const { scroll, view, coverage, reducedMotion } = mountDescent(decode);
  scroll(650);
  expect(decode).not.toHaveBeenCalled();
  expect(Number(coverage.style.getPropertyValue("--coverage-entry"))).toBe(1);

  reducedMotion.matches = true;
  reducedMotion.dispatchEvent(new Event("change"));
  expect(coverage.style.getPropertyValue("--coverage-heading-overlap")).toBe("");
  expect(coverage.closest(".pf-home")).not.toHaveAttribute("data-compact-descent");
  expect(view.mock.lastCall).toEqual([1, 0, true]);
});
