import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Tour from "../components/tour/Tour.jsx";
import { LANGTANG, PARTS, STEPS, SYLHET } from "../components/tour/steps.js";

describe("the tour's script", () => {
  it("follows the pitch's four parts, in order, with nothing outside a part", () => {
    expect(PARTS.map((p) => p.id)).toEqual(["problem", "solution", "possibility", "close"]);
    expect([...new Set(STEPS.map((s) => s.part))]).toEqual(PARTS.map((p) => p.id));
  });

  it("keeps every step short enough to read aloud: a headline, a line or two, one hint", () => {
    for (const step of STEPS) {
      expect(step.title.length, step.id).toBeLessThanOrEqual(45);
      expect(step.body.length, step.id).toBeLessThanOrEqual(160);
      expect((step.hint ?? "").length, step.id).toBeLessThanOrEqual(100);
      expect(step.enter, step.id).toBeTypeOf("function");
      expect(step.next || step.done || step.sequence, step.id).toBeTruthy();
    }
  });

  it("shows each feature once, then brings them together at Langtang, then the collection", () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      "problem", "radar",
      "draw-area", "drag-box", "play", "draw-line", "drag-line", "profile-elevation", "profile",
      "observation", "inspect", "share", "notes", "notebook",
      "langtang", "langtang-change",
      "langtang-story", "collection",
      "close",
    ]);
    expect(STEPS.at(-1).finish).toBe(true);
  });

  it("never waits on a live search: every step opens data that ships with the app", () => {
    const a = {
      showList: vi.fn(), openStory: vi.fn(), openShare: vi.fn(), openSave: vi.fn(), closeSave: vi.fn(), openNotebook: vi.fn(),
      showKilauea: vi.fn(), setGuide: vi.fn(),
    };
    STEPS.forEach((s) => s.enter(a));
    const opened = new Set(a.openStory.mock.calls.map(([slug]) => slug));
    expect(opened).toEqual(new Set([SYLHET, LANGTANG]));
    // Langtang opens on the radar image before the event, then its change map; Sylhet on the open-water layer.
    expect(a.openStory).toHaveBeenCalledWith(LANGTANG, expect.objectContaining({ layer: "colour", date: "2026-08-19" }));
    expect(a.openStory).toHaveBeenCalledWith(LANGTANG, expect.objectContaining({ layer: "change" }));
    expect(a.openStory).toHaveBeenCalledWith(SYLHET, expect.objectContaining({ layer: "water" }));
  });

  it("draws the Kīlauea pin, box and line as the drawing steps ask", () => {
    const marks = (id) => {
      const a = { showKilauea: vi.fn() };
      STEPS.find((s) => s.id === id).enter(a);
      return a.showKilauea.mock.calls[0][0]?.marks;
    };
    expect(marks("draw-area")).toEqual({ pin: true });
    expect(marks("drag-box")).toEqual({ pin: true, box: true });
    expect(marks("drag-line")).toEqual({ line: true });
    expect(marks("play")).toBeUndefined();
  });
});

