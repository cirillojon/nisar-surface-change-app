import { useEffect } from "react";
import { heroGlobeBoundary } from "./earth/hero-globe-layout.js";
import { bounceFromGlobe, globeReturnRoute } from "./earth/globe-obstacle.js";

const FRAME_MS = 1000 / 60;
const DRAG_THRESHOLD = 6;
const MAX_SPEED = 24;
const FLOOR_GAP = 14;
const RETURN_DELAY = 160;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function wrapPosition(x, period, start = 0) {
  return ((x - start) % period + period) % period + start;
}

export function bumpCards(first, second, held, period) {
  const dx = wrapPosition(second.x - first.x, period, -period / 2);
  const dy = second.y - first.y;
  const contact = first.radius + second.radius;
  const distance = Math.hypot(dx, dy);
  if (distance >= contact) return;

  const nx = distance ? dx / distance : 1;
  const ny = distance ? dy / distance : 0;
  const firstWeight = first === held ? 0 : 1;
  const secondWeight = second === held ? 0 : 1;
  const combinedWeight = firstWeight + secondWeight;
  const correction = (contact - distance) / combinedWeight;
  first.x -= nx * correction * firstWeight;
  first.y -= ny * correction * firstWeight;
  second.x += nx * correction * secondWeight;
  second.y += ny * correction * secondWeight;

  const closingSpeed = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
  if (closingSpeed >= 0) return;
  const impulse = -closingSpeed * 1.38 / combinedWeight;
  first.vx = clamp(first.vx - nx * impulse * firstWeight, -MAX_SPEED, MAX_SPEED);
  first.vy = clamp(first.vy - ny * impulse * firstWeight, -MAX_SPEED, MAX_SPEED);
  second.vx = clamp(second.vx + nx * impulse * secondWeight, -MAX_SPEED, MAX_SPEED);
  second.vy = clamp(second.vy + ny * impulse * secondWeight, -MAX_SPEED, MAX_SPEED);
}

export function bounceFromFieldEdge(body, height) {
  // Leave room for the tiles' entrance offset at the bottom and the nav blur at the top.
  const bottom = height - body.halfHeight - FLOOR_GAP;
  if (body.y >= bottom) {
    body.y = bottom;
    if (body.vy > 0) body.vy *= -0.6;
  } else if (body.y <= 0) {
    body.y = 0;
    if (body.vy < 0) body.vy *= -0.6;
  }
}

export function bounceFromCopy(body, boundary) {
  if (!boundary) return;
  const left = body.x - (boundary.left - body.halfWidth);
  const right = boundary.right + body.halfWidth - body.x;
  const top = body.y - (boundary.top - body.halfHeight);
  const bottom = boundary.bottom + body.halfHeight - body.y;
  if (Math.min(left, right, top, bottom) <= 0) return;

  const dx = left < right ? -left : right;
  const dy = top < bottom ? -top : bottom;
  if (Math.abs(dx) < Math.abs(dy)) {
    body.x += dx;
    if (body.vx * dx < 0) body.vx *= -0.6;
  } else {
    body.y += dy;
    if (body.vy * dy < 0) body.vy *= -0.6;
  }
}

const distanceBetween = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function crossesCopy(from, to, box) {
  let enter = 0;
  let exit = 1;
  for (const [axis, min, max] of [["x", box.left, box.right], ["y", box.top, box.bottom]]) {
    const delta = to[axis] - from[axis];
    if (!delta) {
      if (from[axis] <= min || from[axis] >= max) return false;
      continue;
    }
    const first = (min - from[axis]) / delta;
    const last = (max - from[axis]) / delta;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
  }
  return enter < exit;
}

