import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FRESH_VIEW,
  defaultSceneIndex,
  initialSelection,
  selectionReducer,
  useSelection,
} from "../workspace/state/selection.js";

const SITE = { kind: "site", id: 1 };
const PLACE = { kind: "place", slug: "etna" };

describe("selectionReducer", () => {
  it("starts with nothing selected and a fresh view", () => {
    expect(initialSelection()).toEqual({ target: null, ...FRESH_VIEW });
    expect(initialSelection({ keepDate: true }).keepDate).toBe(true);
  });

  it("replaces the selection and resets every view setting with it", () => {
    let state = selectionReducer(initialSelection(), { type: "select", target: SITE });
    state = selectionReducer(state, { type: "set", field: "siteLayer", value: "hh" });
    state = selectionReducer(state, { type: "set", field: "catalogOpen", value: true });
    state = selectionReducer(state, { type: "set", field: "evidenceOpen", value: false });
    state = selectionReducer(state, { type: "select", target: PLACE });
    expect(state).toEqual({ target: PLACE, ...FRESH_VIEW });
  });

  it("can start a selection with some of its view chosen", () => {
    const state = selectionReducer(initialSelection(), {
      type: "select",
      target: SITE,
      view: { pendingDate: "2026-07-14", keepDate: true },
    });
    expect(state).toMatchObject({ target: SITE, pendingDate: "2026-07-14", keepDate: true, siteLayer: "colour" });
  });

  it("clears to nothing selected", () => {
    const picked = selectionReducer(initialSelection(), { type: "select", target: SITE });
    expect(selectionReducer(picked, { type: "select", target: null }).target).toBeNull();
  });

  it("sets a field by value or updater, and keeps the state when nothing changes", () => {
    const state = initialSelection();
    const focused = selectionReducer(state, { type: "set", field: "landFocus", value: (f) => ({ date: "d", n: (f?.n ?? 0) + 1 }) });
    expect(focused.landFocus).toEqual({ date: "d", n: 1 });
    expect(selectionReducer(focused, { type: "set", field: "landFocus", value: (f) => ({ ...f, n: f.n + 1 }) }).landFocus.n).toBe(2);
    expect(selectionReducer(state, { type: "set", field: "siteLayer", value: "colour" })).toBe(state);
  });

  it("refuses unknown fields and actions", () => {
    expect(() => selectionReducer(initialSelection(), { type: "set", field: "target", value: SITE })).toThrow(/Unknown selection field/);
    expect(() => selectionReducer(initialSelection(), { type: "nope" })).toThrow(/Unknown selection action/);
  });
});

describe("useSelection", () => {
  it("gives stable actions, one setter per view field", () => {
    const { result, rerender } = renderHook(() => useSelection());
    const first = result.current[1];
    expect(Object.keys(first)).toEqual(expect.arrayContaining(["select", "clear", "setSceneIndex", "setLandLayer", "setShareOpen"]));
    act(() => first.select(SITE));
    act(() => first.setShareOpen((open) => !open));
    expect(result.current[0]).toMatchObject({ target: SITE, shareOpen: true });
    rerender();
    expect(result.current[1]).toBe(first);
    act(() => first.clear());
    expect(result.current[0]).toEqual({ target: null, ...FRESH_VIEW });
  });
});

describe("defaultSceneIndex", () => {
  const site = { scenes: [{ date: "a" }, { date: "b" }, { date: "c" }] };

  it("opens on the date asked for, else the latest pass", () => {
    expect(defaultSceneIndex(site, "b")).toBe(1);
    expect(defaultSceneIndex(site, "zzz")).toBe(2);
    expect(defaultSceneIndex(site, null)).toBe(2);
  });

  it("is 0 for a site with no passes or none loaded", () => {
    expect(defaultSceneIndex({ scenes: [] }, "a")).toBe(0);
    expect(defaultSceneIndex(null, null)).toBe(0);
  });
});
