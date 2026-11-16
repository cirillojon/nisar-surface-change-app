import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { keyBelongsToFocus } from "../../services/keys.js";
import { pauseAllPlayback } from "../../services/usePlayback.js";
import { SarDiagram } from "./Illustrations.jsx";
import { PARTS, STEPS } from "./steps.js";

const POLL_MS = 100;
// A target that is still moving after this many polls is used as it is.
const SETTLE_GIVE_UP = 15;
const BUBBLE_W = 340;
const INTRO_W = 460;
const GAP = 56; // room for the arrow between the bubble and its target
const MARGIN = 12;
const PAD = 6; // space between a highlighted element and its outline

const box = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
// The tour's view of the page before it has looked.
const NOTHING = { index: -1, rect: null, spots: [], marks: [], grip: null, settled: false, key: "" };

function targetElement(selectors = []) {
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !el.closest("[hidden], [inert]")) return el;
    }
  }
  return null;
}

function stickyTop(el, rect) {
  const workspace = el.closest(".app-body");
  if (!workspace) return 0;
  const chrome = [
    document.querySelector(".pf-topbar"),
    workspace.querySelector(".map-header"),
    workspace.querySelector(":scope > .sidebar"),
  ];
  let top = 0;
  for (const bar of chrome) {
    if (!bar || bar.contains(el)) continue;
    const style = getComputedStyle(bar);
    if (style.position !== "sticky") continue;
    const r = bar.getBoundingClientRect();
    if (r.top <= parseFloat(style.top) + 1 && r.right > rect.left && r.left < rect.right) {
      top = Math.max(top, r.bottom + PAD);
    }
  }
  return top;
}

const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);

// A target can still have a DOM rectangle when it is behind the sticky header
// or outside the scrollable part of a sidebar. Outline only the visible pixels.
function visibleRect(el) {
  if (!el) return null;
  const rect = box(el.getBoundingClientRect());
  let left = Math.max(0, rect.left);
  let top = Math.max(stickyTop(el, rect), rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!clips(style.overflowX) && !clips(style.overflowY)) continue;
    const r = parent.getBoundingClientRect();
    if (clips(style.overflowX)) {
      left = Math.max(left, r.left + parent.clientLeft);
      right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth);
    }
    if (clips(style.overflowY)) {
      top = Math.max(top, r.top + parent.clientTop);
      bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight);
    }
  }
  return right > left && bottom > top
    ? { left, top, right, bottom, width: right - left, height: bottom - top }
    : null;
}

const isBig = (r, vw, vh) => r.width > vw * 0.45 && r.height > vh * 0.35;
const overlaps = (a, b) =>
  a.left < b.right && a.left + a.w > b.left && a.top < b.bottom && a.top + a.h > b.top;

/**
 * Where the bubble goes: in a corner of big targets (clear of the tour's
 * map marks), else beside the target, clear of the spotlit areas (`avoid`)
 * when there's room. With no target, in the middle of the screen.
 */
