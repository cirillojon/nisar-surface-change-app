// Where things are on the page for the guided tour: the step's target (only
// its visible part), where the bubble fits, and the shapes of the shade, the
// spotlights and the arrow. Plain functions of the page and the viewport.

export const POLL_MS = 100;
// A target that is still moving after this many polls is used as it is.
export const SETTLE_GIVE_UP = 15;
export const BUBBLE_W = 340;
export const INTRO_W = 460;
const GAP = 56; // room for the arrow between the bubble and its target
const MARGIN = 12;
export const PAD = 6; // space between a highlighted element and its outline

const box = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
// The tour's view of the page before it has looked.
export const NOTHING = { index: -1, rect: null, spots: [], marks: [], grip: null, exit: null, settled: false, key: "" };

export function targetElement(selectors = []) {
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
export function visibleRect(el) {
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

export const isBig = (r, vw, vh) => r.width > vw * 0.45 && r.height > vh * 0.35;
const overlaps = (a, b) =>
  a.left < b.right && a.left + a.w > b.left && a.top < b.bottom && a.top + a.h > b.top;

/**
 * Where the bubble goes: in a corner of big targets (clear of the tour's
 * map marks), else beside the target, clear of the spotlit areas (`avoid`)
 * when there's room. With no target, in the middle of the screen.
 */
export function placeBubble(rect, avoid, marks, heightAtWidth, vw, vh, width) {
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
export function roundRect({ x, y, w, h }, r = 10) {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

export const holeOf = (r) => r && { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
// A step's target that hasn't appeared by now is waited for in plain sight.
export const HIDE_WHILE_LOADING_MS = 2500;

/** The arrow from the bubble's nearest edge to the target's edge (null: none needed). */
export function arrowPath(hole, bubble) {
  const bx = bubble.left + bubble.w / 2;
  const below = bubble.top >= hole.y + hole.h;
  const above = bubble.top + bubble.h <= hole.y;
  const leftOf = bubble.left + bubble.w <= hole.x;
  const ty = Math.max(hole.y + 12, Math.min(hole.y + hole.h - 12, bubble.top + 40));
  let start = [bubble.left, bubble.top + 40];
  let end = [hole.x + hole.w + 4, ty];
  if (below) {
    start = [bx, bubble.top];
    end = [hole.x + hole.w / 2, hole.y + hole.h + 4];
  } else if (above) {
    start = [bx, bubble.top + bubble.h];
    end = [hole.x + hole.w / 2, hole.y - 4];
  } else if (leftOf) {
    start = [bubble.left + bubble.w, bubble.top + 40];
    end = [hole.x - 4, ty];
  }
  const cx = (start[0] + end[0]) / 2 + (below || above ? 30 : 0);
  const cy = (start[1] + end[1]) / 2;
  return `M${start[0]} ${start[1]} Q${cx} ${cy} ${end[0]} ${end[1]}`;
}

/**
 * The shade over the page (with the target and spotlights cut out), the
 * glass that catches clicks on lit areas (on action steps, all but the
 * target), and the controls clipped out of both so they stay usable (the
 * sidebar's resize grip, the End tour button).
 */
export function overlayShapes({ hole, spotHoles, interactive, grip, exit, vw, vh }) {
  const holes = [hole, ...spotHoles].filter(Boolean);
  // Even-odd fill would shade a hole inside another hole again: skip those.
  const inside = (a, b) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const cutouts = holes.filter((h) => !holes.some((other) => inside(h, other)));
  const glassHoles = interactive ? spotHoles : holes;
  const targetInSpot = interactive && hole && spotHoles.some((s) => inside(hole, s));
  return {
    shade: `M0 0H${vw}V${vh}H0Z${cutouts.map((h) => roundRect(h)).join("")}`,
    glass: glassHoles.map((h) => roundRect(h)).join("") + (targetInSpot ? roundRect(hole) : ""),
    passThrough: [grip, exit].filter(Boolean),
  };
}
