/* The workspace's navigation model, as plain functions.
 *
 * What is on the map (a study site, a gallery place, a drawn area or line)
 * is one selection shared by every tab. A tab shows its view of that
 * selection where it has one, otherwise its list:
 *
 *   Stories      an open evidence card, else the place's story, else the story list
 *   Investigate  the selection's details, else the list of places
 *   My findings  what the viewer saved and wrote (never the curated stories)
 *
 * A panel's back link ("← All stories") clears the selection and returns to
 * the list; "Hide panel" only hides. The default workspace is Stories, its
 * list, nothing selected, the whole world on the map.
 *
 * Older links used a Findings tab (`?mode=findings`): with a `finding` they
 * open that evidence card in Stories, without one they open My findings.
 */

export const MODES = [
  { id: "stories", label: "Stories", hint: "Guided: what NISAR shows at a place, and what might explain it" },
  { id: "investigate", label: "Investigate", hint: "Every place with data, and your own area or line" },
  { id: "mine", label: "My findings", hint: "What you saved, your notes and your own stories" },
];
export const MODE_IDS = new Set(MODES.map((m) => m.id));
export const DEFAULT_MODE = "stories";

/** The mode a link asks for (old `findings` links included), else `fallback`. */
export function modeFrom(value, fallback = DEFAULT_MODE, { hasFinding = false } = {}) {
  if (value === "findings") return hasFinding ? "stories" : "mine";
  return MODE_IDS.has(value) ? value : fallback;
}

/** "slug" or "slug:2" (from `?finding=`) as { slug, moment }. */
export function parseFinding(value) {
  if (!value) return null;
  const [slug, moment] = value.split(":");
  const n = moment === undefined || moment === "" ? null : Number(moment);
  return slug ? { slug, moment: Number.isInteger(n) ? n : null } : null;
}
export const findingParam = (f) => (f ? `${f.slug}${f.moment != null ? `:${f.moment}` : ""}` : null);

/**
 * What the side panel holds: "finding" | "story" | "stories" | "details" |
 * "places" | "mine". `hasStory`: the selected place has a story;
 * `hasSelection`: anything is selected; `findingOpen`: an evidence card is open.
 */
export function panelView({ mode, hasStory = false, hasSelection = false, findingOpen = false }) {
  if (mode === "stories") return findingOpen ? "finding" : hasStory ? "story" : "stories";
  if (mode === "investigate") return hasSelection ? "details" : "places";
  return "mine";
}

/**
 * What a workspace URL asks for: its tab, a site (slug or id) on a date, a
 * gallery place, an evidence card, demo mode. Absent parameters are null.
 */
export function readWorkspaceUrl(searchParams) {
  const params = new URLSearchParams(searchParams);
  const get = (key) => params.get(key) || null;
  return {
    mode: get("mode"),
    site: get("site"),
    date: get("date"),
    place: get("place"),
    finding: get("finding"),
    demo: params.has("demo"),
  };
}

/**
 * The workspace's query parameters for a selection:
 * `?mode=…` plus `&site=…&date=…` or `&place=…`, and `&finding=…` in Stories.
 */
export function workspaceParams({ mode, site = null, date = null, place = null, finding = null }) {
  const params = { mode };
  if (site) {
    params.site = site;
    if (date) params.date = date;
  } else if (place) {
    params.place = place;
  }
  if (mode === "stories" && finding) params.finding = findingParam(finding);
  return params;
}

/**
 * Whether a change of the workspace's URL is a step for the browser's Back
 * button. A new tab, place or finding is ("push"); a new date on the same
 * place (scrubbing, playing) is not, and neither is the first URL the
 * workspace settles on, which has no `mode` yet ("replace").
 */
export function historyAction(current, next) {
  const from = new URLSearchParams(current);
  const to = new URLSearchParams(next);
  if (!from.has("mode")) return "replace";
  const same = ["mode", "site", "place", "finding"].every((k) => from.get(k) === to.get(k));
  return same ? "replace" : "push";
}

/**
 * Where a click on a place's map marker leads. In Investigate the place
 * opens there. Stories shows it if it has a story; otherwise, and from
 * My findings (which has no view of a place), the click moves to the tab that does.
 */
export function modeForPlace(mode, hasStory) {
  if (mode === "investigate") return mode;
  return hasStory ? "stories" : "investigate";
}
