import { describe, expect, it } from "vitest";

import {
  GLOBE_IMAGERY_URL,
  GLOBE_LABELS_URL,
  boxRing,
  cameraBox,
  densify,
  focusLines,
  markersOf,
  overlayShapes,
  spanAtZoom,
} from "../services/globe.js";

describe("the globe's data", () => {
  it("spreads its imagery and place names over Esri's two tile hosts", () => {
    expect(GLOBE_IMAGERY_URL).toMatch(/^https:\/\/\{s\}\.arcgisonline\.com\/.*World_Imagery/);
    expect(GLOBE_LABELS_URL).toMatch(/^https:\/\/\{s\}\.arcgisonline\.com\/.*World_Boundaries_and_Places/);
  });

  it("makes a marker per place, coloured like the 2D map's", () => {
    const markers = markersOf({
      sites: [{ id: 2, name: "Okavango", latitude: -19.5, longitude: 22.5, change_type: "flood" }],
      places: [{ slug: "etna", name: "Etna", lat: 37.7, lon: 15 }],
      colorOf: { flood: "#22d3ee" },
    });
    expect(markers).toEqual([
      { kind: "place", ref: "etna", label: "Etna · before & after", color: "#f59e0b", size: 12, lon: 15, lat: 37.7 },
      { kind: "site", ref: 2, label: "Okavango", color: "#22d3ee", size: 14, lon: 22.5, lat: -19.5 },
    ]);
  });

  it("adds points along long edges, so lines follow the Earth's surface", () => {
    const path = densify([[0, 0], [1, 0]], 0.25);
    expect(path).toEqual([[0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0]]);
    expect(densify([[5, 5]])).toEqual([[5, 5]]);
  });

  it("outlines the selection as a closed dashed box, or nothing", () => {
    expect(focusLines(null)).toEqual([]);
    expect(focusLines([0, 0, 1, 1])).toEqual([{ coords: boxRing([0, 0, 1, 1]), color: "#facc15", dashed: true }]);
    expect(boxRing([0, 0, 1, 1])).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it("turns the 2D map's [lat, lon] outlines, lines and points into [lon, lat] shapes", () => {
    const shapes = overlayShapes({
      outlines: [{ positions: [[[[10, 1], [10, 2], [11, 2]]]], color: "#fff", dashed: true }, { positions: [], color: "#000" }],
      lines: [{ positions: [[5, 50], [6, 51]], color: "#facc15" }],
      points: [{ lat: 5, lon: 50, color: "#f00", label: "A" }],
      referencePoint: [100, 20],
    });
    expect(shapes.lines).toHaveLength(2);
    expect(shapes.lines[0]).toMatchObject({ coords: [[1, 10], [2, 10], [2, 11], [1, 10]], dashed: true });
    expect(shapes.lines[1].coords).toEqual([[50, 5], [51, 6]]);
    expect(shapes.points.map((p) => [p.lon, p.lat])).toEqual([[50, 5], [100, 20]]);
  });

  it("flies to a selection with a margin, no closer than the 2D map would, clear of the evidence card", () => {
    // A 1° box, 40% margin, nothing covering the view.
    expect(cameraBox([10, 10, 11, 11])).toEqual([9.8, 9.8, 11.2, 11.2]);
    // A tiny box is widened to what the 2D map shows at its zoom limit.
    const span = spanAtZoom(11, 800);
    const [w, , e] = cameraBox([10, 10, 10.001, 10.001], { minSpan: span });
    expect(e - w).toBeCloseTo(span);
    // A card over a third of the view: the box gets that much more room on its right.
    const [cw, , ce] = cameraBox([10, 10, 11, 11], { covered: 1 / 3 });
    expect(cw).toBeCloseTo(9.8);
    expect(ce - 11.2).toBeCloseTo(0.7);
  });
});
