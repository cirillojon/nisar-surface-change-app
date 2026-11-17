import { useCallback, useEffect, useRef, useState } from "react";

import { keyBelongsToFocus } from "../../services/keys.js";
import { pauseAllPlayback } from "../../services/usePlayback.js";
import { DEMO_STEPS } from "./demoSteps.js";
import "./demo.css";

const PLAY_BUTTON = ".map-timeline .scene-controls button";
const AUTOPLAY_POLL_MS = 200;
const KEYS_HELP = "Keys: Space or Enter, next. Backspace, back. Escape, leave demo mode.";

/**
 * Where the demo is, and putting the workspace as each step shows it on
 * entry: which panels show (`actions.showPanels`), the save form closed,
 * Kīlauea's marks cleared unless a timelapse keeps playing, then the step's own `enter`.
 */
function useDemoSteps({ startAt, state, actions, onEnd }) {
  const [index, setIndex] = useState(startAt);
  const step = DEMO_STEPS[index];
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  useEffect(() => {
    stateRef.current = state;
    actionsRef.current = actions;
  });
  const go = useCallback((i) => {
    if (i >= DEMO_STEPS.length) onEnd();
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    else setIndex(Math.max(0, i));
  }, [onEnd]);

  useEffect(() => {
    const entered = DEMO_STEPS[index];
    if (!entered.keepPlaying) pauseAllPlayback();
    actionsRef.current.showPanels?.({ panel: Boolean(entered.panel), chain: Boolean(entered.chain) });
    actionsRef.current.closeSave?.();
    if (!entered.keepPlaying) actionsRef.current.leaveKilauea?.();
    entered.enter?.(actionsRef.current);
  }, [index]);

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
  return { index, step, go, next, back, stateRef, actionsRef };
}

/**
 * A drawing step moves on by itself once the presenter has drawn: the
 * drawing happens in the workspace, outside the demo, so this follows it in
 * an effect. A drawing left over from before (done on entry) doesn't count:
 * the step waits for its own.
 */
function useMoveOnWhenDrawn({ step, index, go, isDone }) {
  const doneOnEntry = useRef(true);
  useEffect(() => {
    doneOnEntry.current = true;
  }, [index]);
  useEffect(() => {
    if (!step.done) return;
    if (doneOnEntry.current) {
      doneOnEntry.current = isDone;
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    if (isDone) go(index + 1);
  }, [isDone, index, step, go]);
}

/** Start the timelapse as soon as its player is on the page. */
function useAutoplay(step) {
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
}

/** The middle of the map on screen (a side panel narrows it), for the caption. */
function useMapMiddle() {
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
  return mapMid;
}

/**
 * Keys (see services/keys.js): Space / Enter / Page Down move on, Backspace /
 * Page Up go back (from the first step, out of demo mode), Escape leaves,
 * ← / → switch dates on a step with a pair. None is a character key, and
 * none is taken from a text field or a control reached with the keyboard.
 */
function useDemoKeys({ steps, onEnd }) {
  const { step, next, back, stateRef, actionsRef } = steps;
  useEffect(() => {
    const take = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const forward = (e) => {
      take(e);
      // A button clicked with the mouse earlier (e.g. Play) would also take the Space.
      if (document.activeElement !== document.body && !document.activeElement?.closest?.(".demo-card")) {
        document.activeElement?.blur?.();
      }
      if (!e.repeat) next();
    };
    const key = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || keyBelongsToFocus(e)) return;
      if ([" ", "PageDown", "Enter"].includes(e.key)) forward(e);
      else if (["Backspace", "PageUp"].includes(e.key)) {
        take(e);
        if (!e.repeat) back();
      } else if (e.key === "Escape" && !stateRef.current.drawing) {
        // Mid-drawing, Escape cancels the drawing (the map handles it).
        take(e);
        onEnd();
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
  }, [next, back, onEnd, step, stateRef, actionsRef]);
}

/** A card of the pitch: a few large lines and Next. It takes the focus, so a screen reader reads it. */
function DemoCard({ card, last, onNext }) {
  const cardRef = useRef(null);
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [card]);
  return (
    <div className="demo-backdrop">
      <dialog
        open
        ref={cardRef}
        className="demo-card"
        aria-labelledby="demo-card-text"
        aria-describedby="demo-keys"
        tabIndex={-1}
      >
        <div id="demo-card-text">
          {card.lines.map((line) => (
            <p key={line.text} className={line.small ? "demo-line demo-line-small" : "demo-line"}>
              {line.label && <span className="demo-label">{line.label}: </span>}
              {line.text}
            </p>
          ))}
        </div>
        <button type="button" className="btn btn-primary demo-next" onClick={onNext} aria-keyshortcuts="Space Enter">
          {last ? "Done" : "Next"} <kbd aria-hidden="true">Space</kbd>
        </button>
      </dialog>
    </div>
  );
}

/** What a screen reader hears on each step. */
function announcement(step, index) {
  const text = step.card ? step.card.lines.map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join(" ") : step.label ?? "";
  return `Demo step ${index + 1} of ${DEMO_STEPS.length}. ${text} ${step.sr ?? ""}${index === 0 ? ` ${KEYS_HELP}` : ""}`.trim();
}

/**
 * Demo mode: the tour for a live pitch. The workspace shows only what the
 * step is about (each step tells it which panels through
 * `actions.showPanels`); this draws the cards, a small caption over the map
 * and nothing else.
 *
 * Space (or Page Down, a clicker) moves on; on a drawing step not yet done
 * it draws the suggested box or line first. Backspace (Page Up) goes back,
 * Escape leaves (except mid-drawing, where it cancels the drawing). On a
 * step with a pair of dates, ← and → show the first and the second.
 */
export default function DemoTour({ state, actions, onEnd, startAt = 0 }) {
  const steps = useDemoSteps({ startAt, state, actions, onEnd });
  const { index, step } = steps;
  useMoveOnWhenDrawn({ step, index, go: steps.go, isDone: step.done ? step.done(state) : true });
  useAutoplay(step);
  useDemoKeys({ steps, onEnd });
  const mapMid = useMapMiddle();
  return (
    <div className="demo-layer" data-testid="demo" data-step={step.id}>
      {step.card && <DemoCard card={step.card} last={index === DEMO_STEPS.length - 1} onNext={steps.next} />}
      {!step.card && step.label && (
        <p className="demo-caption" style={mapMid == null ? undefined : { "--map-mid": `${mapMid}px` }}>
          {step.label}
        </p>
      )}
      <div className="demo-dots" aria-hidden="true">
        {DEMO_STEPS.map((s, i) => (
          <span key={s.id} data-on={i === index || undefined} />
        ))}
      </div>
      <button type="button" className="demo-exit" onClick={onEnd} aria-label="Leave demo mode" aria-keyshortcuts="Escape" title="Leave demo mode (Esc)">
        ×
      </button>
      <p id="demo-keys" className="visually-hidden">{KEYS_HELP}</p>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement(step, index)}</p>
    </div>
  );
}