export function returnRoute(body, boundary, globe = null) {
  if (globe) return globeReturnRoute(body, boundary, globe);
  const start = { x: body.x, y: body.y };
  const end = body.home;
  if (!boundary) return [start, end];
  // Account for the whole tile as its center moves around the copy.
  const box = {
    left: boundary.left - body.halfWidth,
    right: boundary.right + body.halfWidth,
    top: boundary.top - body.halfHeight,
    bottom: boundary.bottom + body.halfHeight,
  };
  if (!crossesCopy(start, end, box)) return [start, end];
  const corners = [
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.left, y: box.bottom }, { x: box.right, y: box.bottom },
  ];
  let closest = [start, end];
  let length = Infinity;
  for (const first of corners) {
    if (crossesCopy(start, first, box)) continue;
    for (const last of corners) {
      if (crossesCopy(first, last, box) || crossesCopy(last, end, box)) continue;
      const distance = distanceBetween(start, first) + distanceBetween(first, last) + distanceBetween(last, end);
      if (distance < length) {
        closest = first === last ? [start, first, end] : [start, first, last, end];
        length = distance;
      }
    }
  }
  return closest;
}

function copyBounds(field, copy) {
  if (!copy) return null;
  const origin = field.getBoundingClientRect();
  const range = document.createRange();
  const rectangles = Array.from(copy.querySelectorAll("h1, p, .pf-hero-ctas > *"), (element) => {
    if (!element.matches("h1, p")) return element.getBoundingClientRect();
    range.selectNodeContents(element);
    return range.getBoundingClientRect();
  });
  if (!rectangles.length) return null;
  const space = 14;
  return {
    left: Math.min(...rectangles.map((rect) => rect.left)) - origin.left - space,
    right: Math.max(...rectangles.map((rect) => rect.right)) - origin.left + space,
    top: Math.min(...rectangles.map((rect) => rect.top)) - origin.top - space,
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)) - origin.top + space,
  };
}

