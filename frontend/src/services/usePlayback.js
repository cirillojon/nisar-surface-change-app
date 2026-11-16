import { useEffect, useRef, useState } from "react";

import { loadImage } from "./imageCache.js";

export const PLAY_MS = 900;
// Frames fetched ahead of the one on screen.
const PREFETCH = 3;
// Sent on `window` to stop every timelapse (e.g. by the guided tour).
export const PAUSE_EVENT = "nisar:pause-playback";

export function pauseAllPlayback() {
  window.dispatchEvent(new Event(PAUSE_EVENT));
}

/**
 * Timelapse playback over `count` frames. Each frame stays up for at least
 * PLAY_MS and the next one is shown as soon as it is ready, so slow frames
 * hold the current one instead of flashing an empty map, without waiting
 * for a fixed tick. The next few frames are prepared ahead.
 *
 * A frame is ready when its image (`urlAt(i)`) has loaded. A frame that is
 * computed rather than downloaded (a change map) passes `ready(i)` instead:
 * a promise that resolves once frame `i` can be drawn. `first` is the frame
 * the loop restarts from (a change map only plays the passes after the one
 * it compares with). Returns [playing, setPlaying].
 */
export function usePlayback({ count, index, urlAt, ready, first = 0, onIndexChange }) {
  const [playing, setPlaying] = useState(false);
  const readyAt = (i) => (ready ? Promise.resolve(ready(i)).catch(() => {}) : loadImage(urlAt?.(i)));
  const latest = useRef({ index, readyAt, first, onIndexChange });
  useEffect(() => {
    latest.current = { index, readyAt, first, onIndexChange };
  });

  useEffect(() => {
    const pause = () => setPlaying(false);
    window.addEventListener(PAUSE_EVENT, pause);
    return () => window.removeEventListener(PAUSE_EVENT, pause);
  }, []);

  useEffect(() => {
    if (!playing || count < 2) return undefined;
    let alive = true;
    let timer;
    let at = Math.min(latest.current.index, count - 1);
    const after = (i) => {
      const start = Math.min(Math.max(0, latest.current.first), count - 1);
      return i >= count - 1 || i < start ? start : i + 1;
    };
    const prefetch = (from) => {
      for (let k = 1, i = after(from); k <= PREFETCH; k++, i = after(i)) {
        latest.current.readyAt(i);
      }
    };
    const step = () => {
      const next = after(at);
      prefetch(at);
      const waited = new Promise((resolve) => {
        timer = setTimeout(resolve, PLAY_MS);
      });
      Promise.all([waited, latest.current.readyAt(next)]).then(() => {
        if (!alive) return;
        at = next;
        latest.current.onIndexChange(next);
        step();
      });
    };
    step();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [playing, count]);

  return [playing, setPlaying];
}
