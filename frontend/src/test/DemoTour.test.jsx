import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DemoTour from "../components/tour/DemoTour.jsx";
import { DEMO_STEPS, LANGTANG_PAIR } from "../components/tour/demoSteps.js";
import { isTyping, keyBelongsToFocus } from "../services/keys.js";

const actions = () => ({
  showWorld: vi.fn(),
  showKilauea: vi.fn(),
  leaveKilauea: vi.fn(),
  closeSave: vi.fn(),
  draw: vi.fn(),
  setScene: vi.fn(),
  openStory: vi.fn(),
  setGuide: vi.fn(),
  focusLandDate: vi.fn(),
});
const at = (id) => DEMO_STEPS.findIndex((s) => s.id === id);
const idle = { drawing: null, aoiDrawn: false, profileLine: false };
const stepShown = () => screen.getByTestId("demo").getAttribute("data-step");
const press = (key) => act(() => fireEvent.keyDown(window, { key }));

describe("demo mode's script", () => {
  it("follows the pitch: the problem, Kīlauea, Sylhet, Langtang, what to remember", () => {
    expect(DEMO_STEPS.map((s) => s.id)).toEqual([
      "problem", "examples",
      "kilauea-box", "kilauea-play", "kilauea-line", "kilauea-profile",
      "sylhet", "sylhet-charts",
      "langtang", "langtang-change",
      "close",
    ]);
  });

  it("keeps the cards short: a few large lines", () => {
    for (const step of DEMO_STEPS.filter((s) => s.card)) {
      expect(step.card.lines.length, step.id).toBeLessThanOrEqual(2);
      for (const line of step.card.lines) expect(line.text.length, step.id).toBeLessThanOrEqual(120);
    }
  });

  it("can always be moved on: a drawing step Space can't finish has a way to draw for the presenter", () => {
    for (const step of DEMO_STEPS.filter((s) => s.done)) expect(step.skip, step.id).toBeTypeOf("function");
  });
});

describe("DemoTour", () => {
  it("moves on with Space and back with Backspace, and says which panels to show", () => {
    const onView = vi.fn();
    render(<DemoTour state={idle} actions={actions()} onEnd={() => {}} onView={onView} />);
    expect(stepShown()).toBe("problem");
    expect(screen.getByText("We built Google Maps for NISAR.")).toBeInTheDocument();
    press(" ");
    expect(stepShown()).toBe("examples");
    press("Backspace");
    expect(stepShown()).toBe("problem");
    expect(onView).toHaveBeenLastCalledWith({ panel: false, chain: false });
  });

  it("starts the drawing on a drawing step, and Space draws the suggested box if the presenter hasn't", () => {
    const a = actions();
    const { rerender } = render(
      <DemoTour state={idle} actions={a} onEnd={() => {}} onView={() => {}} startAt={at("kilauea-box")} />,
    );
    expect(a.draw).toHaveBeenCalledWith("area");
    press(" ");
    expect(a.setScene).toHaveBeenLastCalledWith("area");
    expect(stepShown()).toBe("kilauea-box");
    // The box is drawn: the step moves on by itself.
    rerender(<DemoTour state={{ ...idle, aoiDrawn: true }} actions={a} onEnd={() => {}} onView={() => {}} startAt={at("kilauea-box")} />);
    expect(stepShown()).toBe("kilauea-play");
  });

  it("shows the left panel for the profile and the right one for Sylhet's charts", () => {
    const onView = vi.fn();
    render(<DemoTour state={idle} actions={actions()} onEnd={() => {}} onView={onView} startAt={at("kilauea-profile")} />);
    expect(onView).toHaveBeenLastCalledWith({ panel: true, chain: false });
    press(" ");
    expect(onView).toHaveBeenLastCalledWith({ panel: false, chain: false });
    press(" ");
    expect(onView).toHaveBeenLastCalledWith({ panel: false, chain: true });
  });

  it("switches between Langtang's two passes with the arrow keys", () => {
    const a = actions();
    render(<DemoTour state={idle} actions={a} onEnd={() => {}} onView={() => {}} startAt={at("langtang")} />);
    expect(a.setGuide).toHaveBeenCalledWith(LANGTANG_PAIR);
    press("ArrowRight");
    expect(a.focusLandDate).toHaveBeenLastCalledWith(LANGTANG_PAIR[1]);
    press("ArrowLeft");
    expect(a.focusLandDate).toHaveBeenLastCalledWith(LANGTANG_PAIR[0]);
    expect(stepShown()).toBe("langtang");
  });

  it("goes back to the workspace with Backspace from the first step", () => {
    const onEnd = vi.fn();
    render(<DemoTour state={idle} actions={actions()} onEnd={onEnd} onView={() => {}} />);
    press("Backspace");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("goes back a step with Backspace even mid-drawing", () => {
    render(
      <DemoTour state={{ ...idle, drawing: "line" }} actions={actions()} onEnd={() => {}} onView={() => {}} startAt={at("kilauea-line")} />,
    );
    press("Backspace");
    expect(stepShown()).toBe("kilauea-play");
  });

  it("tells a screen reader what the screen no longer shows, and the keys", () => {
    render(<DemoTour state={idle} actions={actions()} onEnd={() => {}} onView={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Backspace, back/);
    expect(screen.getByRole("dialog")).toHaveFocus();
    for (const step of DEMO_STEPS.filter((s) => !s.card)) expect(step.sr, step.id).toBeTruthy();
  });

  it("leaves Space to a control reached with the keyboard, and every key to a text field", () => {
    render(
      <>
        <button type="button">Play</button>
        <input aria-label="Notes" />
        <DemoTour state={idle} actions={actions()} onEnd={() => {}} onView={() => {}} startAt={at("kilauea-play")} />
      </>,
    );
    screen.getByRole("button", { name: "Play" }).focus();
    press(" ");
    expect(stepShown()).toBe("kilauea-play");
    screen.getByRole("textbox", { name: "Notes" }).focus();
    press("Backspace");
    expect(stepShown()).toBe("kilauea-play");
    act(() => document.activeElement.blur());
    press(" ");
    expect(stepShown()).toBe("kilauea-line");
  });

  it("ends on Escape, and with Space on the last card", () => {
    const onEnd = vi.fn();
    render(<DemoTour state={idle} actions={actions()} onEnd={onEnd} onView={() => {}} startAt={DEMO_STEPS.length - 1} />);
    press(" ");
    expect(onEnd).toHaveBeenCalledTimes(1);
    press("Escape");
    expect(onEnd).toHaveBeenCalledTimes(2);
  });
});

describe("keyboard shortcuts and the focused control", () => {
  it("treats text fields as typing, but not sliders or buttons", () => {
    const make = (html) => {
      const box = document.createElement("div");
      box.innerHTML = html;
      return box.firstElementChild;
    };
    expect(isTyping(make("<input>"))).toBe(true);
    expect(isTyping(make("<textarea></textarea>"))).toBe(true);
    expect(isTyping(make('<input type="range">'))).toBe(false);
    expect(isTyping(make("<button></button>"))).toBe(false);
  });

  it("never takes Escape or Backspace from a focused button", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(keyBelongsToFocus({ key: "Backspace" })).toBe(false);
    expect(keyBelongsToFocus({ key: "Escape" })).toBe(false);
    button.remove();
  });
});
