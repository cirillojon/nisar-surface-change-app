import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { keyBelongsToFocus } from "../../services/keys.js";
import { pauseAllPlayback } from "../../services/usePlayback.js";
import {
  BUBBLE_W,
  HIDE_WHILE_LOADING_MS,
  INTRO_W,
  NOTHING,
  PAD,
  POLL_MS,
  SETTLE_GIVE_UP,
  arrowPath,
  holeOf,
  isBig,
  overlayShapes,
  placeBubble,
  targetElement,
  visibleRect,
} from "./geometry.js";
import { SarDiagram } from "./Illustrations.jsx";
import { PARTS, STEPS } from "./steps.js";

/**
 * Where the tour is: the step, moving through the steps (Next, Back, Restart,
 * or past the end), and putting the app as each step shows it on entry.
 * `atEntry` is the app's state when the step was entered.
 */
function useTourSteps({ startAt, state, actions, onEnd }) {
  const [index, setIndex] = useState(startAt);
  // The step whose target has taken too long to show up.
  const [lateIndex, setLateIndex] = useState(-1);
  const stateRef = useRef(state);
  const atEntryRef = useRef(state);
  const actionsRef = useRef(actions);
  useEffect(() => {
    stateRef.current = state;
    actionsRef.current = actions;
  });
  const go = useCallback((i) => {
    if (i >= STEPS.length) {
      onEnd();
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setLateIndex(-1);
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setIndex(Math.max(0, i));
  }, [onEnd]);
  const next = useCallback(() => go(index + 1), [go, index]);
  // Back: the previous step, skipping steps that only exist mid-drawing, with
  // the map put back as that step expects (e.g. the box redrawn).
  const back = useCallback(() => {
    let target = index - 1;
    while (target > 0 && STEPS[target].midDraw) target -= 1;
    if (target < 0) return;
    if (STEPS[target].scene) actionsRef.current.setScene?.(STEPS[target].scene);
    go(target);
  }, [go, index]);

  // Entering a step: put the app as the step shows it. A timelapse left
  // running would distract from the other steps.
  useEffect(() => {
    const step = STEPS[index];
    if (!step.keepPlaying) pauseAllPlayback();
    atEntryRef.current = stateRef.current;
    if (!step.keepsDialog) actionsRef.current.closeSave?.();
    actionsRef.current.openShare?.(false);
    actionsRef.current.leaveKilauea?.();
    const entry = new AbortController();
    step.enter?.(actionsRef.current, entry.signal);
    return () => entry.abort();
  }, [index]);

  // A step with a target that is slow to appear: the bubble waits out of
  // sight rather than sit mid-screen and then slide across to the target.
  useEffect(() => {
    const timer = setTimeout(() => setLateIndex(index), HIDE_WHILE_LOADING_MS);
    return () => clearTimeout(timer);
  }, [index]);

  return { index, step: STEPS[index], go, next, back, late: lateIndex === index, stateRef, atEntryRef };
}

/** How far along a step's `sequence` of dates the land player's bar has been. */
function useSequence(index, step, landDate) {
  const [progress, setProgress] = useState({ index: -1, n: 0 });
  const seqIndexRef = useRef(-1);
  useEffect(() => {
    const fresh = seqIndexRef.current !== index;
    seqIndexRef.current = index;
    if (!step.sequence) return;
    setProgress((p) => {
      const n = fresh || p.index !== index ? 0 : p.n;
      return landDate === step.sequence[n] ? { index, n: n + 1 } : { index, n };
    });
  }, [index, step, landDate]);
  return progress.index === index ? progress.n : 0;
}

/**
 * The tour follows the app as well as leading it: it moves on as soon as the
 * viewer has done the step's action (a `watch` step waits for Next, so they
 * can watch what the action started), and a step that only makes sense
 * mid-drawing goes back to the step that starts it once the drawing is gone
 * (cancelled with Escape). Both react to what happens in the workspace and on
 * the page (the timelapse playing), outside the tour, so they are effects.
 */
function useFollowTheApp({ isDone, lost, step, index, go }) {
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    if (lost) go(index - 1);
  }, [lost, index, go]);
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    if (isDone && !step.finish && !step.watch) go(index + 1);
  }, [isDone, index, step, go]);
}

