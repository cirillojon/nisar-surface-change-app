import { describe, expect, it } from "vitest";

import { declutter, labelBox, labelFont, placeList, zoomAtDistance } from "../services/globeLabels.js";

describe("the globe's place names", () => {
  it("names a place once it is near enough for its zoom", () => {
    const fov = Math.PI / 3;
    // From the whole-Earth view only the first zoom levels show; a few km off, street level.
    expect(zoomAtDistance(2.2e7, 1000, fov)).toBeLessThan(3);
    expect(zoomAtDistance(5e3, 1000, fov)).toBeGreaterThan(12);
    expect(zoomAtDistance(1e6, 1000, fov)).toBeGreaterThan(zoomAtDistance(2e6, 1000, fov));
  });

  it("lets oceans and countries claim space before towns", () => {
    const list = placeList([
      ["Maun", 23.4, -20, 7, "city"],
      ["Botswana", 24, -22, 3, "country"],
      ["Gaborone", 25.9, -24.6, 5, "capital"],
      ["Indian Ocean", 80, -30, 1, "ocean"],
    ]);
    expect(list.map((p) => p.name)).toEqual(["Indian Ocean", "Botswana", "Gaborone", "Maun"]);
    expect(list[3]).toMatchObject({ id: 0, lon: 23.4, lat: -20, minZoom: 7, kind: "city" });
  });

  it("drops names that would overlap one already shown", () => {
    const [country, town, far] = placeList([
      ["Botswana", 24, -22, 3, "country"],
      ["Maun", 23.4, -20, 7, "city"],
      ["Gaborone", 25.9, -24.6, 5, "city"],
    ]).sort((a, b) => a.id - b.id);
    const shown = declutter([
      { place: country, x: 100, y: 100 },
      { place: town, x: 90, y: 102 },
      { place: far, x: 300, y: 300 },
    ]);
    expect([...shown]).toEqual([country.id, far.id]);
    expect(declutter([{ place: country, x: 0, y: 0 }, { place: far, x: 500, y: 500 }], 1).size).toBe(1);
  });

  it("puts a town's name right of its dot, and centers a country's", () => {
    const town = { name: "Maun", kind: "city" };
    const country = { name: "Botswana", kind: "country" };
    expect(labelBox(town, 100, 50).left).toBeLessThan(100);
    expect(labelBox(town, 100, 50).right).toBeGreaterThan(110);
    const box = labelBox(country, 100, 50);
    expect((box.left + box.right) / 2).toBeCloseTo(100);
    expect(labelFont("ocean")).toMatch(/^italic /);
  });
});
