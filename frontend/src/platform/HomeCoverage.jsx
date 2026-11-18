import { ArrowDown, ArrowUpRight, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { loadImage } from "../services/imageCache.js";
import desktopArt from "./coverage-desktop-art.js";
import { COMPACT_DESCENT_QUERY } from "./earth/home-descent.js";
import crops from "./media/coverage/crops.webp";
import cropsCompact from "./media/coverage/crops-810.webp";
import cropsWireframe from "./media/coverage/crops-wireframe.webp";
import glaciers from "./media/coverage/glaciers.webp";
import glaciersCompact from "./media/coverage/glaciers-810.webp";
import glaciersWireframe from "./media/coverage/glaciers-wireframe.webp";
import groundMotion from "./media/coverage/ground_motion.webp";
import groundMotionCompact from "./media/coverage/ground_motion-810.webp";
import groundMotionWireframe from "./media/coverage/ground_motion-wireframe.webp";
import bangladeshFlag from "./media/coverage/flags/bd.png";
import greenlandFlag from "./media/coverage/flags/gl.png";
import indiaFlag from "./media/coverage/flags/in.png";
import mexicoFlag from "./media/coverage/flags/mx.png";
import nepalFlag from "./media/coverage/flags/np.png";
import hawaiiFlag from "./media/coverage/flags/us-hi.png";
import cropsThumbnail from "./media/coverage/icons/crops-128.webp";
import glaciersThumbnail from "./media/coverage/icons/glaciers-128.webp";
import groundMotionThumbnail from "./media/coverage/icons/ground-motion-128.webp";
import landslidesThumbnail from "./media/coverage/icons/landslides-128.webp";
import volcanoesThumbnail from "./media/coverage/icons/volcanoes-128.webp";
import wetlandsThumbnail from "./media/coverage/icons/wetlands-128.webp";
import landslides from "./media/coverage/landslides.webp";
import landslidesCompact from "./media/coverage/landslides-810.webp";
import landslidesWireframe from "./media/coverage/landslides-wireframe.webp";
import volcanoes from "./media/coverage/volcanoes.webp";
import volcanoesCompact from "./media/coverage/volcanoes-810.webp";
import volcanoesWireframe from "./media/coverage/volcanoes-wireframe.webp";
import wetlands from "./media/coverage/wetlands.webp";
import wetlandsCompact from "./media/coverage/wetlands-810.webp";
import wetlandsWireframe from "./media/coverage/wetlands-wireframe.webp";
import { workspaceHref } from "./workspaceContext.js";
import "./home-coverage.css";

const comparisonDates = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

const TOPICS = [
  {
    id: "ice",
    title: "Glaciers & ice",
    description: "Follow glacier fronts",
    thumbnail: glaciersThumbnail,
    image: glaciers,
    compactImage: glaciersCompact,
    wireframe: glaciersWireframe,
    example: "Jakobshavn Glacier, Greenland",
    flag: greenlandFlag,
    finding: "The fjord brightened in radar",
    signal: "HH backscatter",
    caveat: "Wind-ruffled water can look as bright as rough ice.",
    place: "jakobshavn",
    comparison: { from: "2026-06-18", to: "2026-10-28", layer: "hh" },
    landing: { latitude: 69.17, longitude: -49.85, region: "greenland" },
  },
  {
    id: "crops",
    title: "Crops & farming",
    description: "Follow crop growth",
    thumbnail: cropsThumbnail,
    image: crops,
    compactImage: cropsCompact,
    wireframe: cropsWireframe,
    example: "Punjab rice–wheat belt, India",
    flag: indiaFlag,
    finding: "Crop radar signal fell 3.8 dB",
    signal: "HV backscatter",
    caveat: "The drop coincided with wheat harvest. Rain and soil moisture can also change the signal.",
    site: "punjab-crop-cycles",
    comparison: { from: "2026-03-21", to: "2026-04-26", layer: "hv" },
    landing: { latitude: 30.9, longitude: 75.85, region: "south-asia" },
  },
  {
    id: "floods",
    title: "Floods & wetlands",
    description: "Track open water",
    thumbnail: wetlandsThumbnail,
    image: wetlands,
    compactImage: wetlandsCompact,
    wireframe: wetlandsWireframe,
    example: "Sylhet haor basin, Bangladesh",
    flag: bangladeshFlag,
    finding: "53% → 14% open water",
    signal: "HH backscatter",
    caveat: "Estimated over the same ground on both dates. Wind and vegetation can hide water from this estimate.",
    site: "sylhet-haor-floods",
    comparison: { from: "2026-07-14", to: "2026-11-11", layer: "water" },
    landing: { latitude: 24.9, longitude: 91.3, region: "south-asia" },
  },
  {
    id: "volcano",
    title: "Volcanoes & lava",
    description: "See where lava spreads",
    thumbnail: volcanoesThumbnail,
    image: volcanoes,
    compactImage: volcanoesCompact,
    wireframe: volcanoesWireframe,
    example: "Kīlauea summit, Hawaiʻi",
    flag: hawaiiFlag,
    finding: "Lava spread across the crater floor",
    signal: "HH and HV backscatter",
    caveat: "28 passes over Halemaʻumaʻu. Fresh lava can look brighter or darker depending on its roughness.",
    place: "kilauea",
    comparison: { from: "2025-11-03", to: "2026-11-10", layer: "colour" },
    landing: { latitude: 19.405, longitude: -155.28, region: "hawaii" },
  },
  {
    id: "landslides",
    title: "Landslides",
    description: "Trace change downslope",
    thumbnail: landslidesThumbnail,
    image: landslides,
    compactImage: landslidesCompact,
    wireframe: landslidesWireframe,
    example: "Langtang Lirung, Nepal",
    flag: nepalFlag,
    finding: "A streak appeared down the valley",
    signal: "HH change map",
    caveat: "The streak fits the reported debris flow. Radar brightness alone leaves its outline uncertain.",
    place: "langtang",
    comparison: { from: "2026-08-19", to: "2026-08-31", layer: "change" },
    landing: { latitude: 28.31, longitude: 85.51, region: "south-asia" },
  },
  {
    id: "ground",
    title: "Ground motion",
    description: "Measure surface movement",
    thumbnail: groundMotionThumbnail,
    image: groundMotion,
    compactImage: groundMotionCompact,
    wireframe: groundMotionWireframe,
    example: "Mexico City",
    flag: mexicoFlag,
    finding: "204 mm away from the satellite",
    signal: "Radar phase (InSAR)",
    caveat: "Measured at one point in Nezahualcóyotl relative to a reference. The viewing angle mixes vertical and horizontal motion.",
    site: "mexico-city-subsidence",
    comparison: { from: "2025-10-30", to: "2026-10-13" },
    landing: { latitude: 19.42, longitude: -99.03, region: "mexico" },
  },
];

function terrainArt(topic, frame) {
  const landscape = frame.desktop ? desktopArt[topic.id] : undefined;
  const portrait = { src: topic.image, width: 1086, height: 1448 };
  const sources = landscape?.sources ?? [{ src: topic.compactImage, width: 810, height: 1080 }, portrait];

  // Top-aligned art can need extra width to bring its focal point below the handoff.
  let artWidth = frame.width;
  if (landscape?.focalY && frame.overlap > 0) {
    const focalInset = Math.min(150, frame.overlap * 0.075);
    const focalHeight = (frame.overlap + focalInset) / landscape.focalY;
    if (focalHeight > frame.height) {
      const [{ width, height }] = sources;
      artWidth = Math.max(artWidth, focalHeight * width / height);
    }
  }

  // Cover can be driven by either dimension, including the frame above Explore.
  const width = artWidth * frame.dpr;
  const height = frame.height * frame.dpr;
  const source = width > 0 && height > 0
    ? sources.find((asset) => asset.width >= width && asset.height >= height) ?? sources.at(-1)
    : sources.at(-1);
  return {
    ...source,
    landscape: Boolean(landscape),
    position: landscape?.position,
    displayWidth: artWidth > frame.width ? `${100 * artWidth / frame.width}%` : undefined,
  };
}

function useTerrainFrame(photoFrame) {
  const [size, setSize] = useState(null);

  useEffect(() => {
    const frame = photoFrame.current;
    const desktopQuery = window.matchMedia?.("(min-width: 781px) and (orientation: landscape)");
    let densityQuery;

    function measure() {
      const bounds = frame.getBoundingClientRect();
      const width = Math.ceil(bounds.width);
      const height = Math.ceil(bounds.height);
      const dpr = window.devicePixelRatio || 1;
      const desktop = Boolean(desktopQuery?.matches);
      const overlap = desktop ? parseFloat(getComputedStyle(frame).getPropertyValue("--coverage-overlap")) || 0 : 0;
      setSize((previous) => previous?.width === width && previous.height === height &&
        previous.dpr === dpr && previous.desktop === desktop && previous.overlap === overlap
        ? previous : { width, height, dpr, desktop, overlap });
    }

    function watchDensity() {
      densityQuery?.removeEventListener?.("change", watchDensity);
      densityQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      densityQuery?.addEventListener?.("change", watchDensity);
      measure();
    }

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(frame);
    desktopQuery?.addEventListener?.("change", measure);
    window.addEventListener("resize", measure);
    watchDensity();
    return () => {
      desktopQuery?.removeEventListener?.("change", measure);
      densityQuery?.removeEventListener?.("change", watchDensity);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [photoFrame]);

  return size;
}

function flightDirection(from, to) {
  const latitude = (from.latitude + to.latitude) * Math.PI / 360;
  const longitudeDelta = (to.longitude - from.longitude + 540) % 360 - 180;
  const east = longitudeDelta * Math.cos(latitude);
  const south = from.latitude - to.latitude;
  const distance = Math.hypot(east, south) || 1;
  return {
    "--coverage-flight-east": east / distance,
    "--coverage-flight-south": south / distance,
  };
}

function CoveragePhoto({ topic, art, phase, onAnimationEnd }) {
  const touch = window.matchMedia?.("(any-pointer: coarse)")?.matches;
  const compact = window.matchMedia?.(COMPACT_DESCENT_QUERY)?.matches;
  const loading = phase === "fading" || (touch && !compact) ? "eager" : "lazy";

  return (
    <img className="pf-coverage-photo" data-topic={topic.id} data-phase={phase}
      data-art={art.landscape ? "landscape" : "portrait"} src={art.src}
      width={art.width} height={art.height}
      style={{ objectPosition: art.position, "--coverage-art-width": art.displayWidth }}
      alt="" loading={loading} decoding="async" onAnimationEnd={onAnimationEnd} />
  );
}

function CoverageTopic({ topic, animate, onLandingChange }) {
  const [{ shown, incoming, flightFrame }, setScene] = useState({ shown: topic, incoming: null });
  const detailStack = useRef(null);
  const photoFrame = useRef(null);
  const frame = useTerrainFrame(photoFrame);
  const displayFrame = incoming ? flightFrame : frame;
  const incomingSrc = frame && terrainArt(topic, frame).src;

  useLayoutEffect(() => {
    // Follow the displayed terrain while the next tab's assets load and fade in.
    onLandingChange?.(shown.landing);
  }, [shown, onLandingChange]);

  useEffect(() => {
    // Finish the current fade before revealing the latest selection.
    if (!incomingSrc || topic === shown || incoming) return undefined;
    let cancelled = false;
    Promise.all([loadImage(incomingSrc), loadImage(topic.wireframe)]).then(() => {
      if (cancelled) return;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      setScene(animate && !reduceMotion
        ? { shown, incoming: topic, flightFrame: frame }
        : { shown: topic, incoming: null });
    });
    return () => { cancelled = true; };
  }, [topic, animate, shown, incoming, incomingSrc, frame]);

  useLayoutEffect(() => {
    if (!incoming) return;
    const stack = detailStack.current;
    const [outgoingDetail, incomingDetail] = stack.children;
    const startHeight = outgoingDetail.getBoundingClientRect().height;
    const endHeight = incomingDetail.getBoundingClientRect().height;
    stack.style.setProperty("--coverage-detail-start", `${startHeight}px`);
    stack.style.setProperty("--coverage-detail-end", `${endHeight}px`);
  }, [incoming]);

  return (
    <div className="pf-coverage-topic" id="pf-coverage-topic" role="tabpanel"
      aria-labelledby={`pf-coverage-tab-${topic.id}`} aria-busy={shown !== topic || Boolean(incoming)}
      data-animate={animate} style={incoming ? flightDirection(shown.landing, incoming.landing) : undefined}>
      <figure className="pf-coverage-scene">
        <div className="pf-coverage-photos" ref={photoFrame}>
          {displayFrame && (
            <CoveragePhoto key={shown.id} topic={shown} art={terrainArt(shown, displayFrame)} phase={incoming ? "leaving" : undefined} />
          )}
          {incoming && (
            <CoveragePhoto key={incoming.id} topic={incoming} art={terrainArt(incoming, displayFrame)} phase="fading"
              onAnimationEnd={() => setScene({ shown: incoming, incoming: null })} />
          )}
        </div>
        <figcaption>Terrain illustration</figcaption>
      </figure>
      <div className="pf-coverage-detail" id="pf-coverage-detail" tabIndex={-1}>
        <div className="pf-coverage-detail-stack" ref={detailStack} data-phase={incoming ? "resizing" : undefined}>
          <CoverageDetail key={shown.id} topic={shown} phase={incoming ? "leaving" : undefined} />
          {incoming && <CoverageDetail key={incoming.id} topic={incoming} phase="fading" />}
        </div>
      </div>
    </div>
  );
}

function CoverageDetail({ topic, phase }) {
  const leaving = phase === "leaving";
  const { from, to } = topic.comparison;
  return (
    <div className="pf-coverage-detail-content" data-topic={topic.id} data-phase={phase}
      inert={leaving} aria-hidden={leaving || undefined}>
      <header className="pf-coverage-reading">
        <h3><img className="pf-coverage-flag" src={topic.flag} alt="" width="20" height="16" /><span>{topic.example}</span></h3>
        <p className="pf-coverage-finding">{topic.finding}</p>
        <p className="pf-coverage-context">
          <span>{comparisonDates.formatRange(new Date(from), new Date(to))}</span> <span>{topic.signal}</span>
        </p>
      </header>
      <div className="pf-coverage-preview">
        <img src={topic.wireframe} width="1000" height="434" alt="" loading="lazy" decoding="async" />
      </div>
      <p className="pf-coverage-caveat">{topic.caveat}</p>

      <Link className="pf-coverage-workspace" to={workspaceHref({ mode: "stories", site: topic.site, place: topic.place, comparison: topic.comparison })}>
        Explore the radar passes <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default function HomeCoverage({ onLandingChange }) {
  const [{ index: selected, animate }, setSelection] = useState({ index: 0, animate: false });
  const [focused, setFocused] = useState(null);
  const topic = TOPICS[selected];

  function moveFocus(event, current) {
    const count = TOPICS.length;
    let next;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowLeft":
        next = (current - 1 + count) % count;
        break;
      case "ArrowDown":
      case "ArrowRight":
        next = (current + 1) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.currentTarget.parentElement.children[next].focus();
  }

  return (
    <section className="pf-home-coverage" id="what-nisar-sees" aria-labelledby="pf-coverage-title" data-topic={topic.id}>
      <div className="pf-coverage-sidebar">
        <h2 id="pf-coverage-title">What NISAR sees</h2>
        <p className="pf-coverage-intro">Choose a topic to explore real radar observations in the Workspace.</p>
        <div className="pf-coverage-tabs" role="tablist" aria-label="NISAR topics" aria-orientation="vertical"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
          }}>
          {TOPICS.map(({ id, title, description, thumbnail }, index) => (
            <button type="button" className="pf-coverage-tab" id={`pf-coverage-tab-${id}`} key={id} role="tab"
              aria-selected={selected === index} aria-controls="pf-coverage-topic" tabIndex={(focused ?? selected) === index ? 0 : -1}
              onClick={(event) => setSelection({ index, animate: event.detail > 0 })} onFocus={() => setFocused(index)}
              onKeyDown={(event) => moveFocus(event, index)}>
              <img className="pf-coverage-thumb" src={thumbnail} width="128" height="128" alt=""
                loading="lazy" decoding="async" draggable={false} />
              <span className="pf-coverage-tab-label">
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
              <ChevronRight className="pf-coverage-tab-arrow" size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="pf-coverage-actions">
          <a className="pf-coverage-details-link" href="#pf-coverage-detail" aria-label={`View details for ${topic.title}`}>
            View details <ArrowDown size={15} aria-hidden="true" />
          </a>
          <Link className="pf-coverage-gallery" to="/docs/data/study-sites#land-change-gallery">
            <span className="pf-coverage-gallery-full">Browse the land-change gallery</span>
            <span className="pf-coverage-gallery-short">Land-change gallery</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <CoverageTopic topic={topic} animate={animate} onLandingChange={onLandingChange} />
    </section>
  );
}
