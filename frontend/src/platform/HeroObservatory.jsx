import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetUrl, fetchSite, fetchSites } from "../services/api.js";
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

export default function HeroObservatory() {
  const stage = useRef(null);
  const dragArea = useRef(null);
  const figure = useRef(null);
  const renderer = useRef(null);
  const imageUrl = useRef(null);
  const upcomingImageUrl = useRef(null);
  const [site, setSite] = useState(null);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion().matches);
  const [visible, setVisible] = useState(true);
  const [renderState, setRenderState] = useState(() => window.WebGLRenderingContext || window.WebGL2RenderingContext ? "loading" : "fallback");
  const canRotate = renderState === "ready";
  const scenes = useMemo(() => (site?.scenes ?? []).filter((scene) => scene.image_url), [site]);
  const water = useMemo(() => Object.fromEntries((site?.observations ?? [])
    .filter((observation) => observation.metric === "water_pct")
    .map((observation) => [observation.observed_on, observation.value])), [site]);
  const scene = scenes[index % Math.max(1, scenes.length)];
  const pct = scene ? water[scene.date] : null;
  const maxPct = Math.max(1, ...Object.values(water));
  const currentUrl = scene ? assetUrl(scene.image_url) : null;
  const nextUrl = scenes.length ? assetUrl(scenes[(index + 1) % scenes.length].image_url) : null;

  useEffect(() => {
    let cancelled = false;
    fetchSites()
      .then((rows) => rows.find((row) => row.slug === HERO_SITE))
      .then((row) => row ? fetchSite(row.id) : Promise.reject(new Error("Site unavailable")))
      .then((result) => {
        if (!cancelled) {
          setSite(result);
          setIndex(Math.floor((result.scenes ?? []).filter((pass) => pass.image_url).length / 2));
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

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
  }, []);

  useEffect(() => {
    if (!playing || !visible || scenes.length < 2) return undefined;
    const timer = setInterval(() => setIndex((value) => (value + 1) % scenes.length), 1800);
    return () => clearInterval(timer);
  }, [playing, visible, scenes.length]);

  useEffect(() => {
    let cancelled = false;
    // DOM-only tests and browsers without WebGL keep the illustrated fallback.
    if (!window.WebGLRenderingContext && !window.WebGL2RenderingContext) return undefined;
    import("../services/nisarHeroScene.js").then(({ createNisarHeroScene }) => {
      if (cancelled) return;
      const instance = createNisarHeroScene(stage.current, dragArea.current, {
        onReady: () => { if (!cancelled) setRenderState("ready"); },
        onError: () => { if (!cancelled) setRenderState("fallback"); },
        onImageError: () => { if (!cancelled) setImageFailed(true); },
        onImageReady: () => { if (!cancelled) setImageFailed(false); },
      });
      renderer.current = instance;
      if (imageUrl.current) instance.setImage(imageUrl.current);
      if (upcomingImageUrl.current) instance.preloadImage(upcomingImageUrl.current);
    }).catch(() => { if (!cancelled) setRenderState("fallback"); });
    return () => { cancelled = true; renderer.current?.dispose(); renderer.current = null; };
  }, []);

  useEffect(() => {
    imageUrl.current = currentUrl;
    upcomingImageUrl.current = nextUrl;
    if (currentUrl) renderer.current?.setImage(currentUrl);
    if (nextUrl) renderer.current?.preloadImage(nextUrl);
  }, [currentUrl, nextUrl]);

  function rotateWithKeys(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rotation = ARROW_ROTATION.get(event.key);
    if (!rotation) return;
    event.preventDefault();
    renderer.current?.rotateView(...rotation);
  }

  return (
    <figure ref={figure} className="pf-hero-visual" data-renderer={renderState}>
      <div ref={stage} className="pf-hero-stage">
        <div className="pf-hero-art" role="img" aria-label={`NISAR satellite above a radar image plane. ${scene ? `Sylhet, ${scene.date}${pct != null ? `, ${pct.toFixed(1)} percent open water` : ""}.` : "Loading radar imagery."} Illustration, not to scale.`}>
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
          <div className="pf-hero-hud" aria-hidden="true">
            {scene ? <><time dateTime={scene.date}>{scene.date}</time>{imageFailed ? <span>Radar image unavailable</span> : pct != null && <span>{pct.toFixed(1)}% open water</span>}</> :
              <span>{failed ? "Radar images unavailable" : "Loading radar passes…"}</span>}
          </div>
        </div>
        <div ref={dragArea} className="pf-hero-drag" hidden={!canRotate} aria-hidden="true" />
        {canRotate && (
          <div className="pf-hero-view-controls">
            <button type="button" aria-label="Reset satellite view" title="Reset view or use the arrow keys to rotate"
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              onClick={() => renderer.current?.resetView()} onKeyDown={rotateWithKeys}>
              <Icon name="resetView" size={15} />
            </button>
            <span aria-hidden="true">Drag to rotate</span>
          </div>
        )}
      </div>
      <div className="pf-hero-footer">
        {scenes.length > 1 && (
          <div className="pf-hero-strip" role="group" aria-label="Radar passes">
            <button type="button" className="pf-hero-play" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause radar time-lapse" : "Play radar time-lapse"}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{playing ? <path d="M7 5v10M13 5v10" /> : <path d="m7 4 8 6-8 6Z" />}</svg>
            </button>
            <div className="pf-hero-bars">
              {scenes.map((pass, position) => (
                <button key={pass.date} type="button" className={position === index ? "is-on" : ""}
                  style={{ "--h": `${Math.max(18, ((water[pass.date] ?? 0) / maxPct) * 100)}%` }}
                  onClick={() => { setIndex(position); setPlaying(false); }} aria-pressed={position === index}
                  aria-label={`${pass.date}${water[pass.date] != null ? `, ${water[pass.date].toFixed(1)}% open water` : ""}`}>
                  <span />
                </button>
              ))}
            </div>
          </div>
        )}
        <figcaption>
          <Link to={workspaceHref({ site: HERO_SITE })}>{site?.name ?? "Sylhet haor basin, Bangladesh"} <span aria-hidden="true">↗</span></Link>
          <span>{scenes.length > 0 ? `${scenes.length} real radar passes` : "NISAR L-band imagery"} · Illustration not to scale</span>
        </figcaption>
      </div>
    </figure>
  );
}
