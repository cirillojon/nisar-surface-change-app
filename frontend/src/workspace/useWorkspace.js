// The map workspace's state and behaviour, put together for WorkspaceApp.
//
// `ws`, the object this returns, is built up in order each render: server
// data and state first, then the selection in detail, the actions, the tour,
// the catalog and the land player, then what the map and the evidence card
// show. Each part reads what it needs from `ws`; the actions read it when
// they run, so they can use parts set up after them.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useLandPlayer } from "../components/land/useLandPlayer.js";
import { LANGTANG, SYLHET } from "../components/tour/steps.js";
import { setWorkspaceContext } from "../platform/workspaceContext.js";
import { assetUrl } from "../services/api.js";
import { loadImage } from "../services/imageCache.js";
import { LAYERS, useLayerMapper } from "../services/layers.js";
import { useNotebook } from "../services/notebook.js";
import { findingQuery } from "../services/queries.js";
import { TOUR_BOX, TOUR_IMAGERY, TOUR_LINE, tourSeen } from "../services/tour.js";
import { useStableCallback } from "../services/useStableCallback.js";
import { siteQuery, useCatalog, useLandChange, useSite, useStories } from "./data/queries.js";
import { DEFAULT_MODE, findingParam, modeForPlace, modeFrom, parseFinding } from "./navigation.js";
import { useSelection } from "./state/selection.js";
import { useWorkspaceUrl } from "./state/useWorkspaceUrl.js";
import { useTour } from "./tour/useTour.js";
import { useAreaCatalog } from "./useAreaCatalog.js";
import { NARROW_LAYOUT, useWorkspaceActions } from "./useWorkspaceActions.js";
import { catalogTargetOf, mapViewOf, selectionOf, siteImagesOf } from "./workspaceView.js";

function matchComparison(comparison, passes) {
  if (!comparison || !passes) return null;
  const before = passes.findIndex((pass) => pass.date === comparison.from);
  const after = passes.findIndex((pass) => pass.date === comparison.to);
  return before >= 0 && after > before ? { ...comparison, before, after } : null;
}

/** Server data (data/queries.js): the catalog, the gallery and the stories, and lookups into them. */
function useWorkspaceData() {
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const landChange = useLandChange();
  const stories = useStories();
  const { changeTypes } = catalog;
  return {
    ...catalog,
    queryClient,
    landChange,
    stories,
    storyIndex: new Map((stories?.stories ?? []).map((st) => [st.slug, st])),
    changeTypeOf: (id) => changeTypes.find((ct) => ct.id === id),
    // SME2 backscatter is drawn like the GCOV (crop) sites, so reuse their legend.
    backscatterLegend: changeTypes.find((ct) => ct.product === "GCOV")?.image_legend,
  };
}

/**
 * The workspace's own state beside the selection: the panel, the tab, the
 * drawing tool, an open evidence card, the save dialog and its note, the map
 * overlay's opacity, where portals go, and the elements focus moves between.
 * The URL it opened on sets where it starts (see also useWorkspaceUrl).
 */
function useWorkspaceUi(searchParams) {
  const finding = searchParams.get("finding");
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  // An evidence card opened from a link must show even on a phone, where the panel otherwise starts closed.
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia(NARROW_LAYOUT).matches || Boolean(finding));
  // Drawing tool in use: null, "area" (rectangle) or "line" (height profile).
  const [drawing, setDrawing] = useState(null);
  const [timelineHost, setTimelineHost] = useState(null);
  // Where the map draws its drawing bar (instructions, Finish, Cancel).
  const [drawHost, setDrawHost] = useState(null);
  const [momentHost, setMomentHost] = useState(null);
  // Bumped to send the map back to the whole world (a back link, the default workspace).
  const [homeKey, setHomeKey] = useState(0);
  const [mode, setMode] = useState(() => modeFrom(searchParams.get("mode"), DEFAULT_MODE, { hasFinding: Boolean(finding) }));
  const [openFinding, setOpenFinding] = useState(() => parseFinding(finding));
  // The finding being saved, and the note after a save.
  const [saveDraft, setSaveDraft] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  return {
    overlayOpacity, setOverlayOpacity, panelOpen, setPanelOpen, drawing, setDrawing,
    timelineHost, setTimelineHost, drawHost, setDrawHost, momentHost, setMomentHost, homeKey, setHomeKey,
    mode, setMode, openFinding, setOpenFinding, saveDraft, setSaveDraft, savedNote, setSavedNote,
  };
}

