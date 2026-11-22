import { describe, expect, it } from "vitest";

import { AOI_HALF_DEG, PLACE_MAX_SPAN_DEG, aoiAround, areaForPlace, footprintOverlay, profileLayers } from "../workspace/mapLayers.js";

describe("aoiAround", () => {
  it("draws a box of ±AOI_HALF_DEG around the click, rounded to 0.001°", () => {
    expect(AOI_HALF_DEG).toBe(0.25);
    expect(aoiAround(19.4123, -155.2876)).toEqual({
      latitude: 19.4123,
      longitude: -155.2876,
      bbox: [-155.538, 19.162, -155.038, 19.662],
    });
  });

  it("wraps longitudes from Leaflet's world copies back into ±180", () => {
    expect(aoiAround(0, 190).longitude).toBeCloseTo(-170);
    expect(aoiAround(0, -540).longitude).toBeCloseTo(180 - 360);
  });

  it("keeps the box inside the world at the poles and the antimeridian", () => {
    const north = aoiAround(95, 179.9);
    expect(north.latitude).toBe(89.5);
    expect(north.bbox[3]).toBe(89.75);
    expect(north.bbox[2]).toBe(180);
    const south = aoiAround(-90, -179.9);
    expect(south.latitude).toBe(-89.5);
    expect(south.bbox[0]).toBe(-180);
    expect(south.bbox[1]).toBe(-89.75);
  });
});

describe("profileLayers", () => {
  it("is empty without a line", () => {
    expect(profileLayers(null)).toEqual({ bbox: null, layers: null });
  });

  it("pads the line's bounds and marks its A and B ends", () => {
    const line = [[-155.3, 19.4], [-155.1, 19.3], [-155.2, 19.5]];
    const { bbox, layers } = profileLayers(line);
    expect(bbox[0]).toBeCloseTo(-155.35);
    expect(bbox[1]).toBeCloseTo(19.25);
    expect(bbox[2]).toBeCloseTo(-155.05);
    expect(bbox[3]).toBeCloseTo(19.55);
    // Leaflet takes [lat, lon].
    expect(layers.lines[0].positions).toEqual([[19.4, -155.3], [19.3, -155.1], [19.5, -155.2]]);
    expect(layers.points.map((p) => [p.key, p.lat, p.lon])).toEqual([
      ["A", 19.4, -155.3],
      ["B", 19.5, -155.2],
    ]);
  });
});

describe("footprintOverlay", () => {
  const site = {
    bbox: [1, 2, 3, 4],
    story_metric: "water_pct",
    footprint: { image_url: "/fp.webp", pct_of_box: 88 },
  };
  const toUrl = (path) => `https://cdn${path}`;

  it("hatches the unimaged part of an open-water site", () => {
    expect(footprintOverlay({ site, siteLayer: "color", hidden: false, toUrl })).toEqual({
      url: "https://cdn/fp.webp",
      bbox: [1, 2, 3, 4],
      label: "Left out of open-water values: not imaged by every pass. Values are compared over the other 88% of the box.",
    });
  });

  it("shows on another site while its water layer is on", () => {
    const other = { ...site, story_metric: "hh_db" };
    expect(footprintOverlay({ site: other, siteLayer: "hh", hidden: false, toUrl })).toBeNull();
    expect(footprintOverlay({ site: other, siteLayer: "water", hidden: false, toUrl })).not.toBeNull();
  });

  it("is absent when hidden, without a site, or without a footprint image", () => {
    expect(footprintOverlay({ site, siteLayer: "color", hidden: true, toUrl })).toBeNull();
    expect(footprintOverlay({ site: null, siteLayer: "color", hidden: false, toUrl })).toBeNull();
    expect(footprintOverlay({ site: { ...site, footprint: {} }, siteLayer: "color", hidden: false, toUrl })).toBeNull();
  });
});

describe("areaForPlace", () => {
  it("keeps a place's own box when it fits one search", () => {
    const area = areaForPlace({ name: "Lake Chad", latitude: 13.2, longitude: 14.1, bbox: [13, 12.3, 15.2, 14.4] });
    expect(area).toEqual({ latitude: 13.2, longitude: 14.1, bbox: [13, 12.3, 15.2, 14.4], label: "Lake Chad", clipped: false });
  });

  it("widens a point or a small town to the box around a map click", () => {
    const area = areaForPlace({ name: "Hilo", latitude: 19.7, longitude: -155.08, bbox: [-155.1, 19.69, -155.06, 19.71] });
    expect(area.bbox[2] - area.bbox[0]).toBeCloseTo(2 * AOI_HALF_DEG);
    expect(area.bbox[3] - area.bbox[1]).toBeCloseTo(2 * AOI_HALF_DEG);
    expect(area.clipped).toBe(false);
  });

  it("opens the middle of a country, centered on its point", () => {
    const area = areaForPlace({ name: "Bangladesh", latitude: 24, longitude: 90.3, bbox: [88, 20.6, 92.7, 26.6] });
    expect(area.clipped).toBe(true);
    expect(area.bbox).toEqual([90.3 - PLACE_MAX_SPAN_DEG / 2, 24 - PLACE_MAX_SPAN_DEG / 2, 90.3 + PLACE_MAX_SPAN_DEG / 2, 24 + PLACE_MAX_SPAN_DEG / 2]);
  });

  it("treats a box across the antimeridian as too wide, and stays on the map", () => {
    const area = areaForPlace({ name: "Fiji", latitude: -17.7, longitude: 178.9, bbox: [174.6, -21, -178.2, -12.4] });
    expect(area.clipped).toBe(true);
    expect(area.bbox[2]).toBe(180);
    expect(area.bbox[0]).toBeCloseTo(177.4);
  });
});
