// What the workspace does when the viewer (or the tour, or a link) asks:
// select a place, area or line, open a story or an evidence card, save a
// finding, draw, switch tabs. The handlers read the workspace (`ws`, built by
// useWorkspace) when they run, so the parts set up after them in the same
// render (the tour, the catalog, the land player) are there by then.

import { useCallback } from "react";

import { storyQuery } from "../services/queries.js";
import { TOUR_BOX, TOUR_IMAGERY, TOUR_LINE } from "../services/tour.js";
import {
  momentDraft as buildMomentDraft,
  placeDraft as buildPlaceDraft,
  viewDraft as buildViewDraft,
} from "./drafts.js";
import { aoiAround } from "./mapLayers.js";
import { DEFAULT_MODE, modeForPlace } from "./navigation.js";

export const NARROW_LAYOUT = "(max-width: 760px)";
const narrow = () => window.matchMedia(NARROW_LAYOUT).matches;

/** Drawing tools, revealing a selection, and moving between panels and tabs. */
function useLayoutActions(ws) {
  const { ui, refs, sel } = ws;
  const { setDrawing } = ui;
  const cancelDraw = useCallback(() => setDrawing(null), [setDrawing]);
  const stopDraw = useCallback(() => {
    const button = ui.drawing === "line" ? refs.lineButtonRef : refs.drawButtonRef;
    cancelDraw();
    button.current?.focus({ preventScroll: true });
  }, [cancelDraw, ui.drawing, refs.lineButtonRef, refs.drawButtonRef]);
  return {
    narrow,
    cancelDraw,
    stopDraw,
    toggleDraw: (tool = "area") => {
      if (ui.drawing !== tool) {
        ui.setMode("investigate");
        if (narrow()) ui.setPanelOpen(false);
        else refs.workspaceRef.current?.scrollTo({ top: 0 });
      }
      setDrawing((current) => (current === tool ? null : tool));
    },
    // Something was selected: show its panel beside the map, or on a phone
    // (where the panel would cover the map) the map itself.
    revealSelection: () => {
      if (refs.sidebarRef.current?.contains(document.activeElement)) refs.mapTitleRef.current?.focus({ preventScroll: true });
      if (narrow()) {
        ui.setPanelOpen(false);
        refs.mapTitleRef.current?.scrollIntoView({ block: "nearest" });
      } else {
        ui.setPanelOpen(true);
        refs.workspaceRef.current?.scrollTo({ top: 0 });
      }
    },
    // A panel's back link: nothing selected, this tab's list, the whole world.
    backToList: () => {
      sel.clear();
      cancelDraw();
      ui.setPanelOpen(true);
      ui.setHomeKey((n) => n + 1);
      refs.panelButtonRef.current?.focus({ preventScroll: true });
      if (narrow()) window.scrollTo({ top: 0, behavior: "instant" });
    },
    // The default workspace: Stories, nothing selected, the whole world.
    resetView: () => {
      sel.clear();
      ui.setMode(DEFAULT_MODE);
      ui.setPanelOpen(!narrow());
      ui.setHomeKey((n) => n + 1);
    },
    // A tab switches mode and opens its panel, on every screen size. What is
    // on the map stays, so the same place can be read in another tab.
    switchMode: (next) => {
      cancelDraw();
      ui.setMode(next);
      ui.setPanelOpen(true);
      if (!ui.panelOpen && narrow()) window.scrollTo({ top: 0, behavior: "instant" });
    },
    // One toggle for the side panel; the tabs and each panel's own back link do the rest.
    togglePanel: () => {
      cancelDraw();
      ui.setPanelOpen((open) => !open);
      if (!ui.panelOpen && narrow()) window.scrollTo({ top: 0, behavior: "instant" });
    },
    // "Clear" removes a drawing and nothing else: the map stays where it is.
    clearDrawing: () => {
      sel.clear();
      cancelDraw();
    },
    scrollToMap: () => {
      if (narrow()) refs.mapTitleRef.current?.scrollIntoView({ block: "nearest" });
    },
  };
}

