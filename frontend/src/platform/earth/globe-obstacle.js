const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** Use the rotated tile's bounding box, so its corners also clear the horizon. */
export function bounceFromGlobe(body, globe) {
  if (!globe) return;
  const dx = clamp(globe.x, body.x - body.halfWidth, body.x + body.halfWidth) - globe.x;
  const dy = clamp(globe.y, body.y - body.halfHeight, body.y + body.halfHeight) - globe.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= globe.radius) return;
  const nx = distance ? dx / distance : 0;
  const ny = distance ? dy / distance : -1;
  const depth = distance ? globe.radius - distance : globe.radius + body.halfHeight + body.y - globe.y;
  body.x += nx * depth;
  body.y += ny * depth;
  const speed = body.vx * nx + body.vy * ny;
  if (speed < 0) {
    // Preserve motion along the curve, reflect only the inward component.
    body.vx -= 1.6 * speed * nx;
    body.vy -= 1.6 * speed * ny;
  }
}

export function crossesBox(from, to, box) {
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

function crossesCircle(from, to, circle) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? clamp(((circle.x - from.x) * dx + (circle.y - from.y) * dy) / lengthSquared, 0, 1) : 0;
  return Math.hypot(from.x + dx * t - circle.x, from.y + dy * t - circle.y) < circle.radius - 0.01;
}

/** Swept rectangle vs. circle: its center must avoid this rounded rectangle. */
export function crossesGlobe(from, to, body, globe) {
  const { x, y, radius: r } = globe;
  const { halfWidth: w, halfHeight: h } = body;
  if (crossesBox(from, to, { left: x - w, right: x + w, top: y - h - r, bottom: y + h + r }) ||
      crossesBox(from, to, { left: x - w - r, right: x + w + r, top: y - h, bottom: y + h })) return true;
  return [-w, w].some((dx) => [-h, h].some((dy) => crossesCircle(from, to, { x: x + dx, y: y + dy, radius: r })));
}

/** Shortest clear path home, including when the text and globe block different sides. */
export function globeReturnRoute(body, boundary, globe) {
  const start = { x: body.x, y: body.y };
  const end = body.home;
  const box = boundary && {
    left: boundary.left - body.halfWidth, right: boundary.right + body.halfWidth,
    top: boundary.top - body.halfHeight, bottom: boundary.bottom + body.halfHeight,
  };
  const clear = (a, b) => !(box && crossesBox(a, b, box)) && !crossesGlobe(a, b, body, globe);
  if (clear(start, end)) return [start, end];
  const nodes = [start, end];
  if (box) nodes.push(
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.left, y: box.bottom }, { x: box.right, y: box.bottom },
  );
  // Circumscribed arcs: adjacent chords never cut inside the collision surface.
  const steps = 12;
  const step = Math.PI / (2 * steps);
  const radius = (globe.radius + 1) / Math.cos(step / 2);
  for (const side of [-1, 1]) {
    for (let i = 0; i <= steps; i++) {
      const angle = (side === -1 ? -Math.PI : -Math.PI / 2) + i * step;
      nodes.push({
        x: globe.x + side * body.halfWidth + Math.cos(angle) * radius,
        y: globe.y - body.halfHeight + Math.sin(angle) * radius,
      });
    }
  }
  const distances = nodes.map(() => Infinity);
  const previous = nodes.map(() => -1);
  const visited = new Set();
  distances[0] = 0;
  while (visited.size < nodes.length) {
    let next = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited.has(i) && (next === -1 || distances[i] < distances[next])) next = i;
    }
    if (next === -1 || !Number.isFinite(distances[next])) break;
    if (next === 1) {
      const path = [];
      for (let i = 1; i !== -1; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(next);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i) || !clear(nodes[next], nodes[i])) continue;
      const distance = distances[next] + Math.hypot(nodes[i].x - nodes[next].x, nodes[i].y - nodes[next].y);
      if (distance < distances[i]) { distances[i] = distance; previous[i] = next; }
    }
  }
  // A fully blocked home cannot be reached safely. Stay put until layout resets.
  return [start, start];
}
