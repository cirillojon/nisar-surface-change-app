import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetUrl } from "../services/api.js";
import { siteQuery, sitesQuery } from "../services/queries.js";
import { Icon } from "./icons.jsx";
import { workspaceHref } from "./workspaceContext.js";

const HERO_SITE = "sylhet-haor-floods";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)");
const ARROW_ROTATION = new Map([
  ["ArrowLeft", [-15, 0]],
  ["ArrowRight", [15, 0]],
  ["ArrowUp", [0, -8]],
  ["ArrowDown", [0, 8]],
]);

/** The hero's study site (Sylhet), by slug: null until loaded, `failed` if it can't be. */
function useHeroSite() {
  const sites = useQuery(sitesQuery());
  const row = sites.data?.find((s) => s.slug === HERO_SITE);
  const site = useQuery(siteQuery(row?.id ?? null));
  const missing = Boolean(sites.data) && !row;
  return { site: site.data ?? null, failed: sites.isError || site.isError || missing };
}

/**
 * The 3D satellite scene (three.js, loaded on demand) drawn into `stage`,
 * showing `currentUrl` and preloading `nextUrl`. Without WebGL (and in
 * DOM-only tests) the illustrated fallback stays.
 */
function useHeroRenderer(stage, dragArea, currentUrl, nextUrl) {
  const renderer = useRef(null);
  const urls = useRef({ currentUrl, nextUrl });
  const [renderState, setRenderState] = useState(() => (hasWebGL() ? "loading" : "fallback"));
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasWebGL()) return undefined;
    import("../services/nisarHeroScene.js").then(({ createNisarHeroScene }) => {
      if (cancelled) return;
      const instance = createNisarHeroScene(stage.current, dragArea.current, {
        onReady: () => { if (!cancelled) setRenderState("ready"); },
        onError: () => { if (!cancelled) setRenderState("fallback"); },
        onImageError: () => { if (!cancelled) setImageFailed(true); },
        onImageReady: () => { if (!cancelled) setImageFailed(false); },
      });
      renderer.current = instance;
      if (urls.current.currentUrl) instance.setImage(urls.current.currentUrl);
      if (urls.current.nextUrl) instance.preloadImage(urls.current.nextUrl);
    }).catch(() => { if (!cancelled) setRenderState("fallback"); });
    return () => { cancelled = true; renderer.current?.dispose(); renderer.current = null; };
  }, [stage, dragArea]);

  useEffect(() => {
    urls.current = { currentUrl, nextUrl };
    if (currentUrl) renderer.current?.setImage(currentUrl);
    if (nextUrl) renderer.current?.preloadImage(nextUrl);
  }, [currentUrl, nextUrl]);

  return { renderer, renderState, imageFailed, setImageFailed };
}

/** Whether the hero is on screen and the tab visible; stops playing if reduced motion is asked for. */
function useHeroVisibility(figure, setPlaying) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    observer.observe(figure.current);
    document.addEventListener("visibilitychange", update);
    const preference = reducedMotion();
    const onPreference = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener("change", onPreference);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      preference.removeEventListener("change", onPreference);
    };
  }, [figure, setPlaying]);
  return visible;
}

const hasWebGL = () => Boolean(window.WebGLRenderingContext || window.WebGL2RenderingContext);
const waterText = (pct) => (pct != null ? `${pct.toFixed(1)}% open water` : null);

/** Open water per pass date, from the site's observations. */
function waterByDate(site) {
  return Object.fromEntries((site?.observations ?? [])
    .filter((observation) => observation.metric === "water_pct")
    .map((observation) => [observation.observed_on, observation.value]));
}

function artLabel(scene, pct) {
  if (!scene) return "NISAR satellite above a radar image plane. Loading radar imagery. Illustration, not to scale.";
  const water = pct != null ? `, ${pct.toFixed(1)} percent open water` : "";
  return `NISAR satellite above a radar image plane. Sylhet, ${scene.date}${water}. Illustration, not to scale.`;
}

/** The date and open water of the pass shown, over the art. */
function HeroHud({ scene, pct, imageFailed, failed }) {
  if (!scene) {
    return <div className="pf-hero-hud" aria-hidden="true"><span>{failed ? "Radar images unavailable" : "Loading radar passes…"}</span></div>;
  }
  const note = imageFailed ? "Radar image unavailable" : waterText(pct);
  return (
    <div className="pf-hero-hud" aria-hidden="true">
      <time dateTime={scene.date}>{scene.date}</time>
      {note && <span>{note}</span>}
    </div>
  );
}

function HeroViewControls({ renderer }) {
  function rotateWithKeys(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rotation = ARROW_ROTATION.get(event.key);
    if (!rotation) return;
    event.preventDefault();
    renderer.current?.rotateView(...rotation);
  }
  return (
    <div className="pf-hero-view-controls">
      <button type="button" aria-label="Reset satellite view" title="Reset view or use the arrow keys to rotate"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        onClick={() => renderer.current?.resetView()} onKeyDown={rotateWithKeys}>
        <Icon name="resetView" size={15} />
      </button>
      <span aria-hidden="true">Drag to rotate</span>
    </div>
  );
}

