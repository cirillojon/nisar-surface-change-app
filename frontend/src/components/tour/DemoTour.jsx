import { useCallback, useEffect, useRef, useState } from "react";

import { keyBelongsToFocus } from "../../services/keys.js";
import { pauseAllPlayback } from "../../services/usePlayback.js";
import { DEMO_STEPS } from "./demoSteps.js";
import "./demo.css";

const PLAY_BUTTON = ".map-timeline .scene-controls button";
const AUTOPLAY_POLL_MS = 200;
const KEYS_HELP = "Keys: Space or Enter, next. Backspace, back. Escape, leave demo mode.";

/**
 * Demo mode: the tour for a live pitch. The workspace shows only what the
 * step is about (the parent hides the rest from `onView`); this draws the
 * cards, a small caption over the map and nothing else.
 *
 * Space (or Page Down, a clicker) moves on; on a drawing step not yet done
 * it draws the suggested box or line first. Backspace (Page Up) goes back,
 * Escape leaves (except mid-drawing, where it cancels the drawing). On a
 * step with a pair of dates, ← and → show the first and the second.
 */
export default function DemoTour({ state, actions, onEnd, onView, startAt = 0 }) {
  const [index, setIndex] = useState(startAt);
  const step = DEMO_STEPS[index];
  const last = index === DEMO_STEPS.length - 1;
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  useEffect(() => {
    stateRef.current = state;
    actionsRef.current = actions;
  });

  const go = useCallback(
    (i) => {
      if (i >= DEMO_STEPS.length) onEnd();
      else setIndex(Math.max(0, i));
    },
    [onEnd],
  );
  const isDone = step.done ? step.done(state) : true;

  // Entering a step: what the screen shows, then the app as the step has it.
  useEffect(() => {
    if (!step.keepPlaying) pauseAllPlayback();
    onView({ panel: Boolean(step.panel), chain: Boolean(step.chain) });
    actionsRef.current.closeSave?.();
    if (!step.keepPlaying) actionsRef.current.leaveKilauea?.();
    step.enter?.(actionsRef.current);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // A drawing step moves on by itself once the presenter has drawn.
  const doneOnEntry = useRef(true);
  useEffect(() => {
    doneOnEntry.current = true;
  }, [index]);
  useEffect(() => {
    if (!step.done) return;
    // Done already on entry (a leftover drawing): wait for the step's own action.
    if (doneOnEntry.current) {
      doneOnEntry.current = isDone;
      return;
    }
    if (isDone) go(index + 1);
  }, [isDone, index, step, go]);

  // Start the timelapse as soon as its player is on the page.
  useEffect(() => {
    if (!step.autoplay) return undefined;
    const timer = setInterval(() => {
      const button = document.querySelector(PLAY_BUTTON);
      if (!button) return;
      if (button.getAttribute("aria-pressed") !== "true") button.click();
      clearInterval(timer);
    }, AUTOPLAY_POLL_MS);
    return () => clearInterval(timer);
  }, [step]);

  // The caption sits over the middle of the map, which a side panel narrows.
  const [mapMid, setMapMid] = useState(null);
  useEffect(() => {
    const measure = () => {
      const r = document.querySelector(".map-frame")?.getBoundingClientRect();
      const mid = r && r.width > 0 ? Math.round(r.left + r.width / 2) : null;
      setMapMid((m) => (m === mid ? m : mid));
    };
    measure();
    const timer = setInterval(measure, 250);
    return () => clearInterval(timer);
  }, []);

  const next = useCallback(() => {
    if (step.done && !step.done(stateRef.current) && step.skip) {
      // Not drawn yet: draw the suggested shape; the step then moves on by itself.
      step.skip(actionsRef.current);
      return;
    }
    go(index + 1);
  }, [go, index, step]);
  // Back: the previous step; from the first, back to the workspace.
  const back = useCallback(() => (index === 0 ? onEnd() : go(index - 1)), [go, index, onEnd]);

  // Keys (see services/keys.js): Space / Enter / Page Down move on, Backspace /
  // Page Up go back (from the first step, out of demo mode), Escape leaves,
  // ← / → switch dates on a step with a pair. None is a character key, and
  // none is taken from a text field or a control reached with the keyboard.
  useEffect(() => {
    const take = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const key = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || keyBelongsToFocus(e)) return;
      if (e.key === " " || e.key === "PageDown" || e.key === "Enter") {
        take(e);
        // A button clicked with the mouse earlier (e.g. Play) would also take the Space.
        if (document.activeElement !== document.body && !document.activeElement?.closest?.(".demo-card")) {
          document.activeElement?.blur?.();
        }
        if (!e.repeat) next();
      } else if (e.key === "Backspace" || e.key === "PageUp") {
        take(e);
        if (!e.repeat) back();
      } else if (e.key === "Escape") {
        // Mid-drawing, Escape cancels the drawing (the map handles it).
        if (!stateRef.current.drawing) {
          take(e);
          onEnd();
        }
      } else if (step.pair && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        take(e);
        actionsRef.current.focusLandDate(step.pair.dates[e.key === "ArrowLeft" ? 0 : 1]);
      }
    };
    // Space on a mouse-focused button fires its click on key-up: swallow that too.
    const up = (e) => {
      if (e.key === " " && !keyBelongsToFocus(e)) e.preventDefault();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [next, back, onEnd, step]);

  // A card takes the focus, so a screen reader reads it and Tab reaches its button.
  const cardRef = useRef(null);
  useEffect(() => {
    if (step.card) cardRef.current?.focus({ preventScroll: true });
  }, [step]);

  return (
    <div className="demo-layer" data-testid="demo" data-step={step.id}>
      {step.card ? (
        <div className="demo-backdrop">
          <section
            ref={cardRef}
            className="demo-card"
            role="dialog"
            aria-modal="false"
            aria-labelledby="demo-card-text"
            aria-describedby="demo-keys"
            tabIndex={-1}
          >
            <div id="demo-card-text">
              {step.card.lines.map((line) => (
                <p key={line.text} className={line.small ? "demo-line demo-line-small" : "demo-line"}>
                  {line.label && <span className="demo-label">{line.label}: </span>}
                  {line.text}
                </p>
              ))}
            </div>
            <button type="button" className="btn btn-primary demo-next" onClick={next} aria-keyshortcuts="Space Enter">
              {last ? "Done" : "Next"} <kbd aria-hidden="true">Space</kbd>
            </button>
          </section>
        </div>
      ) : (
        step.label && (
          <p className="demo-caption" style={mapMid == null ? undefined : { "--map-mid": `${mapMid}px` }}>
            {step.label}
          </p>
        )
      )}
      <div className="demo-dots" aria-hidden="true">
        {DEMO_STEPS.map((s, i) => (
          <span key={s.id} data-on={i === index || undefined} />
        ))}
      </div>
      <button
        type="button"
        className="demo-exit"
        onClick={onEnd}
        aria-label="Leave demo mode"
        aria-keyshortcuts="Escape"
        title="Leave demo mode (Esc)"
      >
        ×
      </button>
      <p id="demo-keys" className="visually-hidden">{KEYS_HELP}</p>
      <p className="visually-hidden" role="status" aria-live="polite">
        {`Demo step ${index + 1} of ${DEMO_STEPS.length}. ${
          step.card ? step.card.lines.map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join(" ") : step.label ?? ""
        } ${step.sr ?? ""}${index === 0 ? ` ${KEYS_HELP}` : ""}`.trim()}
      </p>
    </div>
  );
}