/** What the page measures for a step: target, spotlights, map marks, controls left usable. */
function measure(step, phone) {
  const el = targetElement(phone && step.mobileTarget ? step.mobileTarget : step.target);
  const spots = (step.spotlight ?? []).map((sel) => visibleRect(targetElement([sel]))).filter(Boolean);
  const marksSelector = step.midDraw ? ".tour-corner, .tour-pin, .draw-bar" : ".tour-corner, .tour-pin";
  const marks = [...document.querySelectorAll(marksSelector)]
    .map((m) => m.getBoundingClientRect())
    .filter((b) => b.width > 0)
    .map((b) => ({ left: b.left - 8, top: b.top - 8, right: b.right + 8, bottom: b.bottom + 8 }));
  const grip = visibleRect(targetElement([".sidebar-resizer"]));
  if (grip) marks.push(grip);
  // The header's End tour button stays usable on every step.
  const exit = visibleRect(targetElement([".tour-button"]));
  return { el, spots, marks, grip, exit };
}

/** Scroll a target the viewer can't fully see into view: in its sidebar, or the page. */
function reveal(step, el, rect, sidebarResized) {
  const phone = window.innerWidth <= 760;
  const panel = el.closest(".sidebar-scroll");
  const full = el.getBoundingClientRect();
  const clipped = !rect || rect.height + 1 < Math.min(full.height, window.innerHeight / 2);
  // On phones, leave room under low controls for the callout and its buttons.
  const lowControl = phone && full.height < 120 && full.bottom > window.innerHeight * 0.65;
  if (!clipped && !lowControl) return false;
  if (step.scrollScope === "sidebar" || (sidebarResized && panel)) {
    if (panel) panel.scrollTop += full.top - panel.getBoundingClientRect().top - PAD * 2;
  } else {
    el.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
  }
  return true;
}

/**
 * Watch the page for the step: its target counts as settled once it, the
 * spotlit areas and the tour's map marks are where they were at the last
 * look. Also whether a timelapse is playing (the player owns that state).
 */
function usePageLook(step, index) {
  const [look, setLook] = useState(NOTHING);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let seen = null;
    let waited = 0;
    let tracked = null;
    let revealed = null;
    const tick = (sidebarResized = false) => {
      const found = measure(step, window.innerWidth <= 760);
      const { el } = found;
      let r = visibleRect(el);
      const resizedPanel = sidebarResized === true && Boolean(el?.closest(".sidebar-scroll"));
      if (el && (revealed !== el || resizedPanel) && reveal(step, el, r, resizedPanel)) {
        revealed = el;
        r = visibleRect(el);
      }
      const bounds = [r, ...found.spots, ...found.marks, found.exit].map((b) => b && [b.left, b.top, b.right, b.bottom].map(Math.round));
      const now = JSON.stringify([window.innerWidth, window.innerHeight, ...bounds]);
      waited = r ? waited + 1 : 0;
      const still = !step.target.length || (Boolean(r) && (tracked === el || now === seen || waited > SETTLE_GIVE_UP));
      if (still && r) {
        tracked = el;
        revealed = el;
      }
      setLook((prev) => (prev.index === index && prev.settled === still && prev.key === now
        ? prev
        : { index, rect: r, spots: found.spots, marks: found.marks, grip: found.grip, exit: found.exit, settled: still, key: now }));
      seen = now;
      setPlaying(Boolean(document.querySelector('.map-timeline .scene-controls button[aria-pressed="true"]')));
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    const resize = () => {
      revealed = null;
      tick();
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => tick(true)) : null;
    document.querySelectorAll(".app-body > .sidebar, .app-body .map-canvas").forEach((node) => observer?.observe(node));
    window.addEventListener("scroll", tick, { capture: true, passive: true });
    window.addEventListener("resize", resize);
    return () => {
      clearInterval(timer);
      observer?.disconnect();
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", resize);
    };
  }, [step, index]);
  // A look at an earlier step says nothing about this one.
  return { look: look.index === index ? look : NOTHING, looked: look.index === index, playing };
}

/**
 * Where the bubble goes, once the step's target has settled (or is late):
 * measured at each candidate width, as the text wraps differently.
 * `redo` lists what else can change its size (its text, say).
 */