function placeBubble(rect, avoid, marks, heightAtWidth, vw, vh, width) {
  const w = Math.min(width, vw - MARGIN * 2);
  const h = heightAtWidth(w);
  const gap = vw <= 760 ? 24 : GAP;
  if (!rect) return { left: (vw - w) / 2, top: Math.max(MARGIN, vh / 2 - h / 2), w, h };
  const clampX = (x) => Math.max(MARGIN, Math.min(vw - w - MARGIN, x));
  const clampY = (y, height) => Math.max(MARGIN, Math.min(vh - height - MARGIN, y));
  if (isBig(rect, vw, vh)) {
    const top = clampY(rect.top + 16, h);
    const bottom = clampY(Math.min(rect.bottom, vh) - h - 16, h);
    const corners = [
      { left: clampX(rect.right - w - 16), top },
      { left: clampX(rect.left + 60), top },
      { left: clampX(rect.right - w - 16), top: bottom },
      { left: clampX(rect.left + 60), top: bottom },
      // A short map (phones): the bubble may hang over its edge instead.
      { left: clampX(rect.left + 16), top: vh - h - MARGIN },
      { left: clampX(rect.left + 16), top: MARGIN },
    ];
    const free = corners.find((c) => !marks.some((m) => overlaps({ ...c, w, h }, m)));
    return { ...(free ?? corners[0]), w, h };
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const target = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  // Sideways for tall panels and things in the left sidebar; else below or above.
  const sideways = rect.height > 120 || rect.right < vw * 0.3;
  const candidatesFor = (bw, height) => {
    const clampXw = (x) => Math.max(MARGIN, Math.min(vw - bw - MARGIN, x));
    const sideTop = clampY(cy - height / 2, height);
    const below = { left: clampXw(cx - bw / 2), top: rect.bottom + gap };
    const above = { left: clampXw(cx - bw / 2), top: rect.top - gap - height };
    const right = { left: rect.right + gap, top: sideTop };
    const left = { left: rect.left - gap - bw, top: sideTop };
    const out = sideways ? [right, left, below, above] : [below, above, right, left];
    // Beside the spotlit area itself, level with the target.
    for (const a of avoid) {
      out.push(
        { left: a.right + MARGIN, top: sideTop },
        { left: a.left - MARGIN - bw, top: sideTop },
        { left: clampXw(cx - bw / 2), top: a.bottom + MARGIN },
        { left: clampXw(cx - bw / 2), top: a.top - MARGIN - height },
      );
    }
    return out.map((position) => ({ ...position, w: bw, h: height }));
  };
  const inView = (c) => c.left >= MARGIN && c.left + c.w <= vw - MARGIN && c.top >= MARGIN && c.top + c.h <= vh - MARGIN;
  const clearOf = (c, areas) => !areas.some((a) => overlaps(c, a));
  const candidates = candidatesFor(w, h);
  // Fit the map and target first. Each candidate width has its own text wrapping.
  const protectedAreas = [...avoid, ...marks, target];
  const wide = candidates.find((c) => inView(c) && clearOf(c, protectedAreas));
  if (wide) return wide;
  for (const bw of [300, 270].filter((x) => x < w)) {
    const pick = candidatesFor(bw, heightAtWidth(bw)).find((c) => inView(c) && clearOf(c, protectedAreas));
    if (pick) return pick;
  }
  const pick = candidates.find((c) => inView(c) && clearOf(c, [...marks, target]))
    ?? candidates.find((c) => inView(c) && clearOf(c, [target]))
    ?? candidates.find(inView);
  if (pick) return pick;
  return { left: clampX(cx - w / 2), top: clampY(rect.bottom + gap, h), w, h };
}

/** A rounded rectangle as an SVG subpath. */
function roundRect({ x, y, w, h }, r = 10) {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

const holeOf = (r) => r && { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
// A step's target that hasn't appeared by now is waited for in plain sight.
const HIDE_WHILE_LOADING_MS = 2500;

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
 * step in its measured place.
 */
export default function Tour({ state, actions, onEnd, startAt = 0 }) {
  const [index, setIndex] = useState(startAt);
  const [look, setLook] = useState(NOTHING);
  // Is a timelapse playing? (Read from the page: the player owns that state.)
  const [playing, setPlaying] = useState(false);
  const [bubble, setBubble] = useState(null);
  const [nudge, setNudge] = useState(0);
  // The step whose target has taken too long to show up.
  const [lateIndex, setLateIndex] = useState(-1);
  const bubbleRef = useRef(null);
  const resizeClipId = useId();
  const stateRef = useRef(state);
  const atEntryRef = useRef(state);
  const actionsRef = useRef(actions);
  useEffect(() => {
    stateRef.current = state;
    actionsRef.current = actions;
  });
  const step = STEPS[index];
  // How far along a step's `sequence` of dates the land player's bar has been.
  const [progress, setProgress] = useState({ index: -1, n: 0 });
  const sequenceAt = progress.index === index ? progress.n : 0;
  const seqIndexRef = useRef(-1);
  useEffect(() => {
    const fresh = seqIndexRef.current !== index;
    seqIndexRef.current = index;
    if (!step.sequence) return;
    setProgress((p) => {
      const n = fresh || p.index !== index ? 0 : p.n;
      return state.landDate === step.sequence[n] ? { index, n: n + 1 } : { index, n };
    });
  }, [index, step, state.landDate]);
  // A look at an earlier step says nothing about this one.
  const { rect, spots, marks, grip, settled } = look.index === index ? look : NOTHING;
  const looked = look.index === index;
  // Let the entry actions apply before evaluating completion. Back from
  // Notes closes its form, so Share must not react to the outgoing form.
  const isDone = looked && (step.sequence
    ? sequenceAt >= step.sequence.length
    : Boolean(step.done?.({ ...state, playing }, atEntryRef.current)));
  const interactive = Boolean(step.interactive);
  const last = index === STEPS.length - 1;
  const part = PARTS.find((p) => p.id === step.part);
  const width = step.art ? INTRO_W : BUBBLE_W;

  const go = useCallback(
    (i) => {
      if (i >= STEPS.length) {
        onEnd();
        return;
      }
      setLateIndex(-1);
      setIndex(Math.max(0, i));
    },
    [onEnd],
  );
  const canNext = step.next || isDone;
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
    if (!step.keepPlaying) pauseAllPlayback();
    atEntryRef.current = stateRef.current;
    if (!step.keepsDialog) actionsRef.current.closeSave?.();
    actionsRef.current.openShare?.(false);
    actionsRef.current.leaveKilauea?.();
    const entry = new AbortController();
    step.enter?.(actionsRef.current, entry.signal);
    return () => entry.abort();
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // A step that only makes sense mid-drawing (e.g. the drawing was
  // cancelled with Escape): go back to the step that starts it.
  const lost = step.needs && !step.needs(state);
  useEffect(() => {
    if (lost) go(index - 1);
  }, [lost, index, go]);

  // A step with a target that is slow to appear: the bubble waits out of
  // sight rather than sit mid-screen and then slide across to the target.
  useEffect(() => {
    const timer = setTimeout(() => setLateIndex(index), HIDE_WHILE_LOADING_MS);
    return () => clearTimeout(timer);
  }, [index]);

  // Watch the target. It counts as settled once it, the spotlit areas and
  // the tour's map marks are where they were at the last look.
  useEffect(() => {
    let seen = null;
    let waited = 0;
    let tracked = null;
    let revealed = null;
    const tick = (sidebarResized = false) => {
      const phone = window.innerWidth <= 760;
      const el = targetElement(phone && step.mobileTarget ? step.mobileTarget : step.target);
      const panel = el?.closest(".sidebar-scroll");
      let r = visibleRect(el);
      if (el && (revealed !== el || (sidebarResized === true && panel))) {
        const full = el.getBoundingClientRect();
        const clipped = !r || r.height + 1 < Math.min(full.height, window.innerHeight / 2);
        // On phones, leave room under low controls for the callout and its buttons.
        const lowControl = phone && full.height < 120 && full.bottom > window.innerHeight * 0.65;
        if (clipped || lowControl) {
          revealed = el;
          if (step.scrollScope === "sidebar" || (sidebarResized === true && panel)) {
            if (panel) panel.scrollTop += full.top - panel.getBoundingClientRect().top - PAD * 2;
          } else {
            el.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
          }
          r = visibleRect(el);
        }
      }
      const s = (step.spotlight ?? []).map((sel) => visibleRect(targetElement([sel]))).filter(Boolean);
      const marksSelector = step.midDraw ? ".tour-corner, .tour-pin, .draw-bar" : ".tour-corner, .tour-pin";
      const m = [...document.querySelectorAll(marksSelector)]
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.width > 0)
        .map((b) => ({ left: b.left - 8, top: b.top - 8, right: b.right + 8, bottom: b.bottom + 8 }));
      const handle = visibleRect(targetElement([".sidebar-resizer"]));
      if (handle) m.push(handle);
      const bounds = [r, ...s, ...m].map((b) => b && [b.left, b.top, b.right, b.bottom].map(Math.round));
      const now = JSON.stringify([window.innerWidth, window.innerHeight, ...bounds]);
      waited = r ? waited + 1 : 0;
      const still = !step.target.length || (Boolean(r) && (tracked === el || now === seen || waited > SETTLE_GIVE_UP));
      if (still && r) {
        tracked = el;
        revealed = el;
      }
      setLook((prev) =>
        prev.index === index && prev.settled === still && prev.key === now
          ? prev
          : { index, rect: r, spots: s, marks: m, grip: handle, settled: still, key: now });
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

  // Move on as soon as the user has done the step's action (a `watch` step
  // waits for Next, so they can watch what the action started).
  useEffect(() => {
    if (isDone && !step.finish && !step.watch) go(index + 1);
  }, [isDone, index, step, go]);

  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const shown = settled ? rect : null;
  const hole = holeOf(shown);
  const spotHoles = settled ? spots.map(holeOf) : [];

  // Keep the next step out of sight until we have its coordinates.
  // If the target is slow, the centered card gives the viewer a way to continue.
  const placing = bubble?.index !== index;
  const late = lateIndex === index;
  const waiting = looked && step.target.length > 0 && !rect && step.waiting;
  const snappedLine = state.snapped && step.id === "profile-elevation";
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
  }, [rect, spots, marks, index, isDone, settled, looked, late, waiting, snappedLine, vw, vh, width]);

  // Keys (see services/keys.js): Space, → and Page Down press Next; Backspace,
  // ← and Page Up go back (from the first step, close the tour); Escape skips.
  // A text field, or a control reached with the keyboard, keeps its own keys.
  useEffect(() => {
    const take = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const key = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || keyBelongsToFocus(e)) return;
      if (e.key === "Escape") {
        // Except while drawing, where Escape cancels the drawing.
        if (!stateRef.current.drawing) onEnd();
      } else if (e.key === " " && canNext) {
        take(e);
        // A button clicked with the mouse would take the Space as well.
        if (!document.activeElement?.closest?.(".tour-bubble")) document.activeElement?.blur?.();
        if (!e.repeat) next();
      } else if ((e.key === "ArrowRight" || e.key === "PageDown") && canNext) {
        take(e);
        next();
      } else if (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "PageUp") {
        take(e);
        if (e.repeat) return;
        if (index === 0 && e.key === "Backspace") onEnd();
        else back();
      }
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
  }, [onEnd, next, back, canNext, index]);

  // A click outside what the step is about: shake the bubble.
  useEffect(() => {
    if (!nudge) return undefined;
    const timer = setTimeout(() => setNudge(0), 450);
    return () => clearTimeout(timer);
  }, [nudge]);
  const blocked = (e) => {
    e.preventDefault();
    setNudge((n) => n + 1);
  };

  const smallTarget = shown && !isBig(shown, vw, vh);
  // Arrow from the bubble's nearest edge to the target's edge.
  let arrow = null;
  if (hole && smallTarget && bubble) {
    const bx = bubble.left + bubble.w / 2;
    const below = bubble.top >= hole.y + hole.h;
    const above = bubble.top + bubble.h <= hole.y;
    const leftOf = bubble.left + bubble.w <= hole.x;
    const ty = Math.max(hole.y + 12, Math.min(hole.y + hole.h - 12, bubble.top + 40));
    let start;
    let end;
    if (below) {
      start = [bx, bubble.top];
      end = [hole.x + hole.w / 2, hole.y + hole.h + 4];
    } else if (above) {
      start = [bx, bubble.top + bubble.h];
      end = [hole.x + hole.w / 2, hole.y - 4];
    } else if (leftOf) {
      start = [bubble.left + bubble.w, bubble.top + 40];
      end = [hole.x - 4, ty];
    } else {
      start = [bubble.left, bubble.top + 40];
      end = [hole.x + hole.w + 4, ty];
    }
    const cx = (start[0] + end[0]) / 2 + (below || above ? 30 : 0);
    const cy = (start[1] + end[1]) / 2;
    arrow = `M${start[0]} ${start[1]} Q${cx} ${cy} ${end[0]} ${end[1]}`;
  }
  const holes = [hole, ...spotHoles].filter(Boolean);
  // Even-odd fill would shade a hole inside another hole again: skip those.
  const inside = (a, b) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const cutouts = holes.filter((h) => !holes.some((other) => inside(h, other)));
  const shade = `M0 0H${vw}V${vh}H0Z${cutouts.map((h) => roundRect(h)).join("")}`;
  const gripClip = grip ? `url(#${resizeClipId})` : undefined;
  // Clicks are caught over every lit area except, on action steps, the
  // target itself (cut out of the spotlight it sits in).
  const glassHoles = interactive ? spotHoles : holes;
  const targetInSpot = interactive && hole && spotHoles.some((s) => inside(hole, s));
  const glass = glassHoles.map((h) => roundRect(h)).join("") + (targetInSpot ? roundRect(hole) : "");
  const say = waiting ? step.waiting : `${step.title}. ${step.body}`;

  return (
    <div className="tour-layer" data-testid="tour">
      <svg className="tour-dim" width={vw} height={vh} aria-hidden="true">
        <defs>
          <marker id="tour-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#ffd34d" stroke="#0b1220" strokeWidth="1" />
          </marker>
          {grip && (
            <clipPath id={resizeClipId}>
              <path clipRule="evenodd" d={`M0 0H${vw}V${vh}H0ZM${grip.left} ${grip.top}H${grip.right}V${grip.bottom}H${grip.left}Z`} />
            </clipPath>
          )}
        </defs>
        <path className="tour-shade" data-testid="tour-shade" d={shade} fillRule="evenodd" clipPath={gripClip} onPointerDown={blocked} />
        {glass && (
          <path className="tour-glass" data-testid="tour-glass" d={glass} fillRule="evenodd" clipPath={gripClip} onPointerDown={blocked} />
        )}
        {spotHoles.map((h, i) => (
          <rect key={i} className="tour-spot" x={h.x} y={h.y} width={h.w} height={h.h} rx="10" />
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

      <div
        ref={bubbleRef}
        className={`tour-bubble${nudge ? " tour-bubble-nudge" : ""}${step.art ? " tour-bubble-intro" : ""}`}
        data-placing={placing ? "" : undefined}
        style={{
          left: bubble?.left,
          top: bubble?.top,
          width: bubble?.w ?? width,
          ...(placing && { opacity: 0, pointerEvents: "none" }),
        }}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-bubble-title"
      >
        <p className="tour-step-count">
          <span>
            {part && !step.art && !step.unlabelled ? `${part.label} · ` : ""}{index + 1} of {STEPS.length}
          </span>
        </p>
        {step.art === "sar" && <SarDiagram />}
        <h3 id="tour-bubble-title">{step.title}</h3>
        <p>{waiting ? step.waiting : step.body}</p>
        {step.hint && !waiting && <p className="tour-hint">{step.hint}</p>}
        {snappedLine && (
          <p className="muted small">Your line was matched to the suggested one so it opened instantly.</p>
        )}
        {isDone && step.watch && <p className="tour-nice">{step.nice ?? "Nice! Watch a few frames, then click Next."}</p>}
        <div className="tour-progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="tour-actions">
          <span className="tour-nav">
            {!last && (
              <button type="button" className="btn btn-link" onClick={onEnd} aria-keyshortcuts="Escape">
                {index === 0 ? "Skip, I'll explore" : "Skip tour"}
              </button>
            )}
            {index > 0 && (
              <button type="button" className="btn btn-link" onClick={() => go(0)}>
                Restart
              </button>
            )}
          </span>
          <span className="tour-nav">
            {index > 0 && (
              <button type="button" className="btn btn-secondary" onClick={back} aria-keyshortcuts="Backspace ArrowLeft">
                ← Back
              </button>
            )}
            {canNext && (
              <button type="button" className="btn btn-primary" onClick={next} aria-keyshortcuts="Space ArrowRight">
                {last ? "Start exploring" : index === 0 ? "Start the demo" : "Next →"}
              </button>
            )}
          </span>
        </div>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {`Tour step ${index + 1} of ${STEPS.length}: ${say}`}
      </p>
    </div>
  );
}
