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

it("keeps the terrain moving after the globe fades and restores the globe on return", async () => {
  const { scroll, view, coverage, track } = mountDescent();
  await Promise.resolve();
  scroll(340);
  const openingZoom = view.mock.lastCall[0];
  expect(view.mock.lastCall[2]).toBe(true);
  expect(track.style.getPropertyValue("--hero-descent-hold")).toBe("");

  scroll(520);
  const scale = Number(coverage.style.getPropertyValue("--coverage-descent-scale"));
  expect(view.mock.lastCall[0]).toBeGreaterThan(openingZoom);
  expect(view.mock.lastCall[2]).toBe(false);
  expect(Number(coverage.style.getPropertyValue("--coverage-entry"))).toBe(1);
  scroll(650);
  expect(Number(coverage.style.getPropertyValue("--coverage-descent-scale"))).toBeGreaterThan(scale);

  scroll(0);
  expect(view.mock.lastCall.slice(0, 3)).toEqual([1, 0, true]);
});

it("lets visitors reach the topics when the photo is late and clears the effect for reduced motion", async () => {
  let finishDecode;
  const pendingPhoto = new Promise((resolve) => { finishDecode = resolve; });
  const { scroll, view, coverage, reducedMotion } = mountDescent(() => pendingPhoto);
  scroll(700);
  expect(view.mock.lastCall[2]).toBe(false);
  expect(Number(coverage.style.getPropertyValue("--coverage-entry"))).toBe(1);
  expect(Number(coverage.style.getPropertyValue("--coverage-terrain-opacity"))).toBe(0);

  finishDecode();
  await pendingPhoto;
  vi.advanceTimersByTime(220);
  expect(Number(coverage.style.getPropertyValue("--coverage-terrain-opacity"))).toBe(1);

  reducedMotion.matches = true;
  reducedMotion.dispatchEvent(new Event("change"));
  expect(coverage.style.getPropertyValue("--coverage-terrain-opacity")).toBe("");
  expect(coverage.closest(".pf-home")).not.toHaveAttribute("data-compact-descent");
  expect(view.mock.lastCall).toEqual([1, 0, true]);
});