/** Play / pause, and one bar per pass (its height the open water), to pick a pass. */
function HeroStrip({ scenes, index, water, playing, onTogglePlay, onPick }) {
  const maxPct = Math.max(1, ...Object.values(water));
  return (
    <div className="pf-hero-strip" role="group" aria-label="Radar passes">
      <button type="button" className="pf-hero-play" onClick={onTogglePlay} aria-label={playing ? "Pause radar time-lapse" : "Play radar time-lapse"}>
        <svg viewBox="0 0 20 20" aria-hidden="true">{playing ? <path d="M7 5v10M13 5v10" /> : <path d="m7 4 8 6-8 6Z" />}</svg>
      </button>
      <div className="pf-hero-bars">
        {scenes.map((pass, position) => (
          <button key={pass.date} type="button" className={position === index ? "is-on" : ""}
            style={{ "--h": `${Math.max(18, ((water[pass.date] ?? 0) / maxPct) * 100)}%` }}
            onClick={() => onPick(position)} aria-pressed={position === index}
            aria-label={[pass.date, waterText(water[pass.date])].filter(Boolean).join(", ")}>
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HeroObservatory() {
  const stage = useRef(null);
  const dragArea = useRef(null);
  const figure = useRef(null);
  const { site, failed } = useHeroSite();
  // The pass shown (null: the middle one, once the passes arrive).
  const [picked, setPicked] = useState(null);
  const [playing, setPlaying] = useState(() => !reducedMotion().matches);
  const visible = useHeroVisibility(figure, setPlaying);
  const scenes = useMemo(() => (site?.scenes ?? []).filter((scene) => scene.image_url), [site]);
  const water = useMemo(() => waterByDate(site), [site]);
  const count = scenes.length;
  const index = picked ?? Math.floor(count / 2);
  const scene = scenes[index % Math.max(1, count)];
  const currentUrl = scene ? assetUrl(scene.image_url) : null;
  const nextUrl = count ? assetUrl(scenes[(index + 1) % count].image_url) : null;
  const { renderer, renderState, imageFailed, setImageFailed } = useHeroRenderer(stage, dragArea, currentUrl, nextUrl);
  const canRotate = renderState === "ready";

  useEffect(() => {
    if (!playing || !visible || count < 2) return undefined;
    const timer = setInterval(() => setPicked((value) => ((value ?? Math.floor(count / 2)) + 1) % count), 1800);
    return () => clearInterval(timer);
  }, [playing, visible, count]);

  return (
    <figure ref={figure} className="pf-hero-visual" data-renderer={renderState}>
      <div ref={stage} className="pf-hero-stage">
        <div className="pf-hero-art" role="img" aria-label={artLabel(scene, scene ? water[scene.date] : null)}>
          <div className="pf-hero-fallback" aria-hidden="true">
            <img className="pf-hero-poster" src={`${import.meta.env.BASE_URL}models/nisar/nisar-hero-poster.png`} alt="" />
            <div className="pf-hero-flat">
              {currentUrl && <img key={currentUrl} src={currentUrl} alt="" onLoad={() => setImageFailed(false)} onError={() => setImageFailed(true)} />}
            </div>
          </div>
          <div className="pf-hero-callout pf-hero-callout-dish" aria-hidden="true">
            <span className="pf-hero-pin" /><span><strong>12 m deployable reflector</strong><small>L- &amp; S-band SAR</small></span>
          </div>
          <div className="pf-hero-callout pf-hero-callout-bus" aria-hidden="true">
            <span className="pf-hero-pin" /><span><strong>NISAR</strong><small>NASA–ISRO</small></span>
          </div>
          <HeroHud scene={scene} pct={scene ? water[scene.date] : null} imageFailed={imageFailed} failed={failed} />
        </div>
        <div ref={dragArea} className="pf-hero-drag" hidden={!canRotate} aria-hidden="true" />
        {canRotate && <HeroViewControls renderer={renderer} />}
      </div>
      <div className="pf-hero-footer">
        {count > 1 && (
          <HeroStrip
            scenes={scenes}
            index={index}
            water={water}
            playing={playing}
            onTogglePlay={() => setPlaying((value) => !value)}
            onPick={(position) => { setPicked(position); setPlaying(false); }}
          />
        )}
        <figcaption>
          <Link to={workspaceHref({ site: HERO_SITE })}>{site?.name ?? "Sylhet haor basin, Bangladesh"} <span aria-hidden="true">↗</span></Link>
          <span>{count > 0 ? `${count} real radar passes` : "NISAR L-band imagery"} · Illustration not to scale</span>
        </figcaption>
      </div>
    </figure>
  );
}
