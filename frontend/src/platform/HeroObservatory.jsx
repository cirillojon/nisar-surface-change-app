import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetUrl } from "../services/api.js";
import { siteQuery, sitesQuery } from "../services/queries.js";
import { workspaceHref } from "./workspaceContext.js";

const HERO_SITE = "sylhet-haor-floods";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)");

/** The hero's study site (Sylhet), by slug: null until loaded, `failed` if it can't be. */
function useHeroSite() {
  const sites = useQuery(sitesQuery());
  const row = sites.data?.find((s) => s.slug === HERO_SITE);
  const site = useQuery(siteQuery(row?.id ?? null));
  const missing = Boolean(sites.data) && !row;
  return { site: site.data ?? null, failed: sites.isError || site.isError || missing };
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

const waterText = (pct) => (pct != null ? `${pct.toFixed(1)}% open water` : null);

/** Open water per pass date, from the site's observations. */
function waterByDate(site) {
  return Object.fromEntries((site?.observations ?? [])
    .filter((observation) => observation.metric === "water_pct")
    .map((observation) => [observation.observed_on, observation.value]));
}

function imageDescription(site, scene, pct) {
  if (!scene) return "";
  const water = pct != null ? `, ${pct.toFixed(1)} percent open water` : "";
  return `NISAR radar image of ${site.name} on ${scene.date}${water}`;
}

/**
 * The radar image: the pass shown, with the next one loading behind it until
 * it is ready, so the image and its date change together.
 */
function HeroFrame({ scenes, index, frame, description, unavailable, onFrame }) {
  const frameReady = frame?.index === index;
  const positions = frameReady ? [index] : [frame?.index, index];
  const scene = scenes[frame?.index];
  return (
    <div className="pf-hero-frame">
      {positions.map((position) => {
        const pass = scenes[position];
        const displayed = position === frame?.index;
        if (!pass || (displayed && frame.failed)) return null;
        return (
          <img key={pass.date} src={assetUrl(pass.image_url)}
            alt={displayed ? description : ""}
            className={displayed ? "is-on" : ""}
            onLoad={displayed ? undefined : () => onFrame({ index: position, failed: false })}
            onError={displayed ? undefined : () => onFrame({ index: position, failed: true })} />
        );
      })}
      {(!scene || unavailable) && (
        <p className="pf-hero-placeholder" role="status">
          {unavailable ? "Radar images unavailable" : "Loading radar imagery…"}
        </p>
      )}
    </div>
  );
}

/** Play / pause, and one bar per pass (its height the open water), to pick a pass. */
function HeroStrip({ show, scenes, shown, water, playing, onTogglePlay, onPick }) {
  const maxPct = Math.max(1, ...Object.values(water));
  return (
    <div className="pf-hero-strip" role={show ? "group" : undefined} aria-label={show ? "Radar passes" : undefined}>
      {show && <>
        <button type="button" className="pf-hero-play" onClick={onTogglePlay} aria-label={playing ? "Pause radar time-lapse" : "Play radar time-lapse"}>
          <svg viewBox="0 0 20 20" aria-hidden="true">{playing ? <path d="M7 5v10M13 5v10" /> : <path d="m7 4 8 6-8 6Z" />}</svg>
        </button>
        <div className="pf-hero-bars">
          {scenes.map((pass, position) => (
            <button key={pass.date} type="button" className={position === shown ? "is-on" : ""}
              style={{ "--h": `${Math.max(18, ((water[pass.date] ?? 0) / maxPct) * 100)}%` }}
              onClick={() => onPick(position)} aria-pressed={position === shown}
              aria-label={[pass.date, waterText(water[pass.date])].filter(Boolean).join(", ")}>
              <span />
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

export default function HeroObservatory() {
  const figure = useRef(null);
  const { site, failed } = useHeroSite();
  // The pass asked for (null: the middle one, once the passes arrive), and
  // the one on screen (null until its image has loaded).
  const [picked, setPicked] = useState(null);
  const [frame, setFrame] = useState(null);
  const [playing, setPlaying] = useState(() => !reducedMotion().matches);
  const visible = useHeroVisibility(figure, setPlaying);
  const scenes = useMemo(() => (site?.scenes ?? []).filter((scene) => scene.image_url), [site]);
  const water = useMemo(() => waterByDate(site), [site]);
  const count = scenes.length;
  const index = picked ?? Math.floor(count / 2);
  const scene = scenes[frame?.index];
  const showPlayback = frame !== null && count > 1;
  const frameReady = frame?.index === index;
  const pct = scene ? water[scene.date] : null;
  const unavailable = failed || (site !== null && count === 0) || frame?.failed;

  useEffect(() => {
    if (!playing || !visible || !showPlayback || !frameReady) return undefined;
    const timer = setTimeout(() => setPicked((value) => ((value ?? Math.floor(count / 2)) + 1) % count), 1800);
    return () => clearTimeout(timer);
  }, [playing, visible, showPlayback, frameReady, count]);

  return (
    <figure ref={figure} className="pf-hero-visual">
      <HeroFrame scenes={scenes} index={index} frame={frame} description={imageDescription(site, scene, pct)}
        unavailable={unavailable} onFrame={setFrame} />
      <div className="pf-hero-hud">
        {scene && <time dateTime={scene.date}>{scene.date}</time>}
        {scene && !unavailable && pct != null && <span>{waterText(pct)}</span>}
      </div>
      <div className="pf-hero-footer">
        <HeroStrip
          show={showPlayback}
          scenes={scenes}
          shown={frame?.index}
          water={water}
          playing={playing}
          onTogglePlay={() => setPlaying((value) => !value)}
          onPick={(position) => { setPicked(position); setPlaying(false); }}
        />
        <figcaption>
          <Link to={workspaceHref({ site: HERO_SITE })}>{site?.name ?? "Sylhet haor basin, Bangladesh"} <span aria-hidden="true">↗</span></Link>
          <span>{count > 0 ? `NISAR L-band radar · ${count} passes` : "NISAR L-band imagery"}</span>
        </figcaption>
      </div>
    </figure>
  );
}