/** The elements focus and scrolling move between. */
function useWorkspaceRefs() {
  return {
    sidebarRef: useRef(null),
    workspaceRef: useRef(null),
    mapTitleRef: useRef(null),
    mapFrameRef: useRef(null),
    evidenceRef: useRef(null),
    drawButtonRef: useRef(null),
    lineButtonRef: useRef(null),
    panelButtonRef: useRef(null),
  };
}

/** The guided tour and demo mode (tour/useTour.js), and what they ask of the workspace. */
function useWorkspaceTour(ws, searchParams) {
  const { act, data, sel, ui } = ws;
  return useTour({
    active: ws.active,
    // The tour opens on a first visit, not when someone arrives on a specific
    // place or evidence card from a link; ?demo=1 opens demo mode.
    initial: {
      touring: () => Boolean(searchParams.get("demo"))
        || !(tourSeen() || searchParams.get("site") || searchParams.get("place") || searchParams.get("finding")),
      demo: () => Boolean(searchParams.get("demo")),
    },
    workspace: {
      stopActivity: () => {
        act.cancelDraw();
        ui.setSaveDraft(null);
      },
      resetView: act.resetView,
      showInvestigate: (panel) => {
        ui.setMode("investigate");
        if (panel != null) ui.setPanelOpen(panel);
        else if (act.narrow()) ui.setPanelOpen(false);
      },
      actions: {
        // Demo mode's cards: the whole world, nothing selected, no panel.
        showWorld: () => {
          act.clearDrawing();
          ui.setOpenFinding(null);
          ui.setMode("investigate");
          ui.setPanelOpen(false);
          ui.setHomeKey((n) => n + 1);
        },
        // Start drawing a box ("area") or a line, as the Draw buttons do.
        draw: (tool) => {
          ui.setMode("investigate");
          ui.setDrawing(tool);
        },
        preloadDemo: () => preloadDemo(data),
        // Show this date of the land-change place on the map (its bar moves to it).
        focusLandDate: (date) => sel.setLandDates((d) => ({ ...d, to: date })),
        showList: () => {
          act.clearDrawing();
          ui.setOpenFinding(null);
          ui.setMode("stories");
          ui.setPanelOpen(true);
          ui.setHomeKey((n) => n + 1);
        },
        openStory: act.openStory,
        openShare: (open) => sel.setShareOpen(open),
        openSave: (signal) => {
          if (!ui.saveDraft) act.saveShownStoryMoment(signal);
        },
        closeSave: () => ui.setSaveDraft(null),
        openNotebook: () => {
          ui.setMode("mine");
          ui.setPanelOpen(true);
        },
        setScene: (scene) => setTourScene(ws, scene),
      },
    },
  });
}

/**
 * Fetch every frame demo mode shows (Kīlauea, Sylhet, Langtang) ahead of time,
 * so each timelapse plays at its own pace instead of waiting on downloads.
 */
function preloadDemo(data) {
  const urls = [
    ...(data.landChange?.imagery?.[TOUR_IMAGERY]?.passes ?? []).map((p) => p.image_url),
    ...(data.landChange?.sites?.find((x) => x.slug === LANGTANG)?.passes ?? []).map((p) => p.image_url),
  ];
  urls.forEach((u) => loadImage(assetUrl(u)));
  const sylhet = data.sites.find((x) => x.slug === SYLHET);
  if (!sylhet) return;
  // Through the cache, so opening Sylhet later in the demo is instant.
  data.queryClient
    .fetchQuery(siteQuery(sylhet.id))
    .then((s) => (s.scenes ?? []).forEach((scene) => scene.image_url && loadImage(assetUrl(scene.image_url))))
    .catch(() => {});
}

/**
 * Back in the tour: put the map as the step expects. A scene that's already
 * showing is left alone: redrawing the same box would clear its search
 * results without searching again.
 */
function setTourScene(ws, scene) {
  const { act, v } = ws;
  if (scene === "area") {
    if (v.aoi?.bbox === TOUR_BOX && !v.profileLine) act.cancelDraw();
    else act.selectArea(TOUR_BOX);
  } else if (scene === "line") {
    if (v.profileLine === TOUR_LINE) act.cancelDraw();
    else act.selectLine(TOUR_LINE);
  } else {
    act.clearDrawing();
  }
}

/**
 * Apply a navigation to the workspace: what its URL asks for. A link that
 * names a place but no tab moves off My findings (it has no view of a
 * place); a finding link keeps its card in view.
 */
