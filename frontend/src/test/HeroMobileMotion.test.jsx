import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRadarMotion } from "../platform/useRadarMotion.js";
import { heroGlobeBoundary } from "../platform/earth/hero-globe-layout.js";

function PhoneField() {
  const field = useRef(null);
  useRadarMotion(field);
  function measure(element) {
    field.current = element;
    if (!element) return;
    Object.defineProperties(element, { clientWidth: { value: 390 }, clientHeight: { value: 844 } });
    element.setPointerCapture = vi.fn();
    element.hasPointerCapture = () => false;
    const tile = element.firstElementChild;
    Object.defineProperties(tile, {
      offsetWidth: { value: 78 }, offsetHeight: { value: 68 },
      offsetLeft: { value: 62 }, offsetTop: { value: 520 },
    });
    tile.getBoundingClientRect = () => ({ width: 78, height: 68 });
  }
  return <div><div ref={measure} className="pf-hero-field"><a href="/workspace" className="pf-hero-tile">Radar card</a></div>
    <div className="pf-hero-earth" /></div>;
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    constructor(type, options = {}) {
      super(type, options);
      Object.assign(this, { pointerId: 1, isPrimary: true, pointerType: "touch" });
    }
  });
  vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("reduce") }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("drags a small phone card, clears the globe, and suppresses navigation after a drag", () => {
  const { container } = render(<PhoneField />);
  const tile = container.querySelector(".pf-hero-tile");
  const field = container.querySelector(".pf-hero-field");
  fireEvent.pointerDown(tile, { clientX: 62, clientY: 520, button: 0 });
  fireEvent.pointerMove(window, { clientX: 252, clientY: 620 });
  expect(field.setPointerCapture).toHaveBeenCalledWith(1);
  fireEvent.lostPointerCapture(tile);
  expect(field).toHaveClass("is-dragging");
  const x = 62 + parseFloat(tile.style.getPropertyValue("--radar-x"));
  const y = 520 + parseFloat(tile.style.getPropertyValue("--radar-y"));
  expect(x).not.toBe(62);
  const globe = heroGlobeBoundary(390, 844);
  const nearestX = Math.max(x - 39, Math.min(globe.x, x + 39));
  const nearestY = Math.max(y - 34, Math.min(globe.y, y + 34));
  expect(Math.hypot(nearestX - globe.x, nearestY - globe.y)).toBeGreaterThanOrEqual(globe.radius - 0.01);
  fireEvent.pointerUp(window, { clientX: 252, clientY: 620 });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  expect(tile.dispatchEvent(click)).toBe(false);
});

it("leaves a touch on empty sky available for scrolling without moving cards", () => {
  const { container } = render(<PhoneField />);
  const tile = container.querySelector(".pf-hero-tile");
  const field = container.querySelector(".pf-hero-field");
  const before = tile.style.cssText;
  fireEvent.pointerDown(field, { clientX: 195, clientY: 400, button: 0 });
  fireEvent.pointerMove(window, { clientX: 195, clientY: 200 });
  fireEvent.pointerUp(window, { clientX: 195, clientY: 200 });
  expect(field.setPointerCapture).not.toHaveBeenCalled();
  expect(tile.style.cssText).toBe(before);
});

it("leaves a vertical swipe starting on a card available for scrolling", () => {
  const { container } = render(<PhoneField />);
  const tile = container.querySelector(".pf-hero-tile");
  const field = container.querySelector(".pf-hero-field");
  const before = tile.style.cssText;
  fireEvent.pointerDown(tile, { clientX: 62, clientY: 520, button: 0 });
  fireEvent.pointerMove(window, { clientX: 64, clientY: 500 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 430 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 430 });
  expect(field.setPointerCapture).not.toHaveBeenCalled();
  expect(tile.style.cssText).toBe(before);
});
