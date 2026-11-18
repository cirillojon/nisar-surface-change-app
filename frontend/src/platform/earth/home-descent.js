const clamp = (value) => Math.max(0, Math.min(1, value));

export const COMPACT_DESCENT_QUERY = "(max-width: 780px), (max-width: 959px) and (max-height: 540px)";

function easeBetween(progress, start, end) {
  const t = clamp((progress - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function bindHomeDescent(hero, onViewChange) {
  const track = hero.parentElement;
  const home = track?.closest(".pf-home");
  const earth = hero.querySelector(".pf-hero-earth");
  const coverage = home?.querySelector(".pf-home-coverage");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!earth || !coverage || !reducedMotion) return () => {};
  const compactLayout = window.matchMedia(COMPACT_DESCENT_QUERY);
  const touch = window.matchMedia("(any-pointer: coarse)");

  const styled = new Map();
  let frame = 0;
  let previousProgress;
  let compact;
  let startY = 0;
  let distance = 1;
  let terrainReady = false;
  let decoding = false;
  let disposed = false;
  let terrainFadeStart = null;

  function setStyle(element, property, value) {
    const cssValue = String(value);
    if (element.style.getPropertyValue(property) === cssValue) return;
    element.style.setProperty(property, cssValue);
    if (!styled.has(element)) styled.set(element, new Set());
    styled.get(element).add(property);
  }

  function clearStyles() {
    for (const [element, properties] of styled) {
      for (const property of properties) element.style.removeProperty(property);
    }
    styled.clear();
    delete home.dataset.compactDescent;
    delete earth.dataset.descent;
    previousProgress = undefined;
    onViewChange(1, 0, true);
  }

  function prepareTerrain() {
    if (compact || !touch.matches || terrainReady || decoding || reducedMotion.matches) return;
    const photo = coverage.querySelector(".pf-coverage-photo");
    if (!photo?.complete || !photo.naturalWidth) return;
    const source = photo.src;
    decoding = true;
    (photo.decode?.() ?? Promise.resolve()).then(() => {
      if (disposed) return;
      decoding = false;
      if (!coverage.contains(photo) || photo.src !== source) {
        prepareTerrain();
        return;
      }
      terrainReady = true;
      if (!compact && previousProgress > 0.455) terrainFadeStart = performance.now();
      previousProgress = undefined;
      schedulePaint();
    }, () => {
      decoding = false;
      if (!disposed && (!coverage.contains(photo) || photo.src !== source)) prepareTerrain();
    });
  }

  function setPresence({ globe, sky, copy, entry }) {
    setStyle(earth, "--hero-earth-presence", globe.toFixed(3));
    setStyle(earth, "--hero-earth-visibility", globe > 0 ? "visible" : "hidden");
    setStyle(hero, "--hero-sky-presence", sky.toFixed(3));
    setStyle(hero, "--hero-tile-visibility", sky > 0 ? "visible" : "hidden");
    setStyle(hero, "--hero-copy-presence", copy.toFixed(3));
    setStyle(hero, "--hero-copy-pointer-events", copy > 0 ? "auto" : "none");
    setStyle(coverage, "--coverage-entry", entry.toFixed(3));
    setStyle(coverage, "--coverage-entry-pointer-events", entry > 0 ? "auto" : "none");
  }

  function paintCompact(progress, now) {
    // The topic heading enters over the live globe. The illustration stays
    // with the observation below, so there is no image swap at this boundary.
    const zoom = 1 + 2.65 * easeBetween(progress, 0.055, 0.93);
    const alignment = easeBetween(progress, 0.075, 0.67);
    const globe = 1 - easeBetween(progress, 0.43, 0.92);
    const sky = 1 - easeBetween(progress, 0.04, 0.28);
    const copy = 1 - easeBetween(progress, 0.07, 0.31);
    const entry = easeBetween(progress, 0.41, 0.61);
    setPresence({ globe, sky, copy, entry });
    setStyle(hero, "--hero-backdrop-presence", (1 - easeBetween(progress, 0.26, 0.61)).toFixed(3));
    const descending = progress > 0.025;
    if (descending !== earth.hasAttribute("data-descent")) earth.toggleAttribute("data-descent", descending);
    // The poster uses the same focal point if WebGL is unavailable.
    if (earth.querySelector(".pf-hero-earth-poster-view")) setStyle(earth, "--hero-earth-zoom", zoom.toFixed(3));
    onViewChange(zoom, alignment, globe > 0, now);
  }

  function paintWide(progress, revealBlend) {
    // Ease into the first 120 pixels, then rejoin the existing approach before terrain appears.
    const openingEnd = Math.min(120 / distance, 0.24);
    const openingZoom = 0.34 + 0.66 * easeBetween(progress, openingEnd, 0.44);
    const approach = 1 - (1 - clamp(progress * openingZoom / 0.59)) ** 1.65;
    const landing = easeBetween(progress, 0.44, 0.9);
    const zoom = Number((1 + 3.1 * approach + 0.55 * landing).toFixed(3));
    const alignment = easeBetween(progress, 0.015, 0.44);
    const terrain = easeBetween(progress, 0.455, 0.64) * revealBlend;
    const reveal = easeBetween(progress, 0.455, 0.92);
    const globe = 1 - easeBetween(progress, 0.74, 0.98) * revealBlend;
    const edge = easeBetween(progress, 0.06, 0.38) * (1 - easeBetween(progress, 0.445, 0.535));
    const sky = 1 - easeBetween(progress, 0.02, 0.26);
    const copy = 1 - easeBetween(progress, 0.06, 0.28);
    const entry = easeBetween(progress, 0.54, 0.80);
    setPresence({ globe, sky, copy, entry });
    setStyle(earth, "--hero-earth-zoom", zoom);
    setStyle(earth, "--hero-earth-edge", edge.toFixed(3));
    setStyle(earth, "--hero-earth-bottom-clip", edge > 0 ? "0px" : "var(--hero-exit-clearance)");
    setStyle(coverage, "--coverage-terrain-opacity", terrain.toFixed(3));
    setStyle(coverage, "--coverage-reveal-position", `${(115 - 145 * reveal).toFixed(2)}svh`);
    onViewChange(zoom, alignment, globe > 0);
  }

  function paint(now) {
    frame = 0;
    if (reducedMotion.matches) return;
    const progress = clamp((window.scrollY - startY) / distance);
    if (progress === previousProgress && terrainFadeStart === null) return;
    const revealBlend = compact || !touch.matches ? 1 : !terrainReady ? 0
      : terrainFadeStart === null ? 1 : easeBetween(now - terrainFadeStart, 0, 180);
    if (revealBlend === 1) terrainFadeStart = null;
    previousProgress = progress;

    if (compact) paintCompact(progress, now);
    else paintWide(progress, revealBlend);
    if (terrainFadeStart !== null) schedulePaint();
  }

  function schedulePaint() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(paint);
  }

  function measure() {
    if (reducedMotion.matches) {
      clearStyles();
      compact = undefined;
      return;
    }
    if (compact !== compactLayout.matches) {
      clearStyles();
      compact = compactLayout.matches;
      home.toggleAttribute("data-compact-descent", compact);
    }
    const height = hero.clientHeight;
    startY = Math.max(0, track.getBoundingClientRect().top + window.scrollY);
    if (compact) {
      // Tall heroes can scroll until their bottom reaches the small viewport.
      // The heading can then enter over the globe before it scrolls away.
      setStyle(hero, "--hero-frame-height", `${height}px`);
      const lead = Math.max(0, -(parseFloat(getComputedStyle(hero).top) || 0));
      startY += lead;
      const viewport = height - lead;
      distance = Math.max(520, Math.min(1040, viewport * 1.06));
      setStyle(track, "--hero-descent-hold", `${distance * 0.47}px`);
      setStyle(coverage, "--coverage-heading-overlap", `${Math.min(340, viewport * 0.37)}px`);
    } else {
      const viewport = Math.min(window.innerHeight, height);
      const landscapeTouch = touch.matches && window.innerWidth > window.innerHeight;
      const desktop = !touch.matches && hero.clientWidth >= 960;
      const scrollDistance = desktop ? Math.min(1050, viewport * 1.08) : Math.min(720, viewport * 0.8);
      distance = Math.max(landscapeTouch ? 560 : 1, scrollDistance);
      setStyle(track, "--hero-descent-hold", `${distance * 0.535}px`);
      setStyle(coverage, "--coverage-descent-overlap", `${height - viewport * 0.08}px`);
    }
    previousProgress = undefined;
    prepareTerrain();
    schedulePaint();
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  observer?.observe(hero);
  window.addEventListener("scroll", schedulePaint, { passive: true });
  window.addEventListener("resize", measure);
  coverage.addEventListener("load", prepareTerrain, true);
  compactLayout.addEventListener("change", measure);
  reducedMotion.addEventListener("change", measure);
  measure();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("scroll", schedulePaint);
    window.removeEventListener("resize", measure);
    coverage.removeEventListener("load", prepareTerrain, true);
    compactLayout.removeEventListener("change", measure);
    reducedMotion.removeEventListener("change", measure);
    clearStyles();
  };
}
