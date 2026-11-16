import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KILAUEA, TOUR_BOX, TOUR_STORAGE_KEY, TOUR_VIEW } from "../services/tour.js";
import { useStableCallback } from "../services/useStableCallback.js";
import { useTour } from "../workspace/tour/useTour.js";

function setup({ touring = false, demo = false, active = true } = {}) {
  const workspace = {
    stopActivity: vi.fn(),
    resetView: vi.fn(),
    showInvestigate: vi.fn(),
    actions: { openStory: vi.fn() },
  };
  const hook = renderHook((props) => useTour(props), {
    initialProps: { active, initial: { touring: () => touring, demo: () => demo }, workspace },
  });
  return { ...hook, workspace };
}

describe("useTour", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.demo;
  });

  it("opens as asked and starts the tour from a quiet workspace", () => {
    const { result, workspace } = setup();
    expect(result.current.touring).toBe(false);
    act(() => result.current.start());
    expect(workspace.stopActivity).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ touring: true, demo: false });
  });

  it("passes the workspace's commands to the steps, beside its own", () => {
    const { result, workspace } = setup({ touring: true });
    result.current.actions.openStory("etna");
    expect(workspace.actions.openStory).toHaveBeenCalledWith("etna");
    expect(Object.keys(result.current.actions)).toEqual(
      expect.arrayContaining(["openStory", "leaveKilauea", "setGuide", "showKilauea"]),
    );
  });

  it("holds the map on Kīlauea with the marks a step asks for, and lets go", () => {
    const { result, workspace } = setup({ touring: true });
    act(() => result.current.actions.showKilauea({ marks: { pin: true, box: true }, panel: false }));
    expect(workspace.showInvestigate).toHaveBeenCalledWith(false);
    expect(result.current.marks).toEqual({ pin: KILAUEA, box: TOUR_BOX, line: null });
    expect(result.current.focus).toBe(TOUR_VIEW);
    expect(result.current.refit).toBe(1);
    act(() => result.current.actions.setGuide(["2026-06-26"]));
    expect(result.current.guide).toEqual(["2026-06-26"]);
    act(() => result.current.actions.leaveKilauea());
    expect(result.current).toMatchObject({ marks: null, focus: null, guide: null });
  });

  it("ends as seen, resetting the workspace only when it ends at Kīlauea", () => {
    const { result, workspace } = setup({ touring: true });
    act(() => result.current.end());
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("done");
    expect(result.current.touring).toBe(false);
    expect(workspace.resetView).not.toHaveBeenCalled();

    act(() => result.current.start());
    act(() => result.current.actions.showKilauea({}));
    act(() => result.current.end());
    expect(workspace.resetView).toHaveBeenCalledOnce();
    expect(result.current.focus).toBeNull();
  });

  it("keeps end and endDemo stable across renders", () => {
    const { result, rerender, workspace } = setup({ touring: true });
    const { end, endDemo } = result.current;
    rerender({ active: true, initial: { touring: () => true, demo: () => false }, workspace });
    expect(result.current.end).toBe(end);
    expect(result.current.endDemo).toBe(endDemo);
  });

  it("runs demo mode with the page around it hidden, and leaves it for the default workspace", () => {
    const { result, workspace } = setup();
    act(() => result.current.startDemo());
    expect(result.current).toMatchObject({ touring: true, demo: true, demoView: { panel: false, chain: false } });
    expect(document.documentElement.dataset.demo).toBe("");
    act(() => result.current.endDemo());
    expect(result.current).toMatchObject({ touring: false, demo: false });
    expect(workspace.resetView).toHaveBeenCalled();
    expect(document.documentElement.dataset.demo).toBeUndefined();
  });
});

describe("useStableCallback", () => {
  it("keeps one identity and calls the latest function", () => {
    const { result, rerender } = renderHook(({ n }) => useStableCallback(() => n), { initialProps: { n: 1 } });
    const first = result.current;
    expect(first()).toBe(1);
    rerender({ n: 2 });
    expect(result.current).toBe(first);
    expect(first()).toBe(2);
  });
});
