import { describe, expect, it } from "vitest";
import { bounceFromGlobe, crossesBox, crossesGlobe } from "../platform/earth/globe-obstacle.js";
import { heroGlobeBoundary, heroGlobeLayout } from "../platform/earth/hero-globe-layout.js";
import { returnRoute } from "../platform/useRadarMotion.js";

const globe = { x: 500, y: 900, radius: 400 };
const card = (overrides = {}) => ({ x: 500, y: 470, halfWidth: 35, halfHeight: 30, vx: 0, vy: 0, ...overrides });
const clearance = (body, circle) => {
  const x = Math.max(body.x - body.halfWidth, Math.min(body.x + body.halfWidth, circle.x));
  const y = Math.max(body.y - body.halfHeight, Math.min(body.y + body.halfHeight, circle.y));
  return Math.hypot(x - circle.x, y - circle.y) - circle.radius;
};

describe("hero globe collision", () => {
  it("bounces a downward throw off the actual horizon and keeps its sideways velocity", () => {
    const body = card({ y: 520, vx: 8, vy: 10 });
    bounceFromGlobe(body, globe);
    expect(body.y).toBe(470);
    expect(body.vx).toBe(8);
    expect(body.vy).toBeCloseTo(-6);
  });

  it("clears the corners of rotated cards along the curved sides", () => {
    const body = card({ x: 235, y: 610, halfWidth: 90, halfHeight: 85, vx: 6, vy: 10 });
    bounceFromGlobe(body, globe);
    expect(clearance(body, globe)).toBeGreaterThanOrEqual(-0.001);
    expect(body.x).toBeLessThan(235);
    expect(body.y).toBeLessThan(610);
    const before = { ...body };
    bounceFromGlobe(body, globe);
    expect(body.x).toBeCloseTo(before.x);
    expect(body.vy).toBeCloseTo(before.vy);
  });

  it("does not reverse a card that is already moving away from Earth", () => {
    const body = card({ y: 480, vx: 2, vy: -8 });
    bounceFromGlobe(body, globe);
    expect(body.vy).toBe(-8);
  });

  it("keeps a fast dragged tile outside Earth through every drag substep", () => {
    const body = card({ x: 240, y: 330, vx: 16, vy: 24 });
    for (let i = 0; i < 60; i++) {
      body.x += 8;
      body.y += 22;
      bounceFromGlobe(body, globe);
      expect(clearance(body, globe)).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it("routes returning cards over the curved horizon instead of through the globe", () => {
    const body = card({ x: 100, y: 690, home: { x: 900, y: 690 } });
    expect(crossesGlobe(body, body.home, body, globe)).toBe(true);
    const path = returnRoute(body, null, globe);
    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)).toEqual(body.home);
    for (let i = 1; i < path.length; i++) expect(crossesGlobe(path[i - 1], path[i], body, globe)).toBe(false);
  });

  it("routes around both the text and globe when their boundaries meet", () => {
    const copy = { left: 300, right: 700, top: 200, bottom: 485 };
    const body = card({ x: 110, y: 660, home: { x: 890, y: 660 } });
    const path = returnRoute(body, copy, globe);
    expect(path.at(-1)).toEqual(body.home);
    const expanded = { left: 265, right: 735, top: 170, bottom: 515 };
    for (let i = 1; i < path.length; i++) {
      expect(crossesGlobe(path[i - 1], path[i], body, globe)).toBe(false);
      expect(crossesBox(path[i - 1], path[i], expanded)).toBe(false);
    }
    expect(Math.min(...path.map((point) => point.y))).toBeLessThanOrEqual(170);
  });

  it("keeps an unobstructed return straight", () => {
    const body = card({ x: 200, y: 250, home: { x: 800, y: 250 } });
    expect(returnRoute(body, null, globe)).toEqual([{ x: 200, y: 250 }, body.home]);
  });

  it.each([[1920, 1000], [1024, 900], [768, 900], [390, 830]])("matches the rendered circle at %i × %i", (width, height) => {
    const layout = heroGlobeLayout(width, height);
    const boundary = heroGlobeBoundary(width, height);
    expect(boundary.x).toBe(layout.x);
    expect(boundary.y).toBe(layout.y);
    expect(boundary.radius).toBeCloseTo(layout.radius * 1.009 + 18);
    expect(layout.y - layout.radius).toBeGreaterThan(height / 2);
    expect(layout.y).toBeGreaterThan(height); // The lower hemisphere stays below the hero.
  });
});