function useBubblePlace({ bubbleRef, look, looked, late, index, width, redo }) {
  const [bubble, setBubble] = useState(null);
  const { rect, spots, marks, settled } = look;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  useLayoutEffect(() => {
    if (!looked || (!settled && !late)) return;
    const card = bubbleRef.current;
    const currentWidth = card.style.width;
    const heightAtWidth = (candidate) => {
      card.style.width = `${candidate}px`;
      return card.offsetHeight;
    };
    const avoid = spots.map((s) => ({ left: s.left - PAD, top: s.top - PAD, right: s.right + PAD, bottom: s.bottom + PAD }));
    const nextBox = { ...placeBubble(settled ? rect : null, avoid, marks, heightAtWidth, vw, vh, width), index };
    card.style.width = currentWidth;
    setBubble((prev) => {
      if (prev?.index === index && ["left", "top", "w", "h"].every((k) => Math.abs(prev[k] - nextBox[k]) < 1)) return prev;
      return nextBox;
    });
  }, [bubbleRef, rect, spots, marks, index, settled, looked, late, vw, vh, width, redo]);
  return bubble;
}

/**
 * Keys (see services/keys.js): Space, → and Page Down press Next; Backspace,
 * ← and Page Up go back (from the first step, close the tour); Escape skips.
 * A text field, or a control reached with the keyboard, keeps its own keys.
 */
function useTourKeys({ steps, canNext, onEnd }) {
  const { index, next, back, stateRef } = steps;
  useEffect(() => {
    const take = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const forward = (e) => {
      take(e);
      if (e.key === " " && !document.activeElement?.closest?.(".tour-bubble")) {
        // A button clicked with the mouse would take the Space as well.
        document.activeElement?.blur?.();
      }
      if (e.key !== " " || !e.repeat) next();
    };
    const backward = (e) => {
      take(e);
      if (e.repeat) return;
      if (index === 0 && e.key === "Backspace") onEnd();
      else back();
    };
    const key = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || keyBelongsToFocus(e)) return;
      // Except while drawing, where Escape cancels the drawing.
      if (e.key === "Escape" && !stateRef.current.drawing) onEnd();
      else if ([" ", "ArrowRight", "PageDown"].includes(e.key) && canNext) forward(e);
      else if (["Backspace", "ArrowLeft", "PageUp"].includes(e.key)) backward(e);
    };
    // A mouse-focused button fires its click on Space's key-up: not while Space means Next.
    const up = (e) => {
      if (e.key === " " && canNext && !keyBelongsToFocus(e)) e.preventDefault();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [onEnd, next, back, canNext, index, stateRef]);
}

/** A click outside what the step is about shakes the bubble for a moment. */
function useNudge() {
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    if (!nudge) return undefined;
    const timer = setTimeout(() => setNudge(0), 450);
    return () => clearTimeout(timer);
  }, [nudge]);
  const blocked = (e) => {
    e.preventDefault();
    setNudge((n) => n + 1);
  };
  return [nudge > 0, blocked];
}

/**
 * The shade over the page with the step's target and spotlights cut out,
 * their outlines, and the arrow to the target. The shade (and, over lit
 * areas that aren't the step's action, glass) catches stray clicks.
 */