/** Selecting a study site, a gallery place, an area (clicked or drawn) or a line. */
function selectionActions(ws, layout) {
  const { data, sel, ui, siteQuery, v } = ws;
  const { cancelDraw, revealSelection } = layout;
  const selectSite = (id) => {
    if (id !== v.selectedSiteId) sel.select({ kind: "site", id });
    else if (v.siteError) siteQuery.retry();
    sel.setEvidenceOpen(true);
    cancelDraw();
    revealSelection();
  };
  const selectLandChange = (slug) => {
    sel.select({ kind: "place", slug });
    cancelDraw();
    revealSelection();
  };
  // A rectangle drawn with the map's draw tool. The tours draw only at
  // Kīlauea, so during one any box becomes the suggested box: the sharp
  // imagery rendered for it then plays, never NASA's coarse browse images of
  // whole orbit frames (which differ in size from pass to pass).
  const selectArea = (drawn) => {
    const snapped = ws.tour.touring ? TOUR_BOX : null;
    const bbox = snapped ?? drawn;
    ui.setMode("investigate");
    sel.select({
      kind: "area",
      aoi: { latitude: (bbox[1] + bbox[3]) / 2, longitude: (bbox[0] + bbox[2]) / 2, bbox, drawn: true, imagery: snapped ? TOUR_IMAGERY : null },
    });
    cancelDraw();
    revealSelection();
  };
  // A line drawn with the line tool: height profile over time. Likewise any
  // line drawn during a tour becomes the suggested one (its result ships with the app).
  const selectLine = (line) => {
    const snapped = ws.tour.touring ? TOUR_LINE : null;
    ui.setMode("investigate");
    ws.tour.setSnapped(Boolean(snapped));
    sel.select({ kind: "line", line: snapped ?? line });
    cancelDraw();
    revealSelection();
  };
  // A marker on the map opens its place in a tab that has a view of it.
  const openFromMap = (slug, open) => {
    ui.setMode(modeForPlace(ui.mode, data.storyIndex.has(slug)));
    open();
  };
  return {
    selectSite,
    selectLandChange,
    selectArea,
    selectLine,
    selectPoint: ({ latitude, longitude }) => {
      ui.setMode("investigate");
      sel.select({ kind: "area", aoi: aoiAround(latitude, longitude) });
      revealSelection();
    },
    // Stories: a story is a study site or a gallery place with a question.
    selectStory: (story) => {
      if (story.source !== "site") return selectLandChange(story.slug);
      const target = data.sites.find((s) => s.slug === story.slug);
      if (target) selectSite(target.id);
    },
    selectSiteOnMap: (id) => openFromMap(data.sites.find((s) => s.id === id)?.slug, () => selectSite(id)),
    selectPlaceOnMap: (slug) => openFromMap(slug, () => selectLandChange(slug)),
  };
}

/** Show a date of the selected site: at once if its passes are here, else once they arrive. */
function showSiteDate(ws, date) {
  const { v, sel } = ws;
  const i = date && v.site ? v.site.scenes?.findIndex((x) => x.date === date) ?? -1 : -1;
  if (i >= 0) sel.setSceneIndex(i);
  else if (date) sel.setPendingDate(date);
}

