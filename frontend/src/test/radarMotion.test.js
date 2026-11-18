import { describe, expect, it } from "vitest";
import { bounceFromCopy, bounceFromFieldEdge, bumpCards, returnRoute, wrapPosition } from "../platform/useRadarMotion.js";

describe("hero radar motion", () => {
  it("wraps horizontally in both directions across any number of turns", () => {
    expect(wrapPosition(3050, 1000, -100)).toBe(50);
    expect(wrapPosition(-1120, 1000, -100)).toBe(880);
  });

  it("moves and nudges the card hit by the dragged card", () => {
    const dragged = { x: 100, y: 70, vx: 12, vy: 0, radius: 30 };
    const other = { x: 145, y: 70, vx: 0, vy: 0, radius: 30 };
    bumpCards(dragged, other, dragged, 800);
    expect(dragged.x).toBe(100);
    expect(other.x).toBe(160);
    expect(other.vx).toBeGreaterThan(0);
  });

  it("separates two cards meeting across the horizontal wrap", () => {
    const first = { x: 770, y: 0, vx: 7, vy: 0, radius: 18 };
    const second = { x: 0, y: 0, vx: 0, vy: 0, radius: 18 };
    bumpCards(first, second, null, 800);
    expect(wrapPosition(second.x - first.x, 800)).toBe(36);
    expect(second.vx).toBeGreaterThan(first.vx);
  });

  it("keeps cards at opposite vertical edges from colliding", () => {
    const first = { x: 40, y: 622, vx: 0, vy: 7, radius: 18 };
    const second = { x: 40, y: 0, vx: 0, vy: 0, radius: 18 };
    bumpCards(first, second, null, 800);
    expect(first.y).toBe(622);
    expect(second.vy).toBe(0);
  });

  it("holds the card above the section boundary and reflects downward velocity", () => {
    const card = { y: 660, halfHeight: 42, vx: 5, vy: 10 };
    bounceFromFieldEdge(card, 650);
    expect(card.y + card.halfHeight).toBe(636);
    expect(card.vy).toBe(-6);
    expect(card.vx).toBe(5);
    bounceFromFieldEdge(card, 650);
    expect(card.vy).toBe(-6);
  });

  it("reflects a card off the top without sending it to the bottom", () => {
    const card = { y: -10, halfHeight: 42, vy: -10 };
    bounceFromFieldEdge(card, 650);
    expect(card.y).toBe(0);
    expect(card.vy).toBe(6);
  });

  it("keeps the whole card clear of the copy and reflects its horizontal velocity", () => {
    const copy = { left: 120, right: 420, top: 100, bottom: 250 };
    const card = { x: 110, y: 160, halfWidth: 30, halfHeight: 24, vx: 10, vy: 3 };
    bounceFromCopy(card, copy);
    expect(card.x + card.halfWidth).toBe(copy.left);
    expect(card.vx).toBeLessThan(0);
    expect(card.vy).toBe(3);
  });

  it("reflects vertically where a card lands on the CTA boundary", () => {
    const copy = { left: 120, right: 420, top: 100, bottom: 250 };
    const card = { x: 280, y: 263, halfWidth: 30, halfHeight: 24, vx: 2, vy: -8 };
    bounceFromCopy(card, copy);
    expect(card.y - card.halfHeight).toBe(copy.bottom);
    expect(card.vy).toBeGreaterThan(0);
    expect(card.vx).toBe(2);
  });

  it("returns a tile around the text when the copy blocks its way home", () => {
    const copy = { left: 120, right: 420, top: 130, bottom: 250 };
    const tile = { x: 40, y: 150, halfWidth: 30, halfHeight: 24, home: { x: 500, y: 150 } };
    expect(returnRoute(tile, copy)).toEqual([
      { x: 40, y: 150 }, { x: 90, y: 106 }, { x: 450, y: 106 }, { x: 500, y: 150 },
    ]);
  });

  it("returns a tile straight home when it is already clear of the copy", () => {
    const copy = { left: 120, right: 420, top: 130, bottom: 250 };
    const tile = { x: 60, y: 180, halfWidth: 30, halfHeight: 24, home: { x: 60, y: 340 } };
    expect(returnRoute(tile, copy)).toEqual([{ x: 60, y: 180 }, tile.home]);
  });
});
