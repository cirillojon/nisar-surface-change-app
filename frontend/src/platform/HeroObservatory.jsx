import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetUrl } from "../services/api.js";
import { siteQuery, sitesQuery } from "../services/queries.js";
import { useStableCallback } from "../services/useStableCallback.js";
import { useRadarMotion } from "./useRadarMotion.js";
import { workspaceHref } from "./workspaceContext.js";

const HERO_SITE = "sylhet-haor-floods";
const OPENING_PASS = "2026-07-14";
const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const RADAR_TILES = [
  { id: "columbia", directory: "columbia-basin-crops", date: "2026-08-18", name: "Columbia Basin", detail: "2.6 dB drop by October" },
  { id: "ice", directory: "landchange/jakobshavn", date: "2026-10-28", place: "jakobshavn", name: "Jakobshavn Glacier" },
  { id: "krakatau", directory: "landchange/anak-krakatau", date: "2026-11-05", place: "anak-krakatau", name: "Anak Krakatau", detail: "Volcanic island" },
  { id: "mexico", directory: "mexico-city-subsidence", date: "2026-10-13", name: "Mexico City", detail: "−204 mm relative LOS (negative = away)" },
  { id: "langtang", directory: "landchange/langtang", date: "2026-11-11", place: "langtang", name: "Langtang Lirung" },
];

function RadarTile({ id, directory, date, place, name, detail }) {
  return (
    <Link className={`pf-hero-tile pf-hero-tile-${id}`}
      to={workspaceHref({ mode: "stories", site: place ? undefined : directory, place, date })}
      aria-label={detail ? undefined : name} title={detail ? undefined : name}>
      <span className="pf-hero-tile-media">
        <img src={assetUrl(`/api/scenes/${directory}/${date}.webp`)}
          loading={id === "mexico" ? "lazy" : undefined} alt="" draggable="false" />
      </span>
        <span className="pf-hero-tile-label">
          <span><strong>{name}</strong>{detail && <small>{detail}</small>}</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </span>
    </Link>
  );
}

/** The Sylhet record (fetched once the hero is on screen): its imaged passes and open water per date. */
function useHeroSite(visible) {
  const sites = useQuery({ ...sitesQuery(), enabled: visible });
  const siteId = sites.data?.find((row) => row.slug === HERO_SITE)?.id;
  const passes = useQuery({ ...siteQuery(siteId ?? null), enabled: visible && siteId != null });
  const site = passes.data ?? null;
  const failed = sites.isError || passes.isError || (sites.isSuccess && siteId == null);
  const scenes = useMemo(() => (site?.scenes ?? []).filter((scene) => scene.image_url), [site]);
  const water = useMemo(() => Object.fromEntries((site?.observations ?? [])
    .filter((observation) => observation.metric === "water_pct")
    .map((observation) => [observation.observed_on, observation.value])), [site]);
  return { site, scenes, water, failed };
}

/**
 * Whether the hero is on screen in a visible tab (`figure`); stops playback
 * (`onReduceMotion`) when the viewer asks for reduced motion.
 */
function useHeroVisibility(figure, onReduceMotion) {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useStableCallback(onReduceMotion);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    observer.observe(figure.current);
    document.addEventListener("visibilitychange", update);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = () => { if (preference.matches) reduceMotion(); };
    preference.addEventListener("change", onPreference);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      preference.removeEventListener("change", onPreference);
    };
  }, [figure, reduceMotion]);
  return visible;
}

/** The pass on show, with the next one loading underneath until it can replace it. */
function HeroFrame({ scenes, frame, positions, description, onFrame }) {
  return (
    <div className="pf-hero-tile-media pf-hero-frame">
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
    </div>
  );
}

/** The pass's date and open water (or why there is none), and the time-lapse button. */
function HeroCaption({ labelId, scene, pct, unavailable, showPlayback, playing, onTogglePlay, count }) {
  const PlaybackIcon = playing ? Pause : Play;
  return (
    <figcaption className="pf-hero-tile-label">
      <span id={labelId}>
        <strong>Sylhet haor basin</strong>
        {scene ? (
          <small role={unavailable ? "status" : undefined}>
            <time dateTime={scene.date}>{shortDate.format(new Date(scene.date))}</time>
            {unavailable ? " · Image unavailable" : pct != null && ` · ${pct.toFixed(1)}% open water`}
          </small>
        ) : (
          <small role="status">{unavailable ? "Radar image unavailable" : "Loading radar imagery…"}</small>
        )}
      </span>
      {showPlayback ? (
        <button type="button" className="pf-hero-play" onClick={onTogglePlay}
          aria-label={playing ? "Pause radar time-lapse" : `Play all ${count} radar passes`}>
          <PlaybackIcon size={15} aria-hidden="true" />
        </button>
      ) : <ArrowUpRight size={14} aria-hidden="true" />}
    </figcaption>
  );
}

export default function HeroObservatory() {
  const field = useRef(null);
  const figure = useRef(null);
  const sceneLabel = useId();
  useRadarMotion(field);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [frame, setFrame] = useState(null);
  const [playing, setPlaying] = useState(false);
  const visible = useHeroVisibility(figure, () => setPlaying(false));
  const { site, scenes, water, failed } = useHeroSite(visible);
  const openingIndex = scenes.findIndex((pass) => pass.date === OPENING_PASS);
  const index = selectedIndex ?? (openingIndex < 0 ? Math.floor(scenes.length / 2) : openingIndex);
  const scene = scenes[frame?.index];
  const showPlayback = frame !== null && scenes.length > 1;
  const frameReady = frame?.index === index;
  const pct = scene ? water[scene.date] : null;
  const unavailable = failed || (site !== null && scenes.length === 0) || frame?.failed;

  useEffect(() => {
    if (!playing || !visible || !showPlayback || !frameReady) return undefined;
    const timer = setTimeout(() => setSelectedIndex((index + 1) % scenes.length), 1800);
    return () => clearTimeout(timer);
  }, [index, playing, visible, showPlayback, frameReady, scenes.length]);

  const imageDescription = scene
    ? `NISAR radar image of ${site.name} on ${scene.date}${pct != null ? `, ${pct.toFixed(1)} percent open water` : ""}`
    : "";

  return (
    <div ref={field} className="pf-hero-field" onDragStart={(event) => event.preventDefault()}>
      {RADAR_TILES.map((tile) => <RadarTile key={tile.id} {...tile} />)}
      <figure ref={figure} className="pf-hero-tile pf-hero-tile-sylhet">
        <HeroFrame scenes={scenes} frame={frame} positions={frameReady ? [index] : [frame?.index, index]}
          description={imageDescription} onFrame={setFrame} />
        <Link className="pf-hero-tile-link" aria-labelledby={sceneLabel}
          to={workspaceHref({ mode: "stories", site: HERO_SITE, date: scene?.date })} />
        <HeroCaption labelId={sceneLabel} scene={scene} pct={pct} unavailable={unavailable}
          showPlayback={showPlayback} playing={playing} onTogglePlay={() => setPlaying((value) => !value)} count={scenes.length} />
      </figure>
    </div>
  );
}
