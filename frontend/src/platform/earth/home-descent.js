const clamp = (value) => Math.max(0, Math.min(1, value));

function easeBetween(progress, start, end) {
  const t = clamp((progress - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function bindHomeDescent(hero, onViewChange) {
  const track = hero.parentElement;
  const home = track?.closest(".pf-home");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!home || !reducedMotion) return () => {};
  const touch = window.matchMedia("(any-pointer: coarse)");

  const properties = [
    "--hero-earth-zoom",
    "--hero-earth-presence",
    "--hero-earth-edge",
    "--hero-earth-bottom-clip",
    "--hero-sky-presence",
    "--hero-copy-presence",
    "--hero-copy-pointer-events",
    "--hero-tile-visibility",
    "--hero-earth-visibility",
    "--coverage-terrain-opacity",
    "--coverage-reveal-position",
    "--coverage-entry",
    "--coverage-entry-pointer-events",
    "--coverage-descent-overlap",
    "--hero-descent-hold",
  ];
  let frame = 0;
  let previousProgress;
  let mobile = false;
  let startY = 0;
  let distance = 1;
  let terrainReady = false;
  let decoding = false;
  let disposed = false;
  let terrainFadeStart = null;

  function clearStyles() {
    for (const property of properties) home.style.removeProperty(property);
    previousProgress = undefined;
    onViewChange(1, 0);
  }

  function prepareTerrain() {
    if (!touch.matches || terrainReady || decoding || reducedMotion.matches) return;
    const photo = home.querySelector(".pf-coverage-photo");
    if (!photo?.complete || !photo.naturalWidth) return;
    const source = photo.src;
    decoding = true;
    (photo.decode?.() ?? Promise.resolve()).then(() => {
      if (disposed) return;
      decoding = false;
      if (!home.contains(photo) || photo.src !== source) {
        prepareTerrain();
        return;
      }
      terrainReady = true;
      if (previousProgress > 0.455) terrainFadeStart = performance.now();
      previousProgress = undefined;
      schedulePaint();
    }, () => {
      decoding = false;
      if (!disposed && (!home.contains(photo) || photo.src !== source)) prepareTerrain();
    });
  }

  function paint(now) {
    frame = 0;
    if (reducedMotion.matches) return;
    prepareTerrain();
    const progress = clamp((window.scrollY - startY) / distance);
    const revealBlend = !touch.matches ? 1 : !terrainReady ? 0
      : terrainFadeStart === null ? 1 : easeBetween(now - terrainFadeStart, 0, 180);
    if (progress === previousProgress && terrainFadeStart === null) return;
    if (revealBlend === 1) terrainFadeStart = null;
    previousProgress = progress;

    // Ease into the first 120 pixels, then rejoin the existing approach before terrain appears.
    const openingEnd = Math.min(120 / distance, 0.24);
    const openingZoom = 0.34 + 0.66 * easeBetween(progress, openingEnd, 0.44);
    const approach = 1 - (1 - clamp(progress * openingZoom / 0.59)) ** 1.65;
    const landing = easeBetween(progress, 0.44, 0.9);
    const zoom = Number((1 + (mobile ? 2.65 : 3.1) * approach + (mobile ? 0.24 : 0.55) * landing).toFixed(3));
    const alignment = easeBetween(progress, 0.015, 0.44);
    const terrain = easeBetween(progress, 0.455, 0.64) * revealBlend;
    const reveal = easeBetween(progress, 0.455, 0.92);
    const globe = 1 - easeBetween(progress, 0.74, 0.98) * revealBlend;
    const edge = easeBetween(progress, 0.06, 0.38) * (1 - easeBetween(progress, 0.445, 0.535));
    const sky = 1 - easeBetween(progress, 0.02, 0.26);
    const copy = 1 - easeBetween(progress, 0.06, 0.28);
    const entry = easeBetween(progress, 0.54, 0.80);
    const values = [
      zoom,
      globe.toFixed(3),
      edge.toFixed(3),
      edge > 0 ? "0px" : "var(--hero-exit-clearance)",
      sky.toFixed(3),
      copy.toFixed(3),
      copy > 0 ? "auto" : "none",
      sky > 0 ? "visible" : "hidden",
      globe > 0 ? "visible" : "hidden",
      terrain.toFixed(3),
      `${(115 - 145 * reveal).toFixed(2)}svh`,
      entry.toFixed(3),
      entry > 0 ? "auto" : "none",
    ];
    values.forEach((value, index) => home.style.setProperty(properties[index], value));
    onViewChange(zoom, alignment);
    if (terrainFadeStart !== null) schedulePaint();
  }

  function schedulePaint() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(paint);
  }

  function measure() {
    if (reducedMotion.matches) { clearStyles(); return; }
    const viewport = Math.min(window.innerHeight, hero.clientHeight);
    mobile = hero.clientWidth <= 600;
    startY = Math.max(0, track.getBoundingClientRect().top + window.scrollY);
    const landscapeTouch = touch.matches && window.innerWidth > window.innerHeight;
    const desktop = !touch.matches && hero.clientWidth >= 960;
    const scrollDistance = desktop ? Math.min(1050, viewport * 1.08) : Math.min(720, viewport * 0.8);
    distance = Math.max(landscapeTouch ? 560 : 1, scrollDistance);
    home.style.setProperty("--hero-descent-hold", `${distance * 0.535}px`);
    const overlap = hero.clientHeight - viewport * 0.08;
    home.style.setProperty("--coverage-descent-overlap", `${overlap}px`);
    previousProgress = undefined;
    schedulePaint();
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  observer?.observe(hero);
  window.addEventListener("scroll", schedulePaint, { passive: true });
  window.addEventListener("resize", measure);
  home.addEventListener("load", prepareTerrain, true);
  reducedMotion.addEventListener("change", measure);
  measure();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("scroll", schedulePaint);
    window.removeEventListener("resize", measure);
    home.removeEventListener("load", prepareTerrain, true);
    reducedMotion.removeEventListener("change", measure);
    clearStyles();
  };
}