function TourShade({ look, bubble, interactive, onBlocked }) {
  const clipId = useId();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const shown = look.settled ? look.rect : null;
  const hole = holeOf(shown);
  const spotHoles = look.settled ? look.spots.map(holeOf) : [];
  const { shade, glass, passThrough } = overlayShapes({ hole, spotHoles, interactive, grip: look.grip, exit: look.exit, vw, vh });
  const clipPath = passThrough.length ? `url(#${clipId})` : undefined;
  const arrow = hole && bubble && !isBig(shown, vw, vh) ? arrowPath(hole, bubble) : null;
  return (
    <svg className="tour-dim" width={vw} height={vh} aria-hidden="true">
      <defs>
        <marker id="tour-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#ffd34d" stroke="#0b1220" strokeWidth="1" />
        </marker>
        {clipPath && (
          <clipPath id={clipId}>
            <path
              clipRule="evenodd"
              d={`M0 0H${vw}V${vh}H0Z${passThrough.map((b) => `M${b.left} ${b.top}H${b.right}V${b.bottom}H${b.left}Z`).join("")}`}
            />
          </clipPath>
        )}
      </defs>
      <path className="tour-shade" data-testid="tour-shade" d={shade} fillRule="evenodd" clipPath={clipPath} onPointerDown={onBlocked} />
      {glass && (
        <path className="tour-glass" data-testid="tour-glass" d={glass} fillRule="evenodd" clipPath={clipPath} onPointerDown={onBlocked} />
      )}
      {spotHoles.map((h) => (
        <rect key={`${h.x},${h.y},${h.w},${h.h}`} className="tour-spot" x={h.x} y={h.y} width={h.w} height={h.h} rx="10" />
      ))}
      {hole && (
        <>
          <rect className="tour-ring-outer" x={hole.x - 3} y={hole.y - 3} width={hole.w + 6} height={hole.h + 6} rx="12" />
          <rect className="tour-ring" x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" />
        </>
      )}
      {arrow && (
        <>
          <path d={arrow} className="tour-arrow-outline" />
          <path d={arrow} className="tour-arrow" markerEnd="url(#tour-arrowhead)" />
        </>
      )}
    </svg>
  );
}

/** The bubble's text: where the step is, what it shows, and what to do (or what is awaited). */
function BubbleText({ step, index, waiting, snappedLine, isDone }) {
  const part = PARTS.find((p) => p.id === step.part);
  const label = part && !step.art && !step.unlabelled ? `${part.label} · ` : "";
  return (
    <>
      <p className="tour-step-count">
        <span>{label}{index + 1} of {STEPS.length}</span>
      </p>
      {step.art === "sar" && <SarDiagram />}
      <h3 id="tour-bubble-title">{step.title}</h3>
      <p>{waiting ? step.waiting : step.body}</p>
      {step.hint && !waiting && <p className="tour-hint">{step.hint}</p>}
      {snappedLine && <p className="muted small">Your line was matched to the suggested one so it opened instantly.</p>}
      {isDone && step.watch && <p className="tour-nice">{step.nice ?? "Nice! Watch a few frames, then click Next."}</p>}
      <div className="tour-progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
      </div>
    </>
  );
}

