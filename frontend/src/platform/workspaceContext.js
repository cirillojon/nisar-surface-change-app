/* What the map workspace is showing, for the AI assistant and the top bar.
 *
 * The workspace writes here whenever its selection changes; readers
 * subscribe with useWorkspaceContext(). A tiny external store keeps the
 * workspace free of platform imports beyond one setter. */
import { useSyncExternalStore } from "react";

let current = { site: null, date: null, area: null, profileLine: null, landChange: null };
const listeners = new Set();

export function setWorkspaceContext(next) {
  current = { ...current, ...next };
  listeners.forEach((fn) => fn());
}

export function getWorkspaceContext() {
  return current;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useWorkspaceContext() {
  return useSyncExternalStore(subscribe, getWorkspaceContext, getWorkspaceContext);
}

/**
 * Link into the workspace, e.g. workspaceHref({ site: "sylhet-haor-floods", date: "2026-07-12" }),
 * workspaceHref({ mode: "stories", place: "jakobshavn" }) or
 * workspaceHref({ mode: "findings", finding: "okavango-flood-pulse:1" }).
 */
export function workspaceHref({ mode, site, place, finding, date } = {}) {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  if (site) params.set("site", site);
  if (place) params.set("place", place);
  if (finding) params.set("finding", finding);
  if (date) params.set("date", date);
  const query = params.toString();
  return query ? `/workspace?${query}` : "/workspace";
}