describe("<Tour />", () => {
  const added = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    added.splice(0).forEach((el) => el.remove());
  });

  const actions = () => ({
    showList: vi.fn(),
    openStory: vi.fn(),
    openShare: vi.fn(),
    openSave: vi.fn(),
    closeSave: vi.fn(),
    openNotebook: vi.fn(),
    showKilauea: vi.fn(),
    leaveKilauea: vi.fn(),
    setGuide: vi.fn(),
    setScene: vi.fn(),
  });
  const idle = { saveOpen: false, savedCount: 0, drawing: null, aoiDrawn: false, profileLine: false };
  const next = () => fireEvent.click(screen.getByRole("button", { name: /Next|Start the demo/ }));
  const at = (id) => STEPS.findIndex((s) => s.id === id);
  /** An element on the page at a place of the test's choosing. */
  const onPage = (html, selector) => {
    const host = document.body.appendChild(document.createElement("div"));
    host.innerHTML = html;
    added.push(host);
    const el = host.querySelector(selector);
    return (left, top) => {
      el.getBoundingClientRect = () => ({ left, top, width: 100, height: 30, right: left + 100, bottom: top + 30 });
    };
  };

  it("opens on who has the problem, then how radar sees it, naming the NASA data", () => {
    const a = actions();
    const onEnd = vi.fn();
    render(<Tour state={idle} actions={a} onEnd={onEnd} />);
    expect(screen.getByRole("heading", { name: "A data repository, turned into Google Maps" })).toBeInTheDocument();
    expect(a.showList).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    next();
    expect(screen.getByRole("heading", { name: "NISAR sees through it" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /microwave pulses/ })).toBeInTheDocument();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/launched 30 July 2025/)).toBeInTheDocument();
    expect(dialog.getByText(/NISAR GCOV and GUNW, via NASA's ASF DAAC/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("offers one welcome, start or skip", () => {
    const onEnd = vi.fn();
    render(<Tour state={idle} actions={actions()} onEnd={onEnd} />);
    expect(screen.getByRole("button", { name: "Start the demo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip, I'll explore" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("puts each step's data on screen, and goes back to the previous step's", () => {
    const a = actions();
    render(<Tour state={idle} actions={a} onEnd={() => {}} startAt={at("observation")} />);
    expect(screen.getByRole("heading", { name: "Open water in Sylhet" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/Solution \+ proof · 10 of/)).toBeInTheDocument();
    expect(a.openStory).toHaveBeenLastCalledWith(SYLHET, { date: "2026-07-14", layer: "water" });
    // The story is still loading: say so, rather than point at nothing.
    expect(within(screen.getByRole("dialog")).getByText("Loading the Sylhet passes…")).toBeInTheDocument();
    // Every step closes what an earlier step left open.
    expect(a.closeSave).toHaveBeenCalled();
    expect(a.openShare).toHaveBeenLastCalledWith(false);
    expect(a.leaveKilauea).toHaveBeenCalled();

    // Back to the line's result: its change chart, after the elevation.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("heading", { name: "How the ground changed" })).toBeInTheDocument();
    expect(a.showKilauea).toHaveBeenLastCalledWith({ panel: true });
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("heading", { name: "The ground along your line" })).toBeInTheDocument();
    expect(a.setScene).toHaveBeenLastCalledWith("line");
  });

  it("walks Kīlauea by the presenter's drawing: a box, Play, a line, its result", () => {
    const a = actions();
    const onEnd = vi.fn();
    const { rerender } = render(<Tour state={idle} actions={a} onEnd={onEnd} startAt={at("draw-area")} />);
    const show = (state) => rerender(<Tour state={{ ...idle, ...state }} actions={a} onEnd={onEnd} />);
    expect(screen.getByRole("heading", { name: "Start at Kīlauea" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next →" })).toBeNull();
    expect(a.showKilauea).toHaveBeenLastCalledWith({ marks: { pin: true } });

    show({ drawing: "area" });
    expect(screen.getByRole("heading", { name: "Drag a box around the summit" })).toBeInTheDocument();
    // Cancelling the drawing (Escape) goes back a step; Escape doesn't end the tour.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEnd).not.toHaveBeenCalled();
    show({ drawing: null });
    expect(screen.getByRole("heading", { name: "Start at Kīlauea" })).toBeInTheDocument();

    show({ drawing: "area" });
    show({ drawing: null, aoiDrawn: true });
    expect(screen.getByRole("heading", { name: "Press Play" })).toBeInTheDocument();
    // Playing: stays for the viewer to watch, until Next.
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="map-timeline"><div class="scene-controls"><button aria-pressed="true">Pause</button></div></div>',
    );
    added.push(document.body.lastElementChild);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("heading", { name: "Press Play" })).toBeInTheDocument();
    expect(screen.getByText(/Nice! Watch a few frames/)).toBeInTheDocument();
    next();
    expect(screen.getByRole("heading", { name: "Click “Draw line”" })).toBeInTheDocument();

    show({ aoiDrawn: true, drawing: "line" });
    expect(screen.getByRole("heading", { name: "Click A, then click B" })).toBeInTheDocument();
    show({ aoiDrawn: true, profileLine: true, drawing: null, snapped: true });
    expect(screen.getByRole("heading", { name: "The ground along your line" })).toBeInTheDocument();
    expect(screen.getByText(/matched to the suggested one/)).toBeInTheDocument();
    next();
    expect(screen.getByRole("heading", { name: "How the ground changed" })).toBeInTheDocument();

    // Back skips the steps that only exist mid-drawing, and puts the map back.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(a.setScene).toHaveBeenLastCalledWith("area");
  });

  it("moves on by itself once the presenter saves, and keeps the dialog open to write notes", () => {
    const a = actions();
    const { rerender } = render(<Tour state={idle} actions={a} onEnd={() => {}} startAt={at("share")} />);
    expect(screen.getByRole("heading", { name: "Save / share" })).toBeInTheDocument();
    expect(a.openShare).toHaveBeenLastCalledWith(true);
    const closes = a.closeSave.mock.calls.length;

    // "Save to My findings…" opens the dialog: on to the notes.
    rerender(<Tour state={{ ...idle, saveOpen: true }} actions={a} onEnd={() => {}} />);
    expect(screen.getByRole("heading", { name: "Your notes" })).toBeInTheDocument();
    expect(a.closeSave).toHaveBeenCalledTimes(closes);
    expect(a.openSave).toHaveBeenCalledTimes(1);

    // Saved: on to My findings.
    rerender(<Tour state={{ saveOpen: false, savedCount: 1 }} actions={a} onEnd={() => {}} />);
    expect(screen.getByRole("heading", { name: "My findings" })).toBeInTheDocument();
    expect(a.openNotebook).toHaveBeenCalledTimes(1);
  });

  it("goes back from open notes to the share menu and lets the viewer reopen the form", () => {
    const a = actions();

    function NotesTour() {
      const [saveOpen, setSaveOpen] = useState(true);
      const [shareOpen, setShareOpen] = useState(false);
      return (
        <>
          {shareOpen && <button type="button" onClick={() => setSaveOpen(true)}>Save to My findings…</button>}
          {saveOpen && <form aria-label="Save finding" />}
          <Tour
            startAt={at("notes")}
            state={{ ...idle, saveOpen }}
            actions={{ ...a, closeSave: () => setSaveOpen(false), openShare: setShareOpen }}
            onEnd={() => {}}
          />
        </>
      );
    }

    render(<NotesTour />);
    const signal = a.openSave.mock.calls[0][0];
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Save / share" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Save finding" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save to My findings…" }));
    expect(screen.getByRole("heading", { name: "Your notes" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Save finding" })).toBeInTheDocument();
  });

  it("brings it together at Langtang, points at the possible explanations, and closes on one thing to remember", () => {
    // What those steps point at: the land player's bar and the story's hypotheses.
    onPage('<div class="map-timeline"><span class="scene-slider">bar</span></div>', "span")(200, 600);
    onPage('<div class="story-panel"><h3 id="story-why-h">Why might this be happening?</h3></div>', "h3")(20, 300);
    const a = actions();
    const onEnd = vi.fn();
    const { rerender } = render(<Tour state={{ ...idle, landDate: "2026-08-31" }} actions={a} onEnd={onEnd} startAt={at("langtang")} />);
    const show = (landDate) => rerender(<Tour state={{ ...idle, landDate }} actions={a} onEnd={onEnd} />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("heading", { name: "All together: Langtang, Nepal" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/Click the two yellow lines to see NISAR's radar image before and after/)).toBeInTheDocument();
    expect(a.openStory).toHaveBeenLastCalledWith(LANGTANG, { date: "2026-08-19", layer: "colour", panel: true });
    expect(a.setGuide).toHaveBeenLastCalledWith(["2026-08-19", "2026-08-31"]);
    // Yellow lines on the bar: the frame before, then the frame after (a date left over from earlier doesn't count).
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
    show("2026-08-19");
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
    show("2026-08-31");
    expect(screen.getByText(/The radar image before and after/)).toBeInTheDocument();
    next();
    // Then the same two frames as a change map.
    expect(screen.getByRole("heading", { name: "Now the change map" })).toBeInTheDocument();
    expect(a.openStory).toHaveBeenLastCalledWith(LANGTANG, { date: "2026-08-19", layer: "change", panel: true });
    expect(a.setGuide).toHaveBeenLastCalledWith(["2026-08-19", "2026-08-31"]);
    show("2026-08-19");
    show("2026-08-31");
    expect(screen.getByText(/A streak of change down the valley/)).toBeInTheDocument();
    next();
    const possibility = within(screen.getByRole("dialog"));
    expect(screen.getByRole("heading", { name: "Why may this have happened?" })).toBeInTheDocument();
    expect(possibility.getByText(/Possibility ·/)).toBeInTheDocument();
    expect(possibility.getByText(/what still needs testing/)).toBeInTheDocument();
    expect(a.openStory).toHaveBeenLastCalledWith(LANGTANG, { date: "2026-08-31", layer: "change", panel: true });
    next();
    expect(screen.getByRole("heading", { name: "Explore 12 NISAR stories" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByText(/Flood agencies/)).toBeNull();
    next();
    expect(screen.getByRole("heading", { name: "Remember this" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/Close ·/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(screen.getByRole("heading", { name: "A data repository, turned into Google Maps" })).toBeInTheDocument();
  });

  it("ends on the close, with Start exploring", () => {
    const onEnd = vi.fn();
    render(<Tour state={idle} actions={actions()} onEnd={onEnd} startAt={at("close")} />);
    fireEvent.click(screen.getByRole("button", { name: "Start exploring" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("follows a presentation clicker and the arrow keys, but not while typing", () => {
    const onEnd = vi.fn();
    render(<Tour state={idle} actions={actions()} onEnd={onEnd} />);
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(screen.getByRole("heading", { name: "NISAR sees through it" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Start at Kīlauea" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(screen.getByRole("heading", { name: "NISAR sees through it" })).toBeInTheDocument();

    const input = document.body.appendChild(document.createElement("textarea"));
    added.push(input);
    input.focus();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "NISAR sees through it" })).toBeInTheDocument();
    expect(onEnd).not.toHaveBeenCalled();
    input.blur();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("reveals the Sylhet card only after it has the new position", () => {
    onPage('<section data-tour="profile-change"></section>', "section")(40, 140);
    render(<Tour state={idle} actions={actions()} onEnd={() => {}} startAt={at("profile")} />);
    act(() => vi.advanceTimersByTime(100));
    const bubble = screen.getByRole("dialog");
    const place = () => `${bubble.style.left} ${bubble.style.top}`;
    const first = place();

    // The story's pop-up appears, and slides as the layout changes.
    const popup = onPage('<div class="moment-popup">Sylhet moment</div>', "div");
    popup(800, 40);
    next();
    expect(bubble).toHaveTextContent("Open water in Sylhet");
    expect(place()).toBe(first);
    // Out of sight while it waits for its target, so it never slides across the screen.
    expect(bubble.style.opacity).toBe("0");
    expect(document.querySelector(".tour-ring")).toBeNull();
    popup(300, 500);
    act(() => vi.advanceTimersByTime(100));
    expect(place()).toBe(first);

    // In the same place twice running: the bubble goes there and stays.
    act(() => vi.advanceTimersByTime(100));
    const settled = place();
    expect(settled).not.toBe(first);
    expect(bubble.style.opacity).not.toBe("0");
    expect(bubble).not.toHaveAttribute("data-placing");
    expect(document.querySelector(".tour-ring")).not.toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(place()).toBe(settled);
  });

  it("reveals a map tool covered by sticky workspace chrome and tracks it on scroll", () => {
    const tool = onPage(
      '<div class="app-body"><div class="map-header" style="position:sticky;top:55px"></div>' +
      '<button data-tour="draw-line">Draw line</button></div>',
      "button",
    );
    const header = document.querySelector(".map-header");
    header.getBoundingClientRect = () => ({
      left: 0, top: 55, right: 800, bottom: 109, width: 800, height: 54,
    });
    const drawLine = screen.getByRole("button", { name: "Draw line" });
    drawLine.scrollIntoView = vi.fn(() => tool(70, 240));
    tool(70, 60);
    render(<Tour state={idle} actions={actions()} onEnd={() => {}} startAt={at("draw-line")} />);
    expect(drawLine.scrollIntoView).toHaveBeenCalledWith({
      block: "center", inline: "nearest", behavior: "instant",
    });
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector(".tour-ring")).toHaveAttribute("y", "234");

    tool(70, 300);
    fireEvent.scroll(window);
    expect(document.querySelector(".tour-ring")).toHaveAttribute("y", "294");
    expect(drawLine.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("reveals the hypotheses heading by scrolling only the story panel", () => {
    const place = onPage(
      '<div class="sidebar-scroll" style="overflow-y:auto"><h3 id="story-why-h">Hypotheses</h3></div>',
      "h3",
    );
    const panel = document.querySelector(".sidebar-scroll");
    panel.getBoundingClientRect = () => ({ left: 12, top: 140, right: 300, bottom: 600 });
    Object.defineProperty(panel, "clientHeight", { value: 460 });
    const viewportScroll = vi.fn();
    document.querySelector("#story-why-h").scrollIntoView = viewportScroll;
    place(24, 950);
    render(<Tour state={idle} actions={actions()} onEnd={() => {}} startAt={at("langtang-story")} />);
    expect(panel.scrollTop).toBe(798);
    expect(viewportScroll).not.toHaveBeenCalled();
    place(24, 152);
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector(".tour-ring")).toHaveAttribute("y", "146");
  });

  it("moves the spotlight and the divider cutout as the workspace resizes", () => {
    let onResize;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback) { onResize = callback; }
      observe() {}
      disconnect() {}
    });
    try {
      const placeTool = onPage(
        '<div class="app-body"><aside class="sidebar"><div class="sidebar-resizer"></div></aside>' +
        '<div class="map-canvas"><button data-tour="draw-area">Draw area</button></div></div>',
        "button",
      );
      const grip = document.querySelector(".sidebar-resizer");
      const placeGrip = (left) => {
        grip.getBoundingClientRect = () => ({
          left, right: left + 24, top: 360, bottom: 408, width: 24, height: 48,
        });
      };
      placeTool(350, 80);
      placeGrip(280);
      render(<Tour state={idle} actions={actions()} onEnd={() => {}} startAt={at("draw-area")} />);
      act(() => vi.advanceTimersByTime(100));
      expect(document.querySelector(".tour-ring")).toHaveAttribute("x", "344");
      expect(screen.getByTestId("tour-shade").getAttribute("clip-path")).toMatch(/^url/);

      placeTool(490, 80);
      placeGrip(420);
      act(() => onResize());
      expect(document.querySelector(".tour-ring")).toHaveAttribute("x", "484");
      expect(document.querySelector(".tour-dim clipPath path").getAttribute("d")).toContain("M420 360H444");
      expect(screen.getByRole("heading", { name: "Start at Kīlauea" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shields the page from stray clicks and nudges the bubble instead", () => {
    render(<Tour state={idle} actions={actions()} onEnd={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("tour-shade"));
    expect(screen.getByRole("dialog")).toHaveClass("tour-bubble-nudge");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("dialog")).not.toHaveClass("tour-bubble-nudge");
  });

  it("announces each step, with no clock", () => {
    render(<Tour state={idle} actions={actions()} onEnd={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(`Tour step 1 of ${STEPS.length}: A data repository, turned into Google Maps`);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText(/\d:\d\d/)).toBeNull();
  });

  it("names the pitch part on every step but the opening and the radar diagram", () => {
    render(<Tour state={idle} actions={actions()} onEnd={() => {}} />);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("1 of " + STEPS.length)).toBeInTheDocument();
    expect(dialog.getByText(/The problem: NISAR's public viewers/)).toBeInTheDocument();
    expect(dialog.getByText(/Our solution: see any area fast/)).toBeInTheDocument();
    next();
    expect(within(screen.getByRole("dialog")).getByText("2 of " + STEPS.length)).toBeInTheDocument();
  });
});
