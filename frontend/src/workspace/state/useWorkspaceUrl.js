// The workspace and its URL (`?mode=…&site=…&date=…`, `&place=…`, `&finding=…`).
//
// The workspace's state is the source of truth, not the URL: the workspace
// stays mounted while the docs are read (platform/WorkspaceHost.jsx), with a
// /docs URL, and the plain /workspace link brings back what was open. Drawn
// areas and lines aren't in the URL at all. So the URL is two things:
//
//   In:  each navigation to the workspace (a link, Back / Forward, the top
//        bar) is applied once, by `onNavigate`, when the data it names (the
//        site list, the gallery) has loaded.
//   Out: otherwise the URL follows what is shown (`view`). A new tab, place
//        or finding is a step for Back; a new date is not.
//
// Until a navigation has been applied the URL is left as it is, so a link
// isn't overwritten while its site loads.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";

import { historyAction, readWorkspaceUrl, workspaceParams } from "../navigation.js";

// Marks the URL changes made here, so they aren't applied back as navigations.
const MIRRORED = "workspaceMirror";

/**
 * @param {object} options
 * @param {boolean} options.active  the workspace is the page shown
 * @param {{ sites: boolean, places: boolean }} options.ready  the site list / gallery has loaded (or failed)
 * @param {object} options.view  what is shown, as workspaceParams takes it
 * @param {(request: ReturnType<typeof readWorkspaceUrl>, how: { pop: boolean, home: boolean }) => void} options.onNavigate
 *   apply a navigation: `pop` for Back / Forward, `home` for the workspace's
 *   own address (no parameters) opened from inside the workspace
 */
export function useWorkspaceUrl({ active, ready, view, onNavigate }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  // The navigation (location.key) last applied to the workspace.
  const [appliedKey, setAppliedKey] = useState(null);
  // Was the workspace showing before the latest navigation?
  const seen = useRef({ key: null, active: false, fromWorkspace: false });
  // The latest onNavigate, called from the effect below without re-running it.
  const apply = useRef(onNavigate);
  useLayoutEffect(() => {
    apply.current = onNavigate;
  });

  // In: apply each navigation once, when what it names can be found.
  useEffect(() => {
    if (seen.current.key !== location.key) {
      seen.current = { key: location.key, active, fromWorkspace: seen.current.active };
    }
    if (!active || appliedKey === location.key) return;
    const pop = navigationType === "POP";
    // Our own mirroring (but Back / Forward to such an entry is a navigation).
    if (location.state?.[MIRRORED] && !pop) {
      setAppliedKey(location.key);
      return;
    }
    const request = readWorkspaceUrl(searchParams);
    if ((request.site && !ready.sites) || (request.place && !ready.places)) return;
    const home = seen.current.fromWorkspace && navigationType === "PUSH" && !location.search;
    apply.current(request, { pop, home });
    setAppliedKey(location.key);
  }, [active, appliedKey, location.key, location.state, location.search, navigationType, searchParams, ready.sites, ready.places]);

  // Out: once the latest navigation is applied, the URL follows the view.
  const next = new URLSearchParams(workspaceParams(view)).toString();
  useEffect(() => {
    if (!active || appliedKey !== location.key || next === searchParams.toString()) return;
    setSearchParams(next, {
      replace: historyAction(searchParams, next) === "replace",
      state: { [MIRRORED]: true },
    });
  }, [active, appliedKey, location.key, next, searchParams, setSearchParams]);
}