/** Skip and Restart; Back and Next (when the step allows moving on). */
function BubbleActions({ steps, canNext, onEnd }) {
  const { index, go, next, back } = steps;
  const last = index === STEPS.length - 1;
  const nextLabel = last ? "Start exploring" : index === 0 ? "Start the demo" : "Next →";
  return (
    <div className="tour-actions">
      <span className="tour-nav">
        {!last && (
          <button type="button" className="btn btn-link" onClick={onEnd} aria-keyshortcuts="Escape">
            {index === 0 ? "Skip, I'll explore" : "Skip tour"}
          </button>
        )}
        {index > 0 && <button type="button" className="btn btn-link" onClick={() => go(0)}>Restart</button>}
      </span>
      <span className="tour-nav">
        {index > 0 && (
          <button type="button" className="btn btn-secondary" onClick={back} aria-keyshortcuts="Backspace ArrowLeft">
            ← Back
          </button>
        )}
        {canNext && (
          <button type="button" className="btn btn-primary" onClick={next} aria-keyshortcuts="Space ArrowRight">
            {nextLabel}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Where the step stands: done (after its entry actions applied: a look at
 * this step has been taken), lost (a mid-drawing step whose drawing is
 * gone), can move on, and waiting for a target that hasn't appeared.
 */
function stepStatus({ step, state, playing, looked, look, sequenceAt, atEntry }) {
  let isDone = false;
  if (looked) {
    isDone = step.sequence ? sequenceAt >= step.sequence.length : Boolean(step.done?.({ ...state, playing }, atEntry));
  }
  return {
    isDone,
    lost: Boolean(step.needs) && !step.needs(state),
    canNext: Boolean(step.next) || isDone,
    waiting: (looked && step.target.length > 0 && !look.rect && step.waiting) || null,
  };
}

const PHONE_QUERY = "(max-width: 760px)";

/**
 * On a phone the bubble can fold down to its title and buttons, to show the
 * map behind it. It opens again on the next step.
 */
function useFold(index) {
  const [foldedAt, setFoldedAt] = useState(-1);
  const [phone, setPhone] = useState(() => Boolean(window.matchMedia?.(PHONE_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia?.(PHONE_QUERY);
    if (!query) return undefined;
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const folded = phone && foldedAt === index;
  const toggle = () => setFoldedAt(folded ? -1 : index);
  return { phone, folded, toggle };
}

function FoldButton({ folded, onToggle }) {
  return (
    <button
      type="button"
      className="tour-fold"
      aria-expanded={!folded}
      aria-label={folded ? "Show the tour text" : "Hide the tour text to see the map"}
      onClick={onToggle}
    >
      {folded ? "Show" : "Hide"}
    </button>
  );
}

/**
 * The bubble: a non-modal dialog (the page stays usable), kept out of sight
 * until it has its measured place, and shaken by a stray click.
 */
function TourBubble({ bubbleRef, bubble, step, index, width, nudged, fold, children }) {
  // Keep the next step out of sight until we have its coordinates.
  const placing = bubble?.index !== index;
  const classes = ["tour-bubble", nudged && "tour-bubble-nudge", step.art && "tour-bubble-intro", fold.folded && "tour-bubble-folded"].filter(Boolean).join(" ");
  const style = { left: bubble?.left, top: bubble?.top, width: bubble?.w ?? width };
  return (
    <dialog
      open
      ref={bubbleRef}
      className={classes}
      data-placing={placing ? "" : undefined}
      style={placing ? { ...style, opacity: 0, pointerEvents: "none" } : style}
      aria-labelledby="tour-bubble-title"
    >
      {fold.phone && <FoldButton folded={fold.folded} onToggle={fold.toggle} />}
      {children}
    </dialog>
  );
}

/**
 * The guided tour: a short live demonstration of the app. Each step puts
 * the app in the state it describes (`enter`), outlines what it is about
 * and explains it; Next, Back, Restart and Skip move through it, and so do
 * the arrow and Page Up / Page Down keys (a presentation clicker). The rest
 * of the page is shaded and can't be clicked, so a stray click can't take
 * the demo off course; it nudges the bubble instead. Steps that ask for an
 * action let clicks through to their target.
 *
 * A step often changes the layout (a panel opens, a story loads). The
 * bubble waits for the next target to settle before revealing the new
 * step in its measured place (if the target is slow, it shows centred so
 * the viewer can still continue).
 */
export default function Tour({ state, actions, onEnd, startAt = 0 }) {
  const steps = useTourSteps({ startAt, state, actions, onEnd });
  const { index, step } = steps;
  const sequenceAt = useSequence(index, step, state.landDate);
  const { look, looked, playing } = usePageLook(step, index);
  // Back from Notes closes its form, so Share must not react to the outgoing form.
  const status = stepStatus({ step, state, playing, looked, look, sequenceAt, atEntry: steps.atEntryRef.current });
  const { isDone, waiting, canNext } = status;
  useFollowTheApp({ isDone, lost: status.lost, step, index, go: steps.go });
  useTourKeys({ steps, canNext, onEnd });
  const [nudged, onBlocked] = useNudge();
  const fold = useFold(index);
  const bubbleRef = useRef(null);
  const snappedLine = Boolean(state.snapped) && step.id === "profile-elevation";
  const width = step.art ? INTRO_W : BUBBLE_W;
  const bubble = useBubblePlace({ bubbleRef, look, looked, late: steps.late, index, width, redo: [isDone, waiting, snappedLine].join() });
  const say = waiting || `${step.title}. ${step.body}`;

  return (
    <div className="tour-layer" data-testid="tour">
      <TourShade look={look} bubble={bubble} interactive={Boolean(step.interactive)} onBlocked={onBlocked} />
      <TourBubble bubbleRef={bubbleRef} bubble={bubble} step={step} index={index} width={width} nudged={nudged} fold={fold}>
        <BubbleText step={step} index={index} waiting={waiting} snappedLine={snappedLine} isDone={isDone} />
        <BubbleActions steps={steps} canNext={canNext} onEnd={onEnd} />
      </TourBubble>
      <p className="visually-hidden" role="status" aria-live="polite">
        {`Tour step ${index + 1} of ${STEPS.length}: ${say}`}
      </p>
    </div>
  );
}
