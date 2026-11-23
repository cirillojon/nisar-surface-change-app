import { useQuery } from "@tanstack/react-query";
import { Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  formatLatLon,
  formatUtc,
  pathBetween,
  positionAt,
  swathEdges,
  trackOf,
  trackSpan,
} from "../services/orbit.js";
import { orbitQuery } from "../services/queries.js";
import { PAUSE_EVENT } from "../services/usePlayback.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// The slider's reach either side of now: SGP4 from one set of elements is
// good for days, not weeks (the backend refuses more than 14 days off).
const REACH = 3 * DAY;
const TICK_MS = 100;
const SPEEDS = [
  { value: 60, label: "1 min/s" },
  { value: 600, label: "10 min/s" },
  { value: 3600, label: "1 h/s" },
];
// The track drawn: one orbit (about 100 minutes) behind and ahead; the swath
// over the last and next few minutes.
const PATH_MS = 100 * MINUTE;
const SWATH_MS = 6 * MINUTE;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Time moving forward at `speed` while `playing`, stopping at `end` (and when anything pauses playback). */
function useClock(setTime, { playing, setPlaying, speed, end }) {
  useEffect(() => {
    const pause = () => setPlaying(false);
    window.addEventListener(PAUSE_EVENT, pause);
    return () => window.removeEventListener(PAUSE_EVENT, pause);
  }, [setPlaying]);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setTime((t) => {
        const next = t + speed * TICK_MS;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, end, setTime, setPlaying]);
}

/**
 * NISAR's computed path: a time slider over the days around now, playback,
 * and where the satellite is. The track, swath and satellite go to the map
 * through `onLayer` ({ past, future, swathNear, swathFar, satellite }).
 */
export default function OrbitPanel({ onLayer, onClose }) {
  // Fixed while the panel is open, so the track is fetched once.
  const [anchor] = useState(() => Math.floor(Date.now() / (10 * MINUTE)) * 10 * MINUTE);
  const query = useQuery(orbitQuery({ start: iso(anchor - REACH), end: iso(anchor + REACH), step: 60 }));
  const track = useMemo(() => (query.data ? trackOf(query.data) : null), [query.data]);
  const [first, last] = track ? trackSpan(track) : [anchor - REACH, anchor + REACH];
  const [time, setTime] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[0].value);
  const [follow, setFollow] = useState(false);
  useClock(setTime, { playing, setPlaying, speed, end: last });

  const at = Math.min(last, Math.max(first, time));
  const layer = useMemo(() => {
    const position = track ? positionAt(track, at) : null;
    if (!position) return null;
    const swath = swathEdges(pathBetween(track, at - SWATH_MS, at + SWATH_MS));
    return {
      past: pathBetween(track, at - PATH_MS, at),
      future: pathBetween(track, at, at + PATH_MS),
      swathNear: swath.near,
      swathFar: swath.far,
      satellite: { ...position, label: `NISAR · ${formatUtc(at)}` },
      follow,
    };
  }, [track, at, follow]);
  const position = layer?.satellite;

  useEffect(() => {
    onLayer?.(layer);
  }, [onLayer, layer]);
  useEffect(() => () => onLayer?.(null), [onLayer]);

  const elements = query.data?.elements;
  return (
    <section id="orbit-panel" className="map-layer-panel" aria-labelledby="orbit-panel-title">
      <header>
        <h2 id="orbit-panel-title">Where NISAR is</h2>
        <button type="button" className="map-layer-close" onClick={onClose} aria-label="Close NISAR's path">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {query.isPending && <p className="map-layer-note">Computing the orbit…</p>}
      {query.isError && <p className="map-layer-note error">Couldn&apos;t compute the orbit: {query.error?.message}</p>}
      {track && (
        <>
          <div className="map-layer-time">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                if (!playing && at >= last) setTime(first);
                setPlaying((p) => !p);
              }}
              aria-pressed={playing}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </button>
            <input
              type="range"
              min={first}
              max={last}
              step={MINUTE}
              value={at}
              aria-label="Time"
              aria-valuetext={formatUtc(at)}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setTime(Date.now())}
              title="Jump to the present moment"
            >
              Now
            </button>
          </div>
          <div className="map-layer-row">
            <strong className="map-layer-when">{formatUtc(at)}</strong>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              aria-pressed={follow}
              onClick={() => setFollow((f) => !f)}
              title="Keep the map centered on NISAR"
            >
              Follow
            </button>
            <label className="layer-select small">
              <span className="visually-hidden">Speed</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {position && (
            <p className="map-layer-readout">
              <span>Over {formatLatLon(position.lat, position.lon)}</span>{" "}
              <strong>
                {Math.round(position.altKm)} km up, heading {position.ascending ? "north (ascending)" : "south (descending)"}
              </strong>
            </p>
          )}
          <ul className="map-layer-key">
            <li><span className="key-line key-past" aria-hidden="true" /> Last orbit</li>
            <li><span className="key-line key-future" aria-hidden="true" /> Next orbit</li>
            <li><span className="key-line key-swath" aria-hidden="true" /> Swath the radar can image</li>
          </ul>
          <details className="map-layer-about">
            <summary>About this path</summary>
            <p>
              One orbit takes {Math.round(query.data.period_min)} minutes, and the Earth turns under it, so each orbit passes
              about 25° farther west. The radar looks left, at a strip 430–700 km from the track (measured from NISAR&apos;s own
              frames), and images mostly land and ice.
            </p>
            <p>
              Predicted with SGP4 from NISAR&apos;s public orbital elements ({elements.source}, epoch{" "}
              {formatUtc(Date.parse(elements.epoch))}
              {elements.stale ? "; couldn't refresh them" : ""}): good to a few km within days of the epoch. It doesn&apos;t say
              when the radar was on.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