function followUrl(ws, request, { pop, home }) {
  const { act, data, ui, v, sel } = ws;
  // The top bar's Workspace link, clicked while already here, goes to the
  // default workspace. (Arriving from another page keeps what was open.)
  if (home) {
    if (!ws.tour.touring) act.goHome();
    return;
  }
  const showLinkedPlace = (slug) => {
    if (!request.mode) ui.setMode((m) => (m === "mine" ? modeForPlace(m, data.storyIndex.has(slug)) : m));
    if (request.finding) ui.setPanelOpen(true);
  };
  // A tab (an old `mode=findings` link opens Stories or My findings).
  if (request.mode) ui.setMode((m) => modeFrom(request.mode, m, { hasFinding: Boolean(request.finding) }));
  // An evidence card.
  if (request.finding && findingParam(ui.openFinding) !== request.finding) {
    ui.setOpenFinding(parseFinding(request.finding));
    ui.setMode("stories");
    ui.setPanelOpen(true);
  }
  // Back or Forward to a URL without a place or finding: close what is
  // open, so the panel shows the list the URL describes.
  if (pop && !request.site && !request.place && (v.selectedSiteId != null || v.landSlug)) act.clearDrawing();
  if (pop && !request.finding && ui.openFinding) ui.setOpenFinding(null);
  // A gallery place; only places with passes open (a "checked, nothing visible" place has no images).
  const place = request.place && data.landChange?.sites.find((p) => p.slug === request.place && p.passes?.length);
  if (place) {
    if (place.slug !== v.landSlug) {
      act.selectLandChange(place.slug);
      showLinkedPlace(place.slug);
    }
    const comparison = matchComparison(request.comparison, place.passes);
    sel.setComparison(comparison);
    if (comparison) {
      const { from, to, layer, before, after } = comparison;
      sel.setLandDates({ from, to });
      if (layer === "change") {
        sel.setLandLayer(place.passes[before].hh_url && place.passes[after].hh_url ? "change" : "hh");
      } else {
        sel.setLandLayer(Object.hasOwn(LAYERS, layer) ? layer : null);
      }
    }
  }
  // A study site, by slug or id, on a date.
  const linked = request.site && data.sites.find((s) => s.slug === request.site || String(s.id) === request.site);
  const date = request.comparison?.to ?? request.date;
  if (linked && linked.id === v.selectedSiteId) {
    const index = date && v.site ? v.site.scenes?.findIndex((x) => x.date === date) ?? -1 : -1;
    if (index >= 0) sel.setSceneIndex(index);
    else if (date && !v.site) sel.setPendingDate(date);
    if (request.comparison) {
      sel.setKeepDate(true);
      sel.setCatalogOpen(false);
    }
  } else if (linked) {
    act.selectSite(linked.id);
    sel.setPendingDate(date);
    sel.setKeepDate(Boolean(date));
    showLinkedPlace(linked.slug);
  }
  if (linked) sel.setComparison(request.comparison);
  // ?demo=1 (the search menu's "Demo mode"); the URL then drops it.
  if (request.demo && !ws.tour.demo) ws.tour.startDemo();
}

/** The URL (state/useWorkspaceUrl.js): links, Back / Forward, the top bar. */
function useWorkspaceNavigation(ws) {
  const { data, ui, v, sel } = ws;
  useWorkspaceUrl({
    active: ws.active,
    // A link waits for the site list (and keeps its address if the list
    // can't be had: the backend may only be starting).
    ready: { sites: !data.loading && !data.error, places: data.landChange != null },
    // A site is in the URL from the moment it is picked: its date once its
    // passes arrive (until then, the date it was asked for).
    view: {
      mode: ui.mode,
      site: data.sites.find((s) => s.id === v.selectedSiteId)?.slug ?? null,
      date: v.site ? v.shownDate : sel.pendingDate,
      place: v.landSlug,
      finding: ui.openFinding,
      comparison: v.site ? ws.images.comparison : sel.comparison,
    },
    onNavigate: (request, how) => followUrl(ws, request, how),
  });
}

/**
 * Side effects of what is shown: an open evidence card's place goes on the
 * map, the saved note fades, a phone scrolls the whole map into view while
 * drawing, and the AI assistant hears what is on screen.
 */
