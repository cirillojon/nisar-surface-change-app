const clamp = (value) => Math.max(0, Math.min(1, value));

export const COMPACT_DESCENT_QUERY = "(max-width: 780px), (max-width: 959px) and (max-height: 540px)";
const COMPACT_LIFT_START = 0.47;
const COMPACT_LIFT_EASE = 0.06;
const COMPACT_FADE_END = 0.92;
const WIDE_STICKY_RELEASE = 0.535;
const SCROLL_OVERSCAN = 64;
const SCROLL_EASE_MS = 32;
const MAX_SCROLL_LAG = 8;
const VIEWPORT_SETTLE_MS = 120;

function easeBetween(progress, start, end) {
  const t = clamp((progress - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function globeLift(progress, distance) {
  const offset = progress - COMPACT_LIFT_START;
  if (offset <= -COMPACT_LIFT_EASE) return 0;
  if (offset >= COMPACT_LIFT_EASE) return offset * distance;
  const eased = (offset + COMPACT_LIFT_EASE) ** 2 / (4 * COMPACT_LIFT_EASE);
  return eased * distance;
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
  const deeperZoom = !touch.matches;
  const handoffDelay = deeperZoom ? 0.14 : 0;
  const heroCopy = hero.querySelector(".pf-hero-text") ?? hero;
  const radarField = hero.querySelector(".pf-hero-field") ?? hero;

  const styled = new Map();
  let frame = 0;
  let viewportTimer = 0;
  let previousProgress;
  let previousPaintTime = 0;
  let compact;
  let compactLead = 0;
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
    earth.removeAttribute("inert");
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
    const skyLayer = compact ? radarField : hero;
    const copyLayer = compact ? heroCopy : hero;
    setStyle(earth, "--hero-earth-presence", globe.toFixed(3));
    setStyle(skyLayer, "--hero-sky-presence", sky.toFixed(3));
    setStyle(skyLayer, "--hero-tile-visibility", sky > 0 ? "visible" : "hidden");
    setStyle(copyLayer, "--hero-copy-presence", copy.toFixed(3));
    setStyle(copyLayer, "--hero-copy-pointer-events", copy > 0 ? "auto" : "none");
    setStyle(coverage, "--coverage-entry", entry.toFixed(3));
    setStyle(coverage, "--coverage-entry-pointer-events", entry > 0 ? "auto" : "none");
  }

  function paintCompact(progress, now, scrollStep) {
    // The topic heading enters over the live globe. The illustration stays
    // with the observation below, so there is no image swap at this boundary.
    const zoom = 1 + 2.65 * easeBetween(progress, 0.055, 0.93);
    const alignment = easeBetween(progress, 0.075, 0.67);
    const globe = 1 - easeBetween(progress, 0.43, COMPACT_FADE_END);
    const sky = 1 - easeBetween(progress, 0.04, 0.28);
    const copy = 1 - easeBetween(progress, 0.07, 0.31);
    const entry = easeBetween(progress, 0.41, 0.61);
    setPresence({ globe, sky, copy, entry });
    setStyle(hero, "--hero-backdrop-presence", (1 - easeBetween(progress, 0.26, 0.61)).toFixed(3));
    const lift = globeLift(progress, distance);
    setStyle(earth, "--hero-earth-offset", `${(-lift).toFixed(2)}px`);
    const descending = progress > 0.025;
    if (descending !== earth.hasAttribute("data-descent")) {
      earth.toggleAttribute("data-descent", descending);
      earth.toggleAttribute("inert", descending);
    }
    // The poster uses the same focal point if WebGL is unavailable.
    if (earth.querySelector(".pf-hero-earth-poster-view")) setStyle(earth, "--hero-earth-zoom", zoom.toFixed(3));

    // The hero stays pinned through the fade. Clip only the hidden part of
    // the translated canvas, with room for native scrolling between frames.
    const hiddenTop = compactLead + lift;
    const overscan = Math.max(SCROLL_OVERSCAN, scrollStep * 2);
    const clipTop = descending ? Math.floor(Math.max(0, hiddenTop - overscan)) : 0;
    onViewChange(zoom, alignment, globe > 0, now, clipTop);
  }

  function paintWide(progress, revealBlend) {
    // Ease into the first 120 pixels, then rejoin the existing approach before terrain appears.
    const openingEnd = Math.min(120 / distance, 0.24);
    const openingZoom = 0.34 + 0.66 * easeBetween(progress, openingEnd, 0.44);
    const approach = 1 - (1 - clamp(progress * openingZoom / 0.59)) ** 1.65;
    const landing = easeBetween(progress, 0.44, 0.9);
    const extraZoom = deeperZoom ? 2.3 * easeBetween(progress, 0.26, 0.525) : 0;
    const zoom = Number((1 + 3.1 * approach + 0.55 * landing + extraZoom).toFixed(3));
    const alignment = easeBetween(progress, 0.015, 0.44);
    const handoff = (progress - handoffDelay) / (1 - handoffDelay);
    const terrain = easeBetween(handoff, 0.455, 0.64) * revealBlend;
    const reveal = easeBetween(handoff, 0.455, 0.92);
    const globe = 1 - easeBetween(handoff, 0.74, 0.98) * revealBlend;
    const edge = easeBetween(progress, 0.06, 0.38) * (1 - easeBetween(handoff, 0.445, WIDE_STICKY_RELEASE));
    const sky = 1 - easeBetween(progress, 0.02, 0.26);
    const copy = 1 - easeBetween(progress, 0.06, 0.28);
    const entry = easeBetween(handoff, 0.54, 0.80);
    setPresence({ globe, sky, copy, entry });
    setStyle(earth, "--hero-earth-visibility", globe > 0 ? "visible" : "hidden");
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
    const target = Math.min(compact ? COMPACT_FADE_END : 1, clamp((window.scrollY - startY) / distance));
    const scrollStep = Math.abs(target - (previousProgress ?? target)) * distance;
    let progress = target;
    if (compact && target > 0 && target < 0.61 && scrollStep > 0.75 && scrollStep <= 24) {
      // Ease small, uneven scroll steps on the approach. Use the scroll
      // position directly for quick swipes and high-cost close-up frames.
      const remaining = clamp(1 - (now - previousPaintTime) / SCROLL_EASE_MS);
      const lag = Math.min(MAX_SCROLL_LAG, scrollStep * remaining * (1 - easeBetween(target, 0.44, 0.61)));
      progress -= Math.sign(target - previousProgress) * lag / distance;
    }
    if (progress === previousProgress && terrainFadeStart === null) return;
    const revealBlend = compact || !touch.matches ? 1 : !terrainReady ? 0
      : terrainFadeStart === null ? 1 : easeBetween(now - terrainFadeStart, 0, 180);
    if (revealBlend === 1) terrainFadeStart = null;
    previousProgress = progress;
    previousPaintTime = now;

    if (compact) paintCompact(progress, now, scrollStep);
    else paintWide(progress, revealBlend);
    if (terrainFadeStart !== null || progress !== target) schedulePaint();
  }

  function schedulePaint() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(paint);
  }

  function onScroll() {
    if (compact && (
      (previousProgress === 0 && window.scrollY <= startY) ||
      (previousProgress === COMPACT_FADE_END && window.scrollY >= startY + distance * COMPACT_FADE_END)
    )) return;
    schedulePaint();
  }

  function onViewportResize() {
    if (reducedMotion.matches) return;
    if (!compact) { measure(); return; }
    // The address bar moves the visual viewport during a swipe. The hero's
    // ResizeObserver still handles real size changes as soon as they happen.
    clearTimeout(viewportTimer);
    viewportTimer = window.setTimeout(measure, VIEWPORT_SETTLE_MS);
  }

  function measure() {
    clearTimeout(viewportTimer);
    viewportTimer = 0;
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
    const previousStart = startY;
    const previousDistance = distance;
    const previousLead = compactLead;
    const height = hero.clientHeight;
    startY = Math.max(0, track.getBoundingClientRect().top + window.scrollY);
    if (compact) {
      // Tall heroes can scroll until their bottom reaches the small viewport.
      // The heading can then enter over the globe before it scrolls away.
      setStyle(hero, "--hero-frame-height", `${height}px`);
      compactLead = Math.max(0, -(parseFloat(getComputedStyle(hero).top) || 0));
      startY += compactLead;
      const viewport = height - compactLead;
      distance = Math.max(520, Math.min(1040, viewport * 1.06));
      setStyle(track, "--hero-descent-hold", `${distance * COMPACT_FADE_END}px`);
      // Offset the longer hold so the heading still enters at the same scroll position.
      const extraHold = distance * (COMPACT_FADE_END - COMPACT_LIFT_START);
      setStyle(coverage, "--coverage-heading-overlap", `${Math.min(340, viewport * 0.37) + extraHold}px`);
    } else {
      const viewport = Math.min(window.innerHeight, height);
      const landscapeTouch = touch.matches && window.innerWidth > window.innerHeight;
      const desktop = !touch.matches && hero.clientWidth >= 960;
      const scrollDistance = desktop ? Math.min(1050, viewport * 1.08) : Math.min(720, viewport * 0.8);
      distance = Math.max(landscapeTouch ? 560 : 1, scrollDistance);
      // Keep the hero pinned until its bottom edge begins to hand off to the terrain.
      const release = handoffDelay + (1 - handoffDelay) * WIDE_STICKY_RELEASE;
      setStyle(track, "--hero-descent-hold", `${distance * release}px`);
      setStyle(coverage, "--coverage-descent-overlap", `${height - viewport * 0.08}px`);
    }
    if (compact && previousProgress !== undefined && startY === previousStart &&
      distance === previousDistance && compactLead === previousLead) return;
    previousProgress = undefined;
    prepareTerrain();
    schedulePaint();
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  observer?.observe(hero);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onViewportResize);
  coverage.addEventListener("load", prepareTerrain, true);
  compactLayout.addEventListener("change", measure);
  reducedMotion.addEventListener("change", measure);
  measure();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(viewportTimer);
    observer?.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onViewportResize);
    coverage.removeEventListener("load", prepareTerrain, true);
    compactLayout.removeEventListener("change", measure);
    reducedMotion.removeEventListener("change", measure);
    clearStyles();
  };
}
