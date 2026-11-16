import { describe, expect, it } from "vitest";

import { MAX_LINE_KM, addPoint, canFinish, lineKm } from "../services/drawing.js";

// [lat, lng], near Kīlauea.
const A = [19.4, -155.3];
const B = [19.45, -155.25];

describe("drawing a line", () => {
  it("ends a double-clicked line where it is, without a repeated point", () => {
    // A double-click reaches the map as two clicks on one spot, then "dblclick".
    let line = addPoint([], A);
    line = addPoint(line, B, 180);
    const drawn = line;
    line = addPoint(line, [19.45001, -155.25001], 1);
    expect(line).toBe(drawn);
    expect(line).toEqual([A, B]);
    expect(canFinish(line)).toBe(true);
    // A click somewhere else carries the line on.
    expect(addPoint(line, A, 180)).toEqual([A, B, A]);
  });

  it("can't be finished with fewer than two points", () => {
    expect(canFinish([])).toBe(false);
    expect(canFinish([A])).toBe(false);
    // Double-clicking the first point still leaves one point: drawing carries on.
    expect(canFinish(addPoint([A], A, 0))).toBe(false);
  });

  it("can't be finished while it is longer than a height profile may be", () => {
    const degree = [A, [A[0] + 1, A[1]]]; // one degree of latitude
    expect(lineKm(degree)).toBeCloseTo(111.2, 1);
    expect(lineKm(degree)).toBeGreaterThan(MAX_LINE_KM);
    expect(canFinish(degree)).toBe(false);
    // Undoing the far point and stopping short makes it finishable again.
    expect(canFinish([A, [A[0] + 0.5, A[1]]])).toBe(true);
    // Length adds up along every segment, not end to end.
    expect(lineKm([A, B, A])).toBeCloseTo(2 * lineKm([A, B]), 6);
  });
});