function useWorkspaceEffects(ws) {
  const { data, ui, refs, act, v } = ws;
  // The open evidence card's finding (shared with the card through the
  // query cache) goes on the map once it and the site list have loaded.
  const { data: openFindingData } = useQuery(findingQuery(ui.openFinding?.slug, ui.openFinding?.moment ?? null));
  const showOpenFinding = useStableCallback((finding) => act.showFindingOnMap(finding, { focusMap: false }));
  useEffect(() => {
    if (openFindingData && !data.loading) showOpenFinding(openFindingData);
  }, [openFindingData, data.loading, showOpenFinding]);

  const { savedNote, setSavedNote } = ui;
  useEffect(() => {
    if (!savedNote) return undefined;
    const timer = setTimeout(() => setSavedNote(null), 6000);
    return () => clearTimeout(timer);
  }, [savedNote, setSavedNote]);

  // On a phone the map is taller than the space left under the header: bring
  // all of it into view while drawing, so the bar at its foot can be seen.
  const { drawing } = ui;
  const { mapFrameRef } = refs;
  useEffect(() => {
    if (drawing && window.matchMedia(NARROW_LAYOUT).matches) mapFrameRef.current?.scrollIntoView?.({ block: "end" });
  }, [drawing, mapFrameRef]);

  const { site, shownDate, aoi, profileLine, landSlug } = v;
  const { mode, openFinding } = ui;
  useEffect(() => {
    setWorkspaceContext({
      site: site ? { id: site.id, slug: site.slug, name: site.name, change_type: site.change_type, product: site.product, bbox: site.bbox } : null,
      date: shownDate,
      area: aoi ? { bbox: aoi.bbox, drawn: Boolean(aoi.drawn) } : null,
      profileLine: profileLine ?? null,
      landChange: landSlug,
      mode,
      finding: openFinding,
    });
  }, [site, shownDate, aoi, profileLine, landSlug, mode, openFinding]);
}

/** A study site's pass on the map, in the image layer chosen. */
function useSiteImages(ws) {
  const { siteLayers, items } = siteImagesOf(ws.v.site, ws.v.scene);
  const { site } = ws.v;
  const { comparison: request, siteLayer, setSiteLayer } = ws.sel;
  const comparison = useMemo(() => matchComparison(request, site?.scenes), [request, site]);
  const linkedLayer = siteLayers?.find(({ id, disabled }) => !disabled && id === comparison?.layer)?.id;
  useEffect(() => {
    if (linkedLayer) setSiteLayer(linkedLayer);
  }, [comparison, linkedLayer, setSiteLayer]);
  const mapSiteUrl = useLayerMapper(siteLayers ? siteLayer : "colour", items);
  return { siteLayers, mapSiteUrl, comparison };
}

/**
 * The map workspace, as one object (see the top of this file). `active`
 * says whether it is the page shown.
 */
export function useWorkspace(active) {
  const [searchParams] = useSearchParams();
  const ws = { active };
  ws.data = useWorkspaceData();
  // What is selected, and how it is viewed (state/selection.js): at most one
  // target whose view settings all start afresh with each new selection.
  const [selection, selectionActions] = useSelection({ keepDate: Boolean(searchParams.get("date")) });
  ws.sel = { ...selection, ...selectionActions };
  ws.ui = useWorkspaceUi(searchParams);
  ws.refs = useWorkspaceRefs();
  ws.notebook = useNotebook();
  const selectedSiteId = selection.target?.kind === "site" ? selection.target.id : null;
  // The selected site as fetched (null until its passes arrive; keyed by
  // site, so an answer for an earlier pick never shows), and another try.
  ws.siteQuery = useSite(selectedSiteId);
  ws.v = selectionOf({ sel: ws.sel, site: ws.siteQuery.data, siteError: ws.siteQuery.error, data: ws.data, mode: ws.ui.mode, openFinding: ws.ui.openFinding });
  ws.act = useWorkspaceActions(ws);
  ws.tour = useWorkspaceTour(ws, searchParams);
  ws.catalog = useAreaCatalog({
    target: catalogTargetOf({ v: ws.v, data: ws.data, catalogOpen: selection.catalogOpen, touring: ws.tour.touring }),
    search: selection.search,
    explorer: selection.explorer,
    setSearch: ws.sel.setSearch,
    setExplorer: ws.sel.setExplorer,
    opacity: ws.ui.overlayOpacity,
    backscatterLegend: ws.data.backscatterLegend,
  });
  // A gallery place's player, or the tour's box played like one: the dates
  // compared, the layer, the change map and the image on the map.
  ws.land = useLandPlayer({
    site: ws.v.tourPlace ?? ws.v.landSite,
    dbRange: ws.data.landChange?.db_range,
    dates: selection.landDates,
    layer: selection.landLayer,
    removeShift: selection.landShift,
    setDates: ws.sel.setLandDates,
  });
  ws.images = useSiteImages(ws);
  ws.map = mapViewOf({ ...ws, ...ws.images, opacity: ws.ui.overlayOpacity });
  useWorkspaceNavigation(ws);
  useWorkspaceEffects(ws);
  return ws;
}