/** Opening a story, an evidence card or a saved finding, and the dates a story asks for. */
function storyActions(ws, layout, selection) {
  const { data, sel, ui, refs, v } = ws;
  const { cancelDraw, narrow: isNarrow, scrollToMap } = layout;
  // A curated story by slug, on a date and layer. Opening the one already
  // shown only moves its date and layer, so its chart and story stay put.
  const openStory = (slug, { date = null, layer = null, panel = null } = {}) => {
    const story = data.storyIndex.get(slug);
    cancelDraw();
    ui.setOpenFinding(null);
    ui.setMode("stories");
    ui.setPanelOpen(panel ?? !isNarrow());
    if (story && story.source !== "site") {
      if (slug !== v.landSlug) sel.select({ kind: "place", slug });
      sel.setLandLayer(layer);
      if (date) sel.setLandDates((d) => ({ ...d, to: date }));
      return;
    }
    const target = data.sites.find((s) => s.slug === slug);
    if (!target) return;
    if (target.id === v.selectedSiteId) showSiteDate(ws, date);
    else sel.select({ kind: "site", id: target.id }, { pendingDate: date });
    sel.setKeepDate(Boolean(date));
    if (layer) sel.setSiteLayer(layer);
  };
  // Put a finding's place and pass on the map. An open card's place goes on
  // the map by itself (`focusMap: false`, so the card stays in view on a
  // phone); the card's "Show on map" button also brings the map forward.
  const showFindingOnMap = (finding, { focusMap = true } = {}) => {
    if (finding.story.source === "site") {
      const target = data.sites.find((s) => s.slug === finding.site.slug);
      if (!target) return;
      if (target.id === v.selectedSiteId) {
        showSiteDate(ws, finding.claim.end);
        sel.setKeepDate(true);
      } else {
        sel.select({ kind: "site", id: target.id }, { pendingDate: finding.claim.end, keepDate: true });
      }
    } else if (finding.site.slug !== v.landSlug) {
      sel.select({ kind: "place", slug: finding.site.slug });
    }
    cancelDraw();
    if (focusMap && isNarrow()) {
      ui.setPanelOpen(false);
      refs.mapTitleRef.current?.scrollIntoView({ block: "nearest" });
    }
  };
  // Put a saved finding back on the map: its place, date and layer.
  const showSavedFinding = (finding) => {
    const view = finding.view ?? {};
    const slug = view.site ?? view.place;
    if (slug) {
      openStory(slug, { date: view.site ? view.date : null, layer: view.layer, panel: !isNarrow() });
      if (!data.storyIndex.has(slug)) ui.setMode("investigate");
    } else if (view.bbox) selection.selectArea(view.bbox);
    else if (view.line) selection.selectLine(view.line);
    scrollToMap();
  };
  return {
    openStory,
    showFindingOnMap,
    showSavedFinding,
    openFindingCard: (ref) => {
      ui.setOpenFinding(ref ? { slug: ref.slug, moment: ref.moment ?? null, title: ref.title, label: ref.label } : null);
      sel.setShareOpen(false);
      if (!ref) return;
      ui.setMode("stories");
      ui.setPanelOpen(true);
    },
  };
}

/** A date asked for from a chart or a story: the area's explorer, or the site's pass. */
function dateActions(ws, layout) {
  const { sel, v } = ws;
  // Closing a site's catalog drops its search; opening it again starts afresh.
  const toggleCatalog = (open) => {
    sel.setCatalogOpen(open);
    if (open) return;
    sel.setSearch(null);
    sel.setExplorer(null);
  };
  const returnToStudy = () => {
    toggleCatalog(false);
    ws.refs.mapTitleRef.current?.focus({ preventScroll: true });
  };
  const selectAnalysisDate = (date) => {
    if (v.aoi) return ws.catalog.actions.selectDate(date);
    // The record can arrive before the passes: show this date once they do.
    if (!v.site) {
      if (v.selectedSiteId !== null && !sel.keepDate) sel.setPendingDate(date);
      return undefined;
    }
    const index = v.site.scenes?.findIndex((item) => item.date === date) ?? -1;
    if (index >= 0) sel.setSceneIndex(index);
    return undefined;
  };
  return {
    toggleCatalog,
    returnToStudy,
    selectAnalysisDate,
    // A story's chart or text asks for a date (and maybe a layer) of its site.
    onStorySelectDate: (date, layer) => {
      if (!v.site?.scenes?.some((pass) => pass.date === date)) return;
      if (sel.catalogOpen) returnToStudy();
      sel.setKeepDate(true);
      selectAnalysisDate(date);
      if (layer) sel.setSiteLayer(layer);
      layout.scrollToMap();
    },
    // A place's story asks to compare two of its images (or show their change map).
    onCompareImages: v.landSite ? (from, date, layer = "change") => {
      const before = v.landSite.passes.find((p) => p.date === from);
      if (!before || !v.landSite.passes.some((p) => p.date === date)) return;
      sel.setLandDates({ from, to: date });
      sel.setLandLayer(layer === "change" && !before.hh_url ? "hh" : layer);
      layout.scrollToMap();
    } : null,
  };
}

