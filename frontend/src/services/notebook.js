/* My findings: what a viewer saves and writes, kept in this browser.
 *
 * Two kinds of finding:
 *   - "moment": a curated story's moment ({ slug, moment }); its evidence
 *     card is rebuilt from the API, so it never goes stale.
 *   - "view": whatever was on the map (a study site on a date and layer, a
 *     gallery place, a drawn area or line).
 *
 * Each finding keeps the viewer's own `title` and `notes` apart from an
 * `evidence` snapshot of what the app showed when it was saved (values,
 * dates, passes, coverage, mode, sources). Notes are the viewer's
 * interpretation; evidence is the app's. User stories are ordered lists of
 * findings with the viewer's own title and notes.
 *
 * Older versions saved only story references under `nisar.findings.v1`;
 * those are read once into the notebook and left where they were.
 * Storage can be unavailable (private windows, blocked site data): every
 * access is guarded and the notebook simply starts empty. */
import { useCallback, useEffect, useState } from "react";

const KEY = "nisar.notebook.v1";
const LEGACY_KEY = "nisar.findings.v1";
const EVENT = "nisar-notebook-change";
const MAX_FINDINGS = 200;

export const findingKey = (f) => `${f.slug}/${f.moment ?? ""}`;

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const EMPTY = { findings: [], stories: [] };

function fromLegacy(rows) {
  const at = now();
  return rows
    .filter((r) => r && typeof r.slug === "string")
    .map((r) => ({
      id: newId("f"),
      kind: "moment",
      title: r.title ?? r.slug,
      notes: "",
      createdAt: at,
      updatedAt: at,
      source: { slug: r.slug, moment: r.moment ?? null },
      evidence: { label: r.label ?? null },
    }));
}

function clean(data) {
  const findings = Array.isArray(data?.findings) ? data.findings.filter((f) => f && typeof f.id === "string") : [];
  const ids = new Set(findings.map((f) => f.id));
  const stories = (Array.isArray(data?.stories) ? data.stories : [])
    .filter((s) => s && typeof s.id === "string")
    .map((s) => ({ ...s, findingIds: (s.findingIds ?? []).filter((id) => ids.has(id)) }));
  return { findings, stories };
}

export function readNotebook() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return clean(JSON.parse(raw));
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || "[]");
    const migrated = { findings: Array.isArray(legacy) ? fromLegacy(legacy) : [], stories: [] };
    if (migrated.findings.length) window.localStorage.setItem(KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return { ...EMPTY };
  }
}

function write(data) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: keep the notebook for this page view only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: data }));
}

/** Is this curated story moment already saved? */
export const savesMoment = (finding, ref) =>
  finding.kind === "moment" && finding.source?.slug === ref.slug && (finding.source?.moment ?? null) === (ref.moment ?? null);

