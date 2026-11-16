import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetUrl, fetchSite, fetchSites } from "../services/api.js";
import { workspaceHref } from "./workspaceContext.js";

const HERO_SITE = "sylhet-haor-floods";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)");

export default function HeroObservatory() {
  const figure = useRef(null);
  const [site, setSite] = useState(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState(null);
  const [playing, setPlaying] = useState(() => !reducedMotion().matches);
  const [visible, setVisible] = useState(true);
  const scenes = useMemo(() => (site?.scenes ?? []).filter((scene) => scene.image_url), [site]);
  const water = useMemo(() => Object.fromEntries((site?.observations ?? [])
    .filter((observation) => observation.metric === "water_pct")
    .map((observation) => [observation.observed_on, observation.value])), [site]);
  const scene = scenes[frame?.index];
  const showPlayback = frame !== null && scenes.length > 1;
  const frameReady = frame?.index === index;
  const pct = scene ? water[scene.date] : null;
  const maxPct = Math.max(1, ...Object.values(water));
  // Keep the displayed image and date together while the next pass loads.
  const imagePositions = frameReady ? [index] : [frame?.index, index];
  const unavailable = failed || (site !== null && scenes.length === 0) || frame?.failed;

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
    if (!playing || !visible || !showPlayback || !frameReady) return undefined;
    const timer = setTimeout(() => setIndex((value) => (value + 1) % scenes.length), 1800);
    return () => clearTimeout(timer);
  }, [playing, visible, showPlayback, frameReady, scenes.length]);

  const imageDescription = scene
    ? `NISAR radar image of ${site.name} on ${scene.date}${pct != null ? `, ${pct.toFixed(1)} percent open water` : ""}`
    : "";

  return (
    <figure ref={figure} className="pf-hero-visual">
      <div className="pf-hero-frame">
        {imagePositions.map((position) => {
          const pass = scenes[position];
          const displayed = position === frame?.index;
          if (!pass || (displayed && frame.failed)) return null;
          return (
            <img key={pass.date} src={assetUrl(pass.image_url)}
              alt={displayed ? imageDescription : ""}
              className={displayed ? "is-on" : ""}
              onLoad={displayed ? undefined : () => setFrame({ index: position, failed: false })}
              onError={displayed ? undefined : () => setFrame({ index: position, failed: true })} />
          );
        })}
        {(!scene || unavailable) && (
          <p className="pf-hero-placeholder" role="status">
            {unavailable ? "Radar images unavailable" : "Loading radar imagery…"}
          </p>
        )}
      </div>
      <div className="pf-hero-hud">
        {scene && <time dateTime={scene.date}>{scene.date}</time>}
        {scene && !unavailable && pct != null && <span>{pct.toFixed(1)}% open water</span>}
      </div>
      <div className="pf-hero-footer">
        <div className="pf-hero-strip" role={showPlayback ? "group" : undefined} aria-label={showPlayback ? "Radar passes" : undefined}>
          {showPlayback && <>
            <button type="button" className="pf-hero-play" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause radar time-lapse" : "Play radar time-lapse"}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{playing ? <path d="M7 5v10M13 5v10" /> : <path d="m7 4 8 6-8 6Z" />}</svg>
            </button>
            <div className="pf-hero-bars">
              {scenes.map((pass, position) => (
                <button key={pass.date} type="button" className={position === frame.index ? "is-on" : ""}
                  style={{ "--h": `${Math.max(18, ((water[pass.date] ?? 0) / maxPct) * 100)}%` }}
                  onClick={() => { setIndex(position); setPlaying(false); }} aria-pressed={position === frame.index}
                  aria-label={`${pass.date}${water[pass.date] != null ? `, ${water[pass.date].toFixed(1)}% open water` : ""}`}>
                  <span />
                </button>
              ))}
            </div>
          </>}
        </div>
        <figcaption>
          <Link to={workspaceHref({ site: HERO_SITE })}>{site?.name ?? "Sylhet haor basin, Bangladesh"} <span aria-hidden="true">↗</span></Link>
          <span>{scenes.length > 0 ? `NISAR L-band radar · ${scenes.length} passes` : "NISAR L-band imagery"}</span>
        </figcaption>
      </div>
    </figure>
  );
}
