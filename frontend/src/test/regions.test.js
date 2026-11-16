import { describe, expect, it } from "vitest";

import {
  area,
  buildMosaic,
  frameKey,
  groupByDay,
  normalizeBbox,
  rectPolygon,
  toLatLngs,
} from "../services/regions.js";

const BBOX = [0, 0, 2, 2];
// CMR footprints are [[lat, lon], ...].
const ALL = [
  [-1, -1],
  [-1, 3],
  [3, 3],
  [3, -1],
];
const WEST = [
  [-1, -1],
  [-1, 1],
  [3, 1],
  [3, -1],
];
const EAST_STRIP = [
  [-1, 1.5],
  [-1, 3],
  [3, 3],
  [3, 1.5],
];
const FAR = [
  [10, 10],
  [10, 11],
  [11, 11],
];

const g = (id, start, footprint, frame = "010_A_020") => ({
  id,
  title: `NISAR_L2_PR_GCOV_001_${frame}_x`,
  start: `${start}T12:00:00Z`,
  footprint,
});

describe("normalizeBbox", () => {
  it("orders corners and wraps a box drawn on a world copy", () => {
    expect(normalizeBbox([370, 20, 365, 10])).toEqual([5, 10, 10, 20]);
    expect(normalizeBbox([-100.12345, 5, -101, 4])).toEqual([
      -101, 4, -100.123, 5,
    ]);
  });
});

describe("frameKey", () => {
  it("reads track/direction/frame from a granule name", () => {
    expect(
      frameKey("NISAR_L2_PR_GCOV_035_098_A_010_0005_NASV_M_2026"),
    ).toBe("098_A_010");
  });
});

describe("groupByDay", () => {
  it("groups overlapping granules by day, oldest first, and drops others", () => {
    const days = groupByDay(
      [
        g("b", "2026-10-13", WEST),
        g("a", "2026-10-01", ALL),
        g("b2", "2026-10-13", EAST_STRIP, "011_A_020"),
        g("far", "2026-10-20", FAR),
      ],
      BBOX,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-13"]);
    const oct13 = days[1].granules;
    // Largest share of the area first.
    expect(oct13.map((it) => it.granule.id)).toEqual(["b", "b2"]);
    expect(oct13[0].share).toBeCloseTo(0.5, 2);
    expect(oct13[1].share).toBeCloseTo(0.25, 2);
    expect(days[0].granules[0].share).toBeCloseTo(1, 3);
  });
});

describe("buildMosaic", () => {
  it("lets newer data win and older data fill the rest", () => {
    const m = buildMosaic(
      [g("old", "2026-10-01", ALL), g("new", "2026-10-13", WEST)],
      BBOX,
    );
    expect(m.coverage).toBeCloseTo(1, 3);
    // Draw order: oldest first, so newest ends on top.
    expect(m.tiles.map((t) => t.granule.id)).toEqual(["old", "new"]);
    // The old pass only supplies the east half.
    const oldShare = area(m.tiles[0].region) / area(rectPolygon(BBOX));
    expect(oldShare).toBeCloseTo(0.5, 2);
    expect(m.days.map((d) => d.date)).toEqual(["2026-10-13", "2026-10-01"]);
    expect(m.days[0].share).toBeCloseTo(0.5, 2);
    expect(m.days[0].color).not.toBe(m.days[1].color);
  });

  it("skips passes that newer ones fully hide", () => {
    const m = buildMosaic(
      [g("hidden", "2026-10-01", WEST), g("new", "2026-10-13", ALL)],
      BBOX,
    );
    expect(m.tiles.map((t) => t.granule.id)).toEqual(["new"]);
    expect(m.days).toHaveLength(1);
  });

  it("reports partial coverage", () => {
    const m = buildMosaic([g("w", "2026-10-13", WEST)], BBOX);
    expect(m.coverage).toBeCloseTo(0.5, 2);
  });

  it("merges one day's frames into one outlined region", () => {
    const m = buildMosaic(
      [
        g("w", "2026-10-13", WEST),
        g("e", "2026-10-13", EAST_STRIP, "011_A_020"),
      ],
      BBOX,
    );
    expect(m.days).toHaveLength(1);
    expect(m.days[0].count).toBe(2);
    expect(m.days[0].share).toBeCloseTo(0.75, 2);
    // Leaflet positions are [lat, lon].
    const ring = toLatLngs(m.days[0].region)[0][0];
    expect(ring.every(([lat, lon]) => lat >= 0 && lat <= 2 && lon >= 0 && lon <= 2)).toBe(true);
  });
});
