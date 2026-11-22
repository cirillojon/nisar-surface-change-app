import { fireEvent, render, screen } from "./render.jsx";
import { describe, expect, it, vi } from "vitest";

import LayerSelect from "../components/LayerSelect.jsx";
import { HH_RANGE_DB, WATER_DB, imageLayerOptions, layerLegend, layerUrl, paint } from "../services/layers.js";

// One RGBA pixel: R = HH, G = HV, as in the color images (gamma 0.8).
const px = (db, hvDb) => {
  const stretch = (v, [lo, hi]) => Math.round(255 * Math.pow((v - lo) / (hi - lo), 0.8));
  return Uint8ClampedArray.from([stretch(db, HH_RANGE_DB), stretch(hvDb, [-26, -8]), 90, 255]);
};

describe("image layers", () => {
  it("draws HH and HV as gray from the color image's channels", () => {
    const pixel = px(-10, -20);
    const a = Uint8ClampedArray.from(pixel);
    paint(a, "hh", false);
    expect([a[1], a[2]]).toEqual([pixel[0], pixel[0]]);
    const b = Uint8ClampedArray.from(pixel);
    paint(b, "hv", false);
    expect([b[0], b[2]]).toEqual([pixel[1], pixel[1]]);
  });

  it("marks pixels below the open-water cut (HH under -18 dB) blue and dims the rest", () => {
    const water = px(WATER_DB - 3, -22);
    const land = px(WATER_DB + 6, -15);
    const data = Uint8ClampedArray.from([...water, ...land]);
    paint(data, "water", false);
    expect(Array.from(data.slice(0, 3))).toEqual([34, 150, 255]);
    expect(data[4]).toBe(Math.round(land[0] * 0.45));
    expect(data[4]).toBe(data[5]);
  });

  it("leaves no-data (transparent) pixels alone", () => {
    const data = Uint8ClampedArray.from([5, 5, 5, 0]);
    paint(data, "water", false);
    expect(Array.from(data)).toEqual([5, 5, 5, 0]);
  });

  it("draws an HH-only pass on the same dB stretch as a dual-pol pass in the HH layer", () => {
    // HH-only passes are stored gray on a -25..0 dB stretch; dual-pol red is -20..0 dB.
    const gray = (db) => Math.round(255 * Math.pow((db + 25) / 25, 0.8));
    for (const db of [-18, -10, -3]) {
      const dual = px(db, -20);
      const only = Uint8ClampedArray.from([gray(db), gray(db), gray(db), 255]);
      paint(only, "hh", true);
      expect(Math.abs(only[0] - dual[0])).toBeLessThanOrEqual(1);
      expect([only[1], only[2]]).toEqual([only[0], only[0]]);
    }
    // Unconverted, -10 dB would be drawn 23 levels brighter on an HH-only pass.
    expect(gray(-10) - px(-10, -20)[0]).toBeGreaterThan(20);
  });

  it("uses the color image until a layer is drawn", () => {
    expect(layerUrl("/a.webp", "color")).toBe("/a.webp");
    expect(layerUrl("/a.webp", "hh")).toBe("/a.webp");
    expect(layerLegend("water").ramp.className).toBe("ramp-water");
    expect(layerLegend("color", "Purple is smooth").text).toBe("Purple is smooth");
  });

  it("lists a layer the data can't supply as disabled, with the reason", () => {
    const options = imageLayerOptions({ hv: false });
    expect(options.find((o) => o.id === "hv")).toMatchObject({ disabled: true, reason: "no HV data" });
    expect(options.filter((o) => !o.disabled).map((o) => o.id)).toEqual(["color", "hh", "water"]);
  });
});

describe("<LayerSelect />", () => {
  const layers = imageLayerOptions({ hv: false });

  it("shows disabled layers with their reason and reports the choice", () => {
    const onChange = vi.fn();
    render(<LayerSelect layers={layers} value="color" onChange={onChange} />);
    expect(screen.getByRole("option", { name: "HV brightness (no HV data)" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Image layer" }), { target: { value: "water" } });
    expect(onChange).toHaveBeenCalledWith("water");
  });

  it("is hidden when there is nothing to choose", () => {
    const { container } = render(
      <LayerSelect layers={[{ id: "color", label: "Color" }]} value="color" onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    render(<LayerSelect layers={null} value="color" onChange={() => {}} />);
  });
});