/** The notebook and everything that changes it. */
export function useNotebook() {
  const [data, setData] = useState(readNotebook);
  useEffect(() => {
    const onChange = (e) => setData(e.detail ?? readNotebook());
    const onStorage = (e) => {
      if (e.key === KEY) setData(readNotebook());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const change = useCallback((fn) => {
    const next = clean(fn(readNotebook()));
    setData(next);
    write(next);
    return next;
  }, []);

  /** Save a finding ({ kind, title, notes, source, view, evidence }); returns its id. */
  const saveFinding = useCallback((finding, { storyId = null } = {}) => {
    const at = now();
    const id = newId("f");
    change((d) => ({
      findings: [{ ...finding, id, createdAt: at, updatedAt: at }, ...d.findings].slice(0, MAX_FINDINGS),
      stories: d.stories.map((s) => (s.id === storyId ? { ...s, findingIds: [...s.findingIds, id], updatedAt: at } : s)),
    }));
    return id;
  }, [change]);

  const updateFinding = useCallback((id, patch) => change((d) => ({
    ...d,
    findings: d.findings.map((f) => (f.id === id ? { ...f, ...patch, id, updatedAt: now() } : f)),
  })), [change]);

  const removeFinding = useCallback((id) => change((d) => ({
    findings: d.findings.filter((f) => f.id !== id),
    stories: d.stories.map((s) => ({ ...s, findingIds: s.findingIds.filter((x) => x !== id) })),
  })), [change]);

  const createStory = useCallback((title, notes = "") => {
    const at = now();
    const id = newId("s");
    change((d) => ({ ...d, stories: [{ id, title: title || "Untitled story", notes, findingIds: [], createdAt: at, updatedAt: at }, ...d.stories] }));
    return id;
  }, [change]);

  const updateStory = useCallback((id, patch) => change((d) => ({
    ...d,
    stories: d.stories.map((s) => (s.id === id ? { ...s, ...patch, id, updatedAt: now() } : s)),
  })), [change]);

  const removeStory = useCallback((id) => change((d) => ({ ...d, stories: d.stories.filter((s) => s.id !== id) })), [change]);

  const addToStory = useCallback((storyId, findingId) => change((d) => ({
    ...d,
    stories: d.stories.map((s) => (s.id === storyId && !s.findingIds.includes(findingId)
      ? { ...s, findingIds: [...s.findingIds, findingId], updatedAt: now() }
      : s)),
  })), [change]);

  const removeFromStory = useCallback((storyId, findingId) => change((d) => ({
    ...d,
    stories: d.stories.map((s) => (s.id === storyId
      ? { ...s, findingIds: s.findingIds.filter((x) => x !== findingId), updatedAt: now() }
      : s)),
  })), [change]);

  /** Move a finding one place up (-1) or down (+1) in a story. */
  const moveInStory = useCallback((storyId, findingId, step) => change((d) => ({
    ...d,
    stories: d.stories.map((s) => {
      if (s.id !== storyId) return s;
      const ids = [...s.findingIds];
      const i = ids.indexOf(findingId);
      const j = i + step;
      if (i < 0 || j < 0 || j >= ids.length) return s;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...s, findingIds: ids, updatedAt: now() };
    }),
  })), [change]);

  const isSaved = useCallback((ref) => data.findings.some((f) => savesMoment(f, ref)), [data]);

  return {
    findings: data.findings,
    stories: data.stories,
    saveFinding,
    updateFinding,
    removeFinding,
    createStory,
    updateStory,
    removeStory,
    addToStory,
    removeFromStory,
    moveInStory,
    isSaved,
  };
}

// ── Sharing ──────────────────────────────────────────────────────────

/** A link that puts a saved finding back on the map (where the URL can say it). */
export function findingLink(finding, origin = window.location.origin) {
  const v = finding.view ?? {};
  if (finding.kind === "moment" && finding.source?.slug) {
    const m = finding.source.moment;
    return `${origin}/workspace?mode=stories&finding=${encodeURIComponent(finding.source.slug)}${m != null ? `:${m}` : ""}`;
  }
  const params = new URLSearchParams({ mode: v.mode ?? "investigate" });
  if (v.site) {
    params.set("site", v.site);
    if (v.date) params.set("date", v.date);
  } else if (v.place) {
    params.set("place", v.place);
  } else {
    return null; // a drawn area or line: the notes and evidence say where
  }
  return `${origin}/workspace?${params}`;
}

const bullet = (label, value) => (value == null || value === "" ? null : `- ${label}: ${value}`);

function evidenceLines(e = {}, view = {}) {
  return [
    bullet("Place", view.name),
    bullet("Measurement", e.label && e.display ? `${e.label}: ${e.display}` : e.display ?? e.label),
    bullet("What the app showed", e.caption),
    bullet("Dates", e.start && e.end && e.start !== e.end ? `${e.start} to ${e.end}` : e.date ?? e.start),
    bullet("Map layer", view.layerLabel),
    bullet("Area", view.bbox ? `[${view.bbox.join(", ")}] (lon/lat)` : null),
    bullet("Line", view.line ? view.line.map(([lon, lat]) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`).join(" → ") : null),
    bullet("Passes", e.passes),
    bullet("Box imaged on this pass", e.coverage != null ? `${e.coverage}%` : null),
    bullet("Acquisition mode", e.mode),
    bullet("Compared over", e.footprint),
    bullet("Quality", e.quality),
    bullet("Granule", e.granule),
    bullet("Source", e.source),
    ...(e.limits ?? []).map((l) => `- Limit: ${l}`),
  ].filter(Boolean);
}

/** A user story as Markdown, the viewer's words clearly apart from the app's evidence. */
export function storyMarkdown(story, findings, { origin = window.location.origin, today = new Date() } = {}) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const lines = [
    `# ${story.title}`,
    "",
    `_A story written in the NISAR Surface Change Explorer, ${today.toISOString().slice(0, 10)}. ` +
      "Sections marked “Your notes” are the author's interpretation. Sections marked “From the data” " +
      "were generated by the app from NASA/ISRO NISAR data and public sources; they are not tested causes._",
    "",
  ];
  if (story.notes?.trim()) lines.push("## Your notes", "", story.notes.trim(), "");
  story.findingIds.map((id) => byId.get(id)).filter(Boolean).forEach((f, i) => {
    lines.push(`## ${i + 1}. ${f.title}`, "");
    lines.push("**Your notes**", "", f.notes?.trim() ? f.notes.trim() : "_(none)_", "");
    lines.push("**From the data (generated by the app)**", "", ...evidenceLines(f.evidence, f.view), "");
    const link = findingLink(f, origin);
    if (link) lines.push(`[Open in the workspace](${link})`, "");
  });
  return lines.join("\n");
}

export function downloadText(name, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const slugify = (text) => (text || "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "story";