/** The drafts saved to My findings, from what is shown (drafts.js builds them). */
function draftActions(ws) {
  const { data, sel, v } = ws;
  const changeType = () => data.changeTypeOf(v.site?.change_type);
  const placeStory = () => v.landSite && data.storyIndex.get(v.landSite.slug);
  // A curated story's moment (from its panel, its chart or the tour).
  const momentDraft = (storyTitle, moment, index) =>
    buildMomentDraft({ site: v.site, changeType: changeType(), siteLayer: sel.siteLayer, storyTitle, moment, index });
  // A gallery place's story or view: the two dates its change map compares.
  const placeDraft = (kind) =>
    buildPlaceDraft({ place: v.landSite, kind, layer: sel.landLayer, dates: ws.land.compared, story: placeStory() });
  return {
    momentDraft,
    placeDraft,
    // Whatever is on the map now ("Save view").
    viewDraft: () => buildViewDraft({
      place: v.landSite,
      placeLayer: sel.landLayer,
      placeDates: ws.land.compared,
      placeStory: placeStory(),
      site: v.site,
      scene: v.scene,
      changeType: changeType(),
      siteLayer: sel.siteLayer,
      siteHasStory: Boolean(v.site && data.storyIndex.has(v.site.slug)),
      profileLine: v.profileLine,
      aoi: v.aoi,
      areaSeries: ws.catalog.observation,
    }),
    // A story's own moment (its "Save / share"), from the moment on the map.
    storyDraft: ({ story, moment, momentIndex }) =>
      (story.source === "site" ? moment && momentDraft(story.title, moment, momentIndex) : placeDraft("moment")),
  };
}

/** Saving a finding: open the dialog on a draft, save it, and the tour's save of the moment shown. */
function saveActions(ws, drafts) {
  const { data, sel, ui, notebook, v } = ws;
  const openSaveFor = (draft) => {
    if (!draft) return;
    sel.setShareOpen(false);
    ui.setSaveDraft(draft);
  };
  return {
    openSaveFor,
    commitSave: (finding, { storyId, newStory }) => {
      const target = newStory ? notebook.createStory(newStory) : storyId;
      notebook.saveFinding(finding, { storyId: target });
      ui.setSaveDraft(null);
      ui.setSavedNote(finding.title);
    },
    // An evidence card's Save: its place may not be on the map yet, so build from the card itself.
    saveFindingCard: (ref, card) => {
      if (card.story.source === "site" && v.site?.slug === card.site.slug) {
        const m = { ...card.claim, focus: card.claim.focus ?? card.claim.end };
        openSaveFor(drafts.momentDraft(card.story.title, m, card.moment));
      } else if (v.landSite?.slug === card.site.slug) {
        openSaveFor(drafts.placeDraft("moment"));
      }
    },
    // Save the moment of the story on the map (the tour's notes step, when it
    // is entered without the menu): fetched like its panel does (cached).
    saveShownStoryMoment: async (signal) => {
      const slug = v.site?.slug ?? v.landSite?.slug;
      if (!slug || !data.storyIndex.has(slug)) return;
      const story = await data.queryClient.fetchQuery(storyQuery(slug)).catch(() => null);
      if (!story || signal.aborted) return;
      const moments = story.saw?.moments ?? [];
      const date = v.shownDate;
      const shown = moments.find((m) => m.end === date) ?? moments.find((m) => date && date >= m.start && date <= m.end);
      const momentIndex = story.source === "site" ? shown?.index ?? story.hero_moment ?? 0 : null;
      openSaveFor(drafts.storyDraft({ story, moment: momentIndex == null ? null : moments[momentIndex], momentIndex }));
    },
  };
}

/** Every workspace action, for the layout, the URL, the tour and the panels. */
export function useWorkspaceActions(ws) {
  const layout = useLayoutActions(ws);
  const selection = selectionActions(ws, layout);
  const drafts = draftActions(ws);
  return {
    ...layout,
    ...selection,
    ...storyActions(ws, layout, selection),
    ...dateActions(ws, layout),
    ...drafts,
    ...saveActions(ws, drafts),
    // Nothing selected, the Stories list, the whole world: where the workspace starts.
    goHome: () => {
      layout.resetView();
      layout.cancelDraw();
      ws.ui.setOpenFinding(null);
    },
    // The Tour button ends a running tour, or starts one. Shift-click starts
    // demo mode, for presenting (full screen, Space to move on).
    onTourClick: (e) => {
      if (ws.tour.touring) ws.tour.end();
      else if (e.shiftKey) {
        document.documentElement.requestFullscreen?.().catch(() => {});
        ws.tour.startDemo();
      } else ws.tour.start();
    },
  };
}