export function useRadarMotion(fieldRef) {
  useEffect(() => {
    const field = fieldRef.current;
    if (!field || typeof window.PointerEvent === "undefined") return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const copy = field.parentElement.querySelector(".pf-hero-text");
    let bodies = [];
    let width = 0;
    let height = 0;
    let edge = 0;
    let period = 0;
    let boundary = null;
    let globe = null;
    let animation = 0;
    let returnTimer = 0;
    let returnFrame = 0;
    let lastFrame = 0;
    let gesture = null;
    let suppressClick = false;

    function constrain(body) {
      body.x = wrapPosition(body.x, period, -edge);
      for (let i = 0; i < 4; i++) {
        bounceFromCopy(body, boundary);
        bounceFromFieldEdge(body, height);
        bounceFromGlobe(body, globe);
      }
      // If a tile cannot fit between the copy and horizon, slide it beside the
      // copy instead of letting the two constraints push it back and forth.
      if (globe && boundary && body.x + body.halfWidth > boundary.left + 0.01 &&
          body.x - body.halfWidth < boundary.right - 0.01 &&
          body.y + body.halfHeight > boundary.top + 0.01 && body.y - body.halfHeight < boundary.bottom - 0.01) {
        const left = boundary.left - body.halfWidth;
        const right = boundary.right + body.halfWidth;
        const x = Math.abs(body.x - left) < Math.abs(body.x - right) ? left : right;
        if (body.vx * (x - body.x) < 0) body.vx *= -0.6;
        body.x = x;
        bounceFromGlobe(body, globe);
      }
    }

    function draw(body) {
      constrain(body);
      body.el.style.setProperty("--radar-x", `${body.x - body.startX}px`);
      body.el.style.setProperty("--radar-y", `${body.y - body.startY}px`);
    }

    function cancelReturn() {
      clearTimeout(returnTimer);
      cancelAnimationFrame(returnFrame);
      returnTimer = returnFrame = 0;
    }

    function queueReturn() {
      if (gesture || returnTimer || returnFrame) return;
      const moved = bodies.filter((body) => distanceBetween(body, body.home) > 0.01);
      if (!moved.length) return;
      if (reduced.matches) {
        for (const body of moved) {
          Object.assign(body, body.home);
          draw(body);
        }
        return;
      }
      returnTimer = window.setTimeout(() => {
        returnTimer = 0;
        if (field.querySelector(":focus-visible")) return;
        const paths = moved.map((body) => {
          const points = returnRoute(body, boundary, globe);
          const segments = points.slice(1).map((point, i) => distanceBetween(points[i], point));
          const length = segments.reduce((total, segment) => total + segment, 0);
          return { body, points, segments, length, duration: clamp(720 + length * 0.9, 950, 1800) };
        });
        const started = performance.now();
        function returnStep(now) {
          let moving = false;
          for (const { body, points, segments, length, duration } of paths) {
            const progress = reduced.matches ? 1 : clamp((now - started) / duration, 0, 1);
            if (progress === 1) {
              Object.assign(body, points.at(-1));
            } else {
              moving = true;
              let remaining = length * (0.5 - 0.5 * Math.cos(Math.PI * progress));
              let i = 0;
              while (i + 1 < segments.length && remaining >= segments[i]) remaining -= segments[i++];
              const from = points[i];
              const to = points[i + 1];
              const t = segments[i] ? remaining / segments[i] : 0;
              body.x = from.x + (to.x - from.x) * t;
              body.y = from.y + (to.y - from.y) * t;
            }
            draw(body);
          }
          returnFrame = moving ? requestAnimationFrame(returnStep) : 0;
        }
        returnFrame = requestAnimationFrame(returnStep);
      }, RETURN_DELAY);
    }

    function collisions(held) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) bumpCards(bodies[i], bodies[j], held, period);
      }
      for (const body of bodies) constrain(body);
    }

    function tick(now) {
      animation = 0;
      const elapsed = lastFrame ? Math.min((now - lastFrame) / FRAME_MS, 2) : 1;
      lastFrame = now;
      const held = gesture?.body;
      if (gesture?.dragging && !held) return;
      const friction = 0.95 ** elapsed;
      for (const body of bodies) {
        if (body === held || Math.hypot(body.vx, body.vy) < 0.22) continue;
        body.x += body.vx * elapsed;
        body.y += body.vy * elapsed;
        body.vx *= friction;
        body.vy *= friction;
      }
      collisions(held);
      for (const body of bodies) draw(body);
      if (bodies.some((body) => body !== held && Math.hypot(body.vx, body.vy) >= 0.22)) {
        animation = requestAnimationFrame(tick);
      } else {
        lastFrame = 0;
        queueReturn();
      }
    }

    function clearGesture() {
      const id = gesture?.id;
      gesture?.body?.el.classList.remove("is-grabbed");
      field.classList.remove("is-dragging");
      gesture = null;
      if (id != null && field.hasPointerCapture(id)) field.releasePointerCapture(id);
    }

    function placeCards() {
      cancelReturn();
      cancelAnimationFrame(animation);
      animation = 0;
      lastFrame = 0;
      clearGesture();
      for (const { el } of bodies) {
        el.style.removeProperty("--radar-x");
        el.style.removeProperty("--radar-y");
      }
      width = field.clientWidth;
      height = field.clientHeight;
      const tiles = width && height ? [...field.querySelectorAll(".pf-hero-tile")].filter((tile) => tile.offsetWidth > 0) : [];
      bodies = tiles.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          startX: el.offsetLeft,
          startY: el.offsetTop,
          x: el.offsetLeft,
          y: el.offsetTop,
          vx: 0,
          vy: 0,
          radius: Math.min(el.offsetWidth, el.offsetHeight) * 0.45,
          halfWidth: rect.width / 2,
          halfHeight: rect.height / 2,
        };
      });
      edge = Math.ceil(Math.max(0, ...bodies.map(({ el }) => Math.hypot(el.offsetWidth, el.offsetHeight))) / 2);
      period = width + edge * 2;
      boundary = bodies.length ? copyBounds(field, copy) : null;
      globe = field.parentElement.querySelector(".pf-hero-earth") ? heroGlobeBoundary(width, height) : null;
      for (const body of bodies) {
        draw(body);
        body.home = { x: body.x, y: body.y };
      }
    }

    function down(event) {
      if (gesture || !event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      if (!bodies.length || event.target.closest("button")) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const tile = event.target.closest(".pf-hero-tile");
      const body = bodies.find(({ el }) => el === tile);
      // Empty sky remains a scroll surface on phones; only cards capture touch.
      if (event.pointerType === "touch" && !body) return;
      cancelReturn();
      if (body) body.vx = body.vy = 0;
      boundary = copyBounds(field, copy);
      gesture = {
        id: event.pointerId,
        body,
        touch: event.pointerType === "touch",
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        dragging: false,
      };
    }

    function move(event) {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (gesture.touch && Math.abs(dy) >= Math.abs(dx)) {
          clearGesture();
          queueReturn();
          return;
        }
        gesture.dragging = true;
        field.setPointerCapture(event.pointerId);
        field.classList.add("is-dragging");
        gesture.body?.el.classList.add("is-grabbed");
        for (const body of bodies) body.vx = body.vy = 0;
      }
      const time = Math.max((event.timeStamp - gesture.time) / FRAME_MS, 0.4);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.time = event.timeStamp;
      const held = gesture.body;
      const moving = held ? [held] : bodies;
      for (const body of moving) {
        body.vx = clamp(dx / time, -MAX_SPEED, MAX_SPEED);
        body.vy = clamp(dy / time, -MAX_SPEED, MAX_SPEED);
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 25));
      for (let step = 0; step < steps; step++) {
        for (const body of moving) {
          body.x += dx / steps;
          body.y += dy / steps;
        }
        collisions(held);
      }
      for (const body of bodies) draw(body);
      if (held && !reduced.matches && !animation) animation = requestAnimationFrame(tick);
    }

    function up(event) {
      if (!gesture || gesture.id !== event.pointerId) return;
      if (gesture.dragging) {
        suppressClick = event.type === "pointerup";
        const canCoast = event.type === "pointerup" && !reduced.matches && event.timeStamp - gesture.time < 100;
        const moved = gesture.body ? [gesture.body] : bodies;
        if (!canCoast) {
          for (const body of reduced.matches ? bodies : moved) body.vx = body.vy = 0;
        }
        if (!reduced.matches && !animation) animation = requestAnimationFrame(tick);
      }
      clearGesture();
      if (!animation) queueReturn();
    }

    function lostCapture(event) {
      // Touch starts with implicit capture on the card. Moving it to the field
      // releases the card's capture before the field takes over.
      if (event.target === field) up(event);
    }

    function click(event) {
      if (!suppressClick || !event.detail) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    function onFocus(event) {
      if (gesture) return;
      const body = bodies.find(({ el }) => el.contains(event.target));
      if (!body) return;
      cancelReturn();
      const halfWidth = body.el.offsetWidth / 2;
      const halfHeight = body.el.offsetHeight / 2;
      body.x = clamp(body.x, halfWidth + 16, width - halfWidth - 16);
      body.y = clamp(body.y, halfHeight + 8, height - halfHeight - 8);
      body.vx = body.vy = 0;
      draw(body);
    }

    function onBlur(event) {
      if (!field.contains(event.relatedTarget) && !animation) queueReturn();
    }

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(placeCards) : null;
    observer?.observe(field);
    if (copy) observer?.observe(copy);
    if (!observer) window.addEventListener("resize", placeCards);
    field.addEventListener("pointerdown", down);
    field.addEventListener("lostpointercapture", lostCapture);
    field.addEventListener("click", click, true);
    field.addEventListener("focusin", onFocus);
    field.addEventListener("focusout", onBlur);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    placeCards();
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", placeCards);
      cancelAnimationFrame(animation);
      cancelReturn();
      clearGesture();
      field.removeEventListener("pointerdown", down);
      field.removeEventListener("lostpointercapture", lostCapture);
      field.removeEventListener("click", click, true);
      field.removeEventListener("focusin", onFocus);
      field.removeEventListener("focusout", onBlur);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [fieldRef]);
}
