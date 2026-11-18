// What is selected on the map, and how it is being viewed, as one reducer.
//
// `target` is at most one thing — a study site, a gallery place, an area
// or a profile line — so two can't be selected at once. Picking something
// (or nothing) resets every view setting with it in a single update, which
// is what the workspace's old clearSelection() did with 20 setters.

import { useMemo, useReducer } from "react";

/**
 * @typedef {null
 *   | { kind: "site", id: number }
 *   | { kind: "place", slug: string }
 *   | { kind: "area", aoi: { latitude: number, longitude: number, bbox: number[], drawn?: boolean, imagery?: string | null } }
 *   | { kind: "line", line: number[][] }} Target
 */

/** How a selection is viewed; all of it starts over with each new selection. */
export const FRESH_VIEW = Object.freeze({
  // A study site: the pass shown (null: the one asked for, else its latest),
  // a date asked for before its passes arrived, whether a link or finding
  // chose that date, and its image layer.
  sceneIndex: null,
  pendingDate: null,
  keepDate: false,
  siteLayer: "colour",
  // The linked pair that opened the timeline comparison, if any.
  comparison: null,
  // A gallery place (or the tour's imagery) in its player: its layer (null:
  // its starting one), the dates it compares ({ from?, to? }; null: its
  // suggested pair), and whether change maps remove the area-wide shift
  // (see components/land/useLandPlayer.js).
  landLayer: null,
  landDates: null,
  landShift: true,
  // The catalog search beside a site or area: open (a site's), the search
  // submitted (null: the default), and the explorer's view of its results
  // (see workspace/useAreaCatalog.js).
  catalogOpen: false,
  search: null,
  explorer: null,
  // The evidence (charts) panel, and a story's Save / share menu.
  evidenceOpen: true,
  shareOpen: false,
});

/** The view fields a setter may change one at a time. */
export const VIEW_FIELDS = Object.keys(FRESH_VIEW);

export const initialSelection = (view = {}) => ({ target: null, ...FRESH_VIEW, ...view });

export function selectionReducer(state, action) {
  switch (action.type) {
    // Select `target` (null: nothing), starting its view afresh plus `view`.
    case "select":
      return { target: action.target ?? null, ...FRESH_VIEW, ...action.view };
    // One view field, set to a value or by an updater of its current value.
    case "set": {
      if (!Object.hasOwn(FRESH_VIEW, action.field)) throw new Error(`Unknown selection field: ${action.field}`);
      const value = typeof action.value === "function" ? action.value(state[action.field]) : action.value;
      return Object.is(value, state[action.field]) ? state : { ...state, [action.field]: value };
    }
    default:
      throw new Error(`Unknown selection action: ${action.type}`);
  }
}

const setterName = (field) => `set${field[0].toUpperCase()}${field.slice(1)}`;

/**
 * The selection and its actions: `select(target, view?)`, `clear()`, and a
 * stable setter per view field (`setSceneIndex`, `setLandLayer`, …) that,
 * like a useState setter, takes a value or an updater.
 */
export function useSelection(initialView) {
  const [state, dispatch] = useReducer(selectionReducer, initialView, initialSelection);
  const actions = useMemo(() => {
    const setters = Object.fromEntries(
      VIEW_FIELDS.map((field) => [setterName(field), (value) => dispatch({ type: "set", field, value })]),
    );
    return {
      select: (target, view) => dispatch({ type: "select", target, view }),
      clear: () => dispatch({ type: "select", target: null }),
      ...setters,
    };
  }, []);
  return [state, actions];
}

/** The pass a site opens on: the date asked for if it has it, else its latest. */
export function defaultSceneIndex(site, date) {
  const scenes = site?.scenes ?? [];
  const asked = date ? scenes.findIndex((x) => x.date === date) : -1;
  return asked >= 0 ? asked : Math.max(0, scenes.length - 1);
}
