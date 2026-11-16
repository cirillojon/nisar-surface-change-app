import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import ChangeMap from "../components/ChangeMap.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import ImpactChain from "../components/ImpactChain.jsx";
import SaveFindingDialog from "../components/SaveFindingDialog.jsx";
import SidebarResizer from "../components/SidebarResizer.jsx";
import DemoTour from "../components/tour/DemoTour.jsx";
import Tour from "../components/tour/Tour.jsx";
import DrawTools from "./components/DrawTools.jsx";
import MapHeader from "./components/MapHeader.jsx";
import ModeTabs from "./components/ModeTabs.jsx";
import PanelLists from "./components/PanelLists.jsx";
import SaveToast from "./components/SaveToast.jsx";
import SelectionDetails from "./components/SelectionDetails.jsx";
import TimelineDock from "./components/TimelineDock.jsx";
import { LANGTANG, SYLHET } from "../components/tour/steps.js";
import { setWorkspaceContext } from "../platform/workspaceContext.js";
import { TOUR_BOX, TOUR_IMAGERY, TOUR_LINE, tourSeen } from "../services/tour.js";
import { assetUrl } from "../services/api.js";
import { findingQuery, storyQuery } from "../services/queries.js";
import { siteQuery, useCatalog, useLandChange, useSite, useStories } from "./data/queries.js";
import { defaultSceneIndex, useSelection } from "./state/selection.js";
import { useWorkspaceUrl } from "./state/useWorkspaceUrl.js";
import { useAreaCatalog } from "./useAreaCatalog.js";
import { useLandPlayer } from "../components/land/useLandPlayer.js";
import { CatalogContext } from "../components/catalog/CatalogContext.js";
import { useTour } from "./tour/useTour.js";
import { loadImage } from "../services/imageCache.js";
import { imageLayerOptions, layerLegend, useLayerMapper } from "../services/layers.js";
import { siteSeries } from "../services/measurements.js";
import { useNotebook } from "../services/notebook.js";
import { useStableCallback } from "../services/useStableCallback.js";
import {
  momentDraft as buildMomentDraft,
  placeDraft as buildPlaceDraft,
  viewDraft as buildViewDraft,
} from "./drafts.js";
import { aoiAround, footprintOverlay as buildFootprintOverlay, profileLayers } from "./mapLayers.js";
import {
  DEFAULT_MODE,
  findingParam,
  modeForPlace,
  modeFrom,
  panelView,
  parseFinding,
} from "./navigation.js";

const NARROW_LAYOUT = "(max-width: 760px)";

// The map workspace. The platform keeps it mounted while docs pages are
// shown (platform/WorkspaceHost.jsx) so the map and selection survive a
// trip to the docs. `active` says whether it is the visible route; only
// then does it read and write `?site=<slug>&date=<YYYY-MM-DD>` in the URL.
export default function WorkspaceApp({ active = true }) {
  // The URL the workspace opened on sets where it starts (see also useWorkspaceUrl).
  const [searchParams] = useSearchParams();
  // Server data (data/queries.js): the catalog, the gallery and the stories.
  const queryClient = useQueryClient();
  const { changeTypes, products, sites, loading, error } = useCatalog();
  const landChange = useLandChange();
  const stories = useStories();
  // What is selected, and how it is viewed (state/selection.js): at most one
  // target (a study site, a gallery place, an area or a profile line) whose
  // view settings all start afresh with each new selection.
  const [selection, {
    select,
    clear,
    setSceneIndex,
    setPendingDate,
    setKeepDate,
    setSiteLayer,
    setLandLayer,
    setLandDates,
    setLandShift,
    setCatalogOpen,
    setSearch,
    setExplorer,
    setEvidenceOpen,
    setShareOpen,
  }] = useSelection({ keepDate: Boolean(searchParams.get("date")) });
  const {
    target,
    pendingDate,
    keepDate,
    siteLayer,
    landLayer,
    landDates,
    landShift,
    catalogOpen,
    search,
    explorer,
    evidenceOpen,
    shareOpen,
  } = selection;
  const selectedSiteId = target?.kind === "site" ? target.id : null;
  const landSlug = target?.kind === "place" ? target.slug : null;
  const aoi = target?.kind === "area" ? target.aoi : null;
  const profileLine = target?.kind === "line" ? target.line : null;
  // The selected site as fetched (null until its passes arrive; the query is
  // keyed by site, so an answer for an earlier pick never shows), why it
  // couldn't be (cleared while trying again), and another try.
  const { data: site, error: siteError, retry: retrySite } = useSite(selectedSiteId);
  // The pass shown: the one picked, else the date asked for (a link, a
  // finding), else the latest.
  const sceneIndex = selection.sceneIndex ?? defaultSceneIndex(site, pendingDate);
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  // Is the side panel showing? What it holds follows the tab and the
  // selection (navigation.js). An evidence card opened from a link must
  // show even on a phone, where the panel otherwise starts closed.
  const [panelOpen, setPanelOpen] = useState(
    () => !window.matchMedia(NARROW_LAYOUT).matches || Boolean(searchParams.get("finding")),
  );
  // Drawing tool in use: null, "area" (rectangle) or "line" (height profile).
  const [drawing, setDrawing] = useState(null);
  const [timelineHost, setTimelineHost] = useState(null);
  // Where the map draws its drawing bar (instructions, Finish, Cancel).
  const [drawHost, setDrawHost] = useState(null);
  // Bumped to send the map back to the whole world (a back link, the default workspace).
  const [homeKey, setHomeKey] = useState(0);
  const [momentHost, setMomentHost] = useState(null);
  const sidebarRef = useRef(null);
  const workspaceRef = useRef(null);
  const mapTitleRef = useRef(null);
  const mapFrameRef = useRef(null);
  const evidenceRef = useRef(null);
  const drawButtonRef = useRef(null);
  const lineButtonRef = useRef(null);
  const panelButtonRef = useRef(null);
  const [mode, setMode] = useState(() =>
    modeFrom(searchParams.get("mode"), DEFAULT_MODE, { hasFinding: Boolean(searchParams.get("finding")) }));
  const [openFinding, setOpenFinding] = useState(() => parseFinding(searchParams.get("finding")));
  // My findings (this browser), the finding being saved, and the note after a save.
  const notebook = useNotebook();
  const [saveDraft, setSaveDraft] = useState(null);
  const [savedNote, setSavedNote] = useState(null);

  // Nothing selected (the reducer resets the view with it).
  const clearSelection = clear;

  const narrow = () => window.matchMedia(NARROW_LAYOUT).matches;
  const cancelDraw = useCallback(() => setDrawing(null), []);
  const stopDraw = useCallback(() => {
    const button = drawing === "line" ? lineButtonRef : drawButtonRef;
    cancelDraw();
    button.current?.focus({ preventScroll: true });
  }, [cancelDraw, drawing]);
  const toggleDraw = (tool = "area") => {
    if (drawing !== tool) {
      setMode("investigate");
      if (narrow()) setPanelOpen(false);
      else workspaceRef.current?.scrollTo({ top: 0 });
    }
    setDrawing((current) => (current === tool ? null : tool));
  };
  // On a phone the map is taller than the space left under the header. Bring
  // all of it into view while drawing, so the bar at its foot (what to do,
  // Finish, Cancel) can be seen.
  useEffect(() => {
    if (drawing && window.matchMedia(NARROW_LAYOUT).matches) mapFrameRef.current?.scrollIntoView?.({ block: "end" });
  }, [drawing]);
  // Something was selected: show its panel beside the map, or on a phone
  // (where the panel would cover the map) the map itself.
  const revealSelection = () => {
    if (sidebarRef.current?.contains(document.activeElement)) {
      mapTitleRef.current?.focus({ preventScroll: true });
    }
    if (narrow()) {
      setPanelOpen(false);
      mapTitleRef.current?.scrollIntoView({ block: "nearest" });
    } else {
      setPanelOpen(true);
      workspaceRef.current?.scrollTo({ top: 0 });
    }
  };

  // A panel's back link: nothing selected, this tab's list, the whole world.
  const backToList = () => {
    clearSelection();
    cancelDraw();
    setPanelOpen(true);
    setHomeKey((n) => n + 1);
    panelButtonRef.current?.focus({ preventScroll: true });
    if (narrow()) window.scrollTo({ top: 0, behavior: "instant" });
  };

  const selectSite = (id) => {
    if (id !== selectedSiteId) {
      select({ kind: "site", id });
    } else if (siteError) {
      retrySite();
    }
    setEvidenceOpen(true);
    cancelDraw();
    revealSelection();
  };

  const selectPoint = ({ latitude, longitude }) => {
    setMode("investigate");
    select({ kind: "area", aoi: aoiAround(latitude, longitude) });
    revealSelection();
  };

  // A rectangle drawn with the map's draw tool.
  const selectArea = (drawn) => {
    // The tours draw only at Kīlauea, so during one any box becomes the
    // suggested box: the sharp imagery rendered for it then plays, never
    // NASA's coarse browse images of whole orbit frames (which differ in
    // size from pass to pass).
    const snapped = touring ? TOUR_BOX : null;
    const bbox = snapped ?? drawn;
    setMode("investigate");
    select({
      kind: "area",
      aoi: {
        latitude: (bbox[1] + bbox[3]) / 2,
        longitude: (bbox[0] + bbox[2]) / 2,
        bbox,
        drawn: true,
        imagery: snapped ? TOUR_IMAGERY : null,
      },
    });
    cancelDraw();
    revealSelection();
  };

  const selectLandChange = (slug) => {
    select({ kind: "place", slug });
    cancelDraw();
    revealSelection();
  };

  // Stories: a story is a study site or a gallery place with a question.
  const storyIndex = new Map((stories?.stories ?? []).map((st) => [st.slug, st]));
  const selectStory = (story) => {
    if (story.source === "site") {
      const target = sites.find((s) => s.slug === story.slug);
      if (target) selectSite(target.id);
    } else {
      selectLandChange(story.slug);
    }
  };
  // A marker on the map opens its place in a tab that has a view of it.
  const openFromMap = (slug, select) => {
    setMode(modeForPlace(mode, storyIndex.has(slug)));
    select();
  };
  const selectSiteOnMap = (id) => openFromMap(sites.find((s) => s.id === id)?.slug, () => selectSite(id));
  const selectPlaceOnMap = (slug) => openFromMap(slug, () => selectLandChange(slug));
  const openFindingCard = (ref) => {
    setOpenFinding(ref ? { slug: ref.slug, moment: ref.moment ?? null, title: ref.title, label: ref.label } : null);
    setShareOpen(false);
    if (ref) {
      setMode("stories");
      setPanelOpen(true);
    }
  };
  // Put a finding's place and pass on the map. An open card's place goes on
  // the map by itself (`focusMap: false`, so the card stays in view on a
  // phone); the card's "Show on map" button also brings the map forward.
  const showFindingOnMap = (finding, { focusMap = true } = {}) => {
    if (finding.story.source === "site") {
      const target = sites.find((s) => s.slug === finding.site.slug);
      if (!target) return;
      if (target.id === selectedSiteId) {
        const i = site?.id === target.id ? site.scenes?.findIndex((x) => x.date === finding.claim.end) ?? -1 : -1;
        if (i >= 0) setSceneIndex(i);
        // The site is still loading: apply the date when it arrives.
        else setPendingDate(finding.claim.end);
        setKeepDate(true);
      } else {
        select({ kind: "site", id: target.id }, { pendingDate: finding.claim.end, keepDate: true });
      }
    } else if (finding.site.slug !== landSlug) {
      select({ kind: "place", slug: finding.site.slug });
    }
    cancelDraw();
    if (focusMap && narrow()) {
      setPanelOpen(false);
      mapTitleRef.current?.scrollIntoView({ block: "nearest" });
    }
  };
  // The open evidence card's finding (shared with the card through the
  // query cache) goes on the map once it and the site list have loaded.
  const { data: openFindingData } = useQuery(findingQuery(openFinding?.slug, openFinding?.moment ?? null));
  const showOpenFinding = useStableCallback((finding) => showFindingOnMap(finding, { focusMap: false }));
  useEffect(() => {
    if (openFindingData && !loading) showOpenFinding(openFindingData);
  }, [openFindingData, loading, showOpenFinding]);

  // A line drawn with the line tool: height profile over time.
  const selectLine = (line) => {
    // Likewise any line drawn during a tour becomes the suggested one (its
    // result ships with the app, so it opens at once).
    const snapped = touring ? TOUR_LINE : null;
    setMode("investigate");
    tour.setSnapped(Boolean(snapped));
    select({ kind: "line", line: snapped ?? line });
    cancelDraw();
    revealSelection();
  };

  // ── Opening a story, a saved finding (and the tour's steps) ──
  // A curated story by slug, on a date and layer. Opening the one already
  // shown only moves its date and layer, so its chart and story stay put.
  const openStory = (slug, { date = null, layer = null, panel = null } = {}) => {
    const story = storyIndex.get(slug);
    cancelDraw();
    setOpenFinding(null);
    setMode("stories");
    setPanelOpen(panel ?? !narrow());
    if (!story || story.source === "site") {
      const target = sites.find((s) => s.slug === slug);
      if (!target) return;
      if (target.id === selectedSiteId) {
        const i = date && site?.id === target.id ? site.scenes?.findIndex((x) => x.date === date) ?? -1 : -1;
        if (i >= 0) setSceneIndex(i);
        else if (date) setPendingDate(date);
      } else {
        select({ kind: "site", id: target.id }, { pendingDate: date });
      }
      setKeepDate(Boolean(date));
      if (layer) setSiteLayer(layer);
    } else {
      if (slug !== landSlug) {
        select({ kind: "place", slug });
      }
      setLandLayer(layer);
      if (date) setLandDates((d) => ({ ...d, to: date }));
    }
  };

  // Put a saved finding back on the map: its place, date and layer.
  const showSavedFinding = (finding) => {
    const v = finding.view ?? {};
    if (v.site) {
      openStory(v.site, { date: v.date, layer: v.layer, panel: !narrow() });
      if (!storyIndex.has(v.site)) setMode("investigate");
    } else if (v.place) {
      openStory(v.place, { layer: v.layer, panel: !narrow() });
      if (!storyIndex.has(v.place)) setMode("investigate");
    } else if (v.bbox) {
      selectArea(v.bbox);
    } else if (v.line) {
      selectLine(v.line);
    }
    if (narrow()) mapTitleRef.current?.scrollIntoView({ block: "nearest" });
  };

  // ── Saving: what the viewer saves, and what the app showed at the time ──
  // The drafts themselves are built in drafts.js from what is shown here.
  // A curated story's moment (from its panel, its chart or the tour).
  const momentDraft = (storyTitle, moment, index) =>
    buildMomentDraft({ site, changeType: changeTypeOf(site?.change_type), siteLayer, storyTitle, moment, index });
  // A gallery place's story or view: the two dates its change map compares.
  const placeDraft = (kind) =>
    buildPlaceDraft({ place: landSite, kind, layer: landLayer, dates: land.compared, story: landSite && storyIndex.get(landSite.slug) });
  // Whatever is on the map now ("Save view").
  const viewDraft = () =>
    buildViewDraft({
      place: landSite,
      placeLayer: landLayer,
      placeDates: land.compared,
      placeStory: landSite && storyIndex.get(landSite.slug),
      site,
      scene,
      changeType: changeTypeOf(site?.change_type),
      siteLayer,
      siteHasStory: Boolean(site && storyIndex.has(site.slug)),
      profileLine,
      aoi,
      areaSeries,
    });
  // A story's own moment (its "Save / share"), from the moment on the map.
  const storyDraft = ({ story, moment, momentIndex }) =>
    story.source === "site" ? moment && momentDraft(story.title, moment, momentIndex) : placeDraft("moment");
  const openSaveFor = (draft) => {
    if (!draft) return;
    setShareOpen(false);
    setSaveDraft(draft);
  };
  const commitSave = (finding, { storyId, newStory }) => {
    const target = newStory ? notebook.createStory(newStory) : storyId;
    notebook.saveFinding(finding, { storyId: target });
    setSaveDraft(null);
    setSavedNote(finding.title);
  };
  useEffect(() => {
    if (!savedNote) return undefined;
    const timer = setTimeout(() => setSavedNote(null), 6000);
    return () => clearTimeout(timer);
  }, [savedNote]);
  // Save the moment of the story on the map (the tour's notes step, when it
  // is entered without the menu): fetched like its panel does (cached).
  const saveShownStoryMoment = async (signal) => {
    const slug = site?.slug ?? landSite?.slug;
    if (!slug || !storyIndex.has(slug)) return;
    const story = await queryClient.fetchQuery(storyQuery(slug)).catch(() => null);
    if (!story || signal.aborted) return;
    const moments = story.saw?.moments ?? [];
    const date = site?.scenes?.[sceneIndex]?.date;
    const shown = moments.find((m) => m.end === date) ?? moments.find((m) => date && date >= m.start && date <= m.end);
    const momentIndex = story.source === "site" ? shown?.index ?? story.hero_moment ?? 0 : null;
    openSaveFor(storyDraft({ story, moment: momentIndex == null ? null : moments[momentIndex], momentIndex }));
  };

  // ── The guided tour and demo mode (tour/useTour.js) ──
  // The default workspace: Stories, nothing selected, the whole world.
  const resetView = () => {
    clearSelection();
    setMode(DEFAULT_MODE);
    setPanelOpen(!narrow());
    setHomeKey((n) => n + 1);
  };
  const tour = useTour({
    active,
    // The tour opens on a first visit, not when someone arrives on a specific
    // place or evidence card from a link; ?demo=1 opens demo mode.
    initial: {
      touring: () => Boolean(searchParams.get("demo"))
        || !(tourSeen() || searchParams.get("site") || searchParams.get("place") || searchParams.get("finding")),
      demo: () => Boolean(searchParams.get("demo")),
    },
    workspace: {
      stopActivity: () => {
        cancelDraw();
        setSaveDraft(null);
      },
      resetView,
      showInvestigate: (panel) => {
        setMode("investigate");
        if (panel != null) setPanelOpen(panel);
        else if (narrow()) setPanelOpen(false);
      },
      actions: {
        // Demo mode's cards: the whole world, nothing selected, no panel.
        showWorld: () => {
          clearSelection();
          cancelDraw();
          setOpenFinding(null);
          setMode("investigate");
          setPanelOpen(false);
          setHomeKey((n) => n + 1);
        },
        // Start drawing a box ("area") or a line, as the Draw buttons do.
        draw: (tool) => {
          setMode("investigate");
          setDrawing(tool);
        },
        // Fetch every frame demo mode shows (Kīlauea, Sylhet, Langtang) ahead of time,
        // so each timelapse plays at its own pace instead of waiting on downloads.
        preloadDemo: () => {
          const urls = [
            ...(landChange?.imagery?.[TOUR_IMAGERY]?.passes ?? []).map((p) => p.image_url),
            ...(landChange?.sites?.find((x) => x.slug === LANGTANG)?.passes ?? []).map((p) => p.image_url),
          ];
          urls.forEach((u) => loadImage(assetUrl(u)));
          const sylhet = sites.find((x) => x.slug === SYLHET);
          if (sylhet) {
            // Through the cache, so opening Sylhet later in the demo is instant.
            queryClient
              .fetchQuery(siteQuery(sylhet.id))
              .then((s) => (s.scenes ?? []).forEach((scene) => scene.image_url && loadImage(assetUrl(scene.image_url))))
              .catch(() => {});
          }
        },
        // Show this date of the land-change place on the map (its bar moves to it).
        focusLandDate: (date) => setLandDates((d) => ({ ...d, to: date })),
        showList: () => {
          clearSelection();
          cancelDraw();
          setOpenFinding(null);
          setMode("stories");
          setPanelOpen(true);
          setHomeKey((n) => n + 1);
        },
        openStory,
        openShare: (open) => setShareOpen(open),
        openSave: (signal) => {
          if (!saveDraft) saveShownStoryMoment(signal);
        },
        closeSave: () => setSaveDraft(null),
        openNotebook: () => {
          setMode("mine");
          setPanelOpen(true);
        },
        // Back in the tour: put the map as the step expects. A scene that's
        // already showing is left alone: redrawing the same box would clear its
        // search results without searching again.
        setScene: (scene) => {
          if (scene === "area") {
            if (aoi?.bbox === TOUR_BOX && !profileLine) cancelDraw();
            else selectArea(TOUR_BOX);
          } else if (scene === "line") {
            if (profileLine === TOUR_LINE) cancelDraw();
            else selectLine(TOUR_LINE);
          } else {
            clearSelection();
            cancelDraw();
          }
        },
      },
    },
  });
  const { touring, demo, demoView } = tour;

  const changeTypeOf = (id) => changeTypes.find((ct) => ct.id === id);

  // Nothing selected, the Stories list, the whole world: where the workspace starts.
  const goHome = () => {
    resetView();
    cancelDraw();
    setOpenFinding(null);
  };
  // ── The URL (state/useWorkspaceUrl.js): links, Back / Forward, the top bar ──
  // A link that names a place but no tab: My findings has no view of a
  // place, so move to a tab that does. A finding link keeps its card in view.
  const showLinkedPlace = (slug, request) => {
    if (!request.mode) setMode((m) => (m === "mine" ? modeForPlace(m, storyIndex.has(slug)) : m));
    if (request.finding) setPanelOpen(true);
  };
  // Apply a navigation to the workspace: what its URL asks for.
  const followUrl = (request, { pop, home }) => {
    // The top bar's Workspace link, clicked while already here, goes to the
    // default workspace. (Arriving from another page keeps what was open.)
    if (home) {
      if (!touring) goHome();
      return;
    }
    // A tab (an old `mode=findings` link opens Stories or My findings).
    if (request.mode) setMode((m) => modeFrom(request.mode, m, { hasFinding: Boolean(request.finding) }));
    // An evidence card.
    if (request.finding && findingParam(openFinding) !== request.finding) {
      setOpenFinding(parseFinding(request.finding));
      setMode("stories");
      setPanelOpen(true);
    }
    // Back or Forward to a URL without a place or finding: close what is
    // open, so the panel shows the list the URL describes.
    if (pop) {
      if (!request.site && !request.place && (selectedSiteId != null || landSlug)) {
        clearSelection();
        cancelDraw();
      }
      if (!request.finding && openFinding) setOpenFinding(null);
    }
    // A gallery place; only places with passes open (a "checked, nothing
    // visible" place has no images).
    if (request.place && request.place !== landSlug
      && landChange?.sites.some((p) => p.slug === request.place && p.passes?.length)) {
      selectLandChange(request.place);
      showLinkedPlace(request.place, request);
    }
    // A study site, by slug or id, on a date.
    const linked = request.site && sites.find((s) => s.slug === request.site || String(s.id) === request.site);
    if (linked && linked.id === selectedSiteId) {
      const index = request.date && site ? site.scenes?.findIndex((x) => x.date === request.date) ?? -1 : -1;
      if (index >= 0) setSceneIndex(index);
      else if (request.date && !site) setPendingDate(request.date);
    } else if (linked) {
      selectSite(linked.id);
      setPendingDate(request.date);
      setKeepDate(Boolean(request.date));
      showLinkedPlace(linked.slug, request);
    }
    // ?demo=1 (the search menu's "Demo mode"); the URL then drops it.
    if (request.demo && !demo) tour.startDemo();
  };
  const shownDate = site?.scenes?.[sceneIndex]?.date ?? null;
  useWorkspaceUrl({
    active,
    ready: { sites: !loading, places: landChange != null },
    // A site is in the URL from the moment it is picked: its date once its
    // passes arrive (until then, the date it was asked for).
    view: {
      mode,
      site: sites.find((s) => s.id === selectedSiteId)?.slug ?? null,
      date: site ? shownDate : pendingDate,
      place: landSlug,
      finding: openFinding,
    },
    onNavigate: followUrl,
  });

  // What the AI assistant knows about the current view.
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
  // Closing a site's catalog drops its search; opening it again starts afresh.
  const toggleCatalog = (open) => {
    setCatalogOpen(open);
    if (open) return;
    setSearch(null);
    setExplorer(null);
  };
  const returnToStudy = () => {
    toggleCatalog(false);
    mapTitleRef.current?.focus({ preventScroll: true });
  };
  const granuleProps = {
    products,
    onBack: backToList,
    overlayOpacity,
    onOverlayOpacityChange: setOverlayOpacity,
    timelineHost,
  };
  // SME2 backscatter is drawn like the GCOV (crop) sites, so reuse their legend.
  const backscatterLegend = changeTypes.find((ct) => ct.product === "GCOV")?.image_legend;
  // The tours' Kīlauea box plays its own imagery (no catalog search).
  const aoiImagery = aoi?.imagery ? landChange?.imagery?.[aoi.imagery] ?? null : null;
  // The NISAR catalog over a drawn area, or a study site's while it is open.
  let catalogTarget = null;
  if (aoi && !aoiImagery) {
    // The tour's steps are for backscatter only.
    catalogTarget = { bbox: aoi.bbox, defaultProduct: changeTypes[0]?.product ?? "GCOV", imagery: null, lockedProduct: touring ? "GCOV" : null };
  } else if (site && catalogOpen) {
    catalogTarget = { bbox: site.bbox, defaultProduct: changeTypeOf(site.change_type)?.product ?? "GCOV", imagery: null, lockedProduct: null };
  }
  const catalog = useAreaCatalog({
    target: catalogTarget,
    search,
    explorer,
    setSearch,
    setExplorer,
    opacity: overlayOpacity,
    backscatterLegend,
  });
  const regionLayers = catalog.mapLayers;
  const areaSeries = catalog.observation;

  const landSite = landSlug
    ? landChange?.sites.find((s) => s.slug === landSlug)
    : null;
  // A study site that was just picked, from its list row, until its passes arrive.
  const pendingSite = selectedSiteId !== null && !site ? sites.find((s) => s.id === selectedSiteId) ?? null : null;

  // In Stories, a site or place with a story shows that story, its data panel inside.
  const story = storyIndex.get(site?.slug ?? pendingSite?.slug ?? landSite?.slug) ?? null;
  const activeStory = mode === "stories" && !siteError ? story : null;

  // The tours' Kīlauea box, drawn on its own imagery: each pass stretched
  // exactly to the box, so every frame lines up with the outline.
  const tourImagery = aoi?.imagery ? landChange?.imagery?.[aoi.imagery] ?? null : null;
  // It opens on the first pass, so the timelapse runs forward from the start.
  const firstPass = tourImagery?.passes?.[0]?.date;
  const tourPlace = tourImagery ? { ...tourImagery, bbox: aoi.bbox, suggested: [firstPass, firstPass] } : null;

  // A gallery place's player, or the tour's box played like one: the dates
  // compared, the layer, the change map and the image on the map.
  const land = useLandPlayer({
    site: tourPlace ?? landSite,
    dbRange: landChange?.db_range,
    dates: landDates,
    layer: landLayer,
    removeShift: landShift,
    setDates: setLandDates,
  });

  // Is something selected on the map? Its panel (SelectionDetails) shows one
  // of: a gallery place, a line, a site (loaded or loading), the tour's box
  // (which is an area) or an area.
  const hasSelection = Boolean(landSite || profileLine || site || aoi) || selectedSiteId !== null;
  const shownSiteDate = site?.scenes?.[sceneIndex]?.date;

  // A story's chart or text asks for a date (and maybe a layer) of its site.
  const onStorySelectDate = (date, layer) => {
    if (!site?.scenes?.some((pass) => pass.date === date)) return;
    if (catalogOpen) returnToStudy();
    setKeepDate(true);
    selectAnalysisDate(date);
    if (layer) setSiteLayer(layer);
    if (narrow()) mapTitleRef.current?.scrollIntoView({ block: "nearest" });
  };
  // A place's story asks to compare two of its images (or show their change map).
  const onCompareImages = landSite ? (from, date, layer = "change") => {
    const before = landSite.passes.find((p) => p.date === from);
    if (!before || !landSite.passes.some((p) => p.date === date)) return;
    setLandDates({ from, to: date });
    setLandLayer(layer === "change" && !before.hh_url ? "hh" : layer);
    if (narrow()) mapTitleRef.current?.scrollIntoView({ block: "nearest" });
  } : null;

  // What the side panel holds: this tab's view of the selection where it has
  // one, otherwise its list (navigation.js).
  const view = panelView({
    mode,
    hasStory: Boolean(story),
    hasSelection,
    findingOpen: Boolean(openFinding),
  });
  const showPanelLabel = mode === "mine" ? "Show My findings" : `Show ${view}`;
  // A tab switches mode and opens its panel, on every screen size. What is
  // on the map stays, so the same place can be read in another tab.
  const switchMode = (next) => {
    cancelDraw();
    setMode(next);
    setPanelOpen(true);
    if (!panelOpen && narrow()) window.scrollTo({ top: 0, behavior: "instant" });
  };

  // Explorer images, when shown, replace the site's own scene on the map.
  const scene = site?.scenes?.[sceneIndex];
  const catalogOnMap = Boolean(site && catalogOpen && regionLayers?.mode);
  // Backscatter sites can be viewed as HH, HV or the open-water mask, if the
  // site's data has them; ground-motion sites have just their displacement.
  const siteMetrics = new Set((site?.observations ?? []).map((o) => o.metric));
  const siteLayers = site?.product === "GCOV"
    ? imageLayerOptions({ hh: siteMetrics.has("hh_db"), hv: siteMetrics.has("hv_db") })
    : null;
  const siteImages = site?.product === "GCOV"
    ? [scene, ...(site.scenes ?? [])].filter((s) => s?.image_url).map((s) => ({ url: assetUrl(s.image_url) }))
    : [];
  const mapSiteUrl = useLayerMapper(siteLayers ? siteLayer : "colour", siteImages);
  let sceneOverlay = null;
  if (land.overlay) {
    sceneOverlay = { ...land.overlay, opacity: overlayOpacity };
  } else if (!catalogOnMap && scene?.image_url) {
    sceneOverlay = {
      url: siteLayers ? mapSiteUrl(assetUrl(scene.image_url)) : assetUrl(scene.image_url),
      bbox: site.bbox,
      opacity: overlayOpacity,
    };
  }

  // The profile line, its ends, and a box to zoom to.
  const { bbox: profileBbox, layers: studyLayers } = profileLayers(profileLine);

  // The site's other series, charted beside its story.
  const moreSeries = site?.story_metric
    ? siteSeries(changeTypeOf(site.change_type), site.observations, site.story_metric)
    : null;
  const chainArea = aoi && !tourPlace
    ? { bbox: aoi.bbox.join(","), start: catalog.results.query?.start, end: catalog.results.query?.end }
    : null;
  // The chart panel takes its place as soon as a site is picked, so the map
  // is laid out once and the site's record loads alongside its passes.
  const chainSiteId = site?.id ?? (siteError ? null : pendingSite?.id) ?? null;
  const showChain = chainArea || chainSiteId != null;
  const ignore = () => {};
  const selectionTitle = landSite
    ? landSite.name
    : profileLine
    ? "Height profile"
    : site?.name ?? pendingSite?.name ?? (aoi ? (aoi.drawn ? "Drawn area" : "Selected area") : null);
  const siteLegend = site
    ? layerLegend(siteLayers ? siteLayer : "colour", changeTypeOf(site.change_type)?.image_legend)
    : { ramp: null, text: null };

  const selectAnalysisDate = (date) => {
    if (aoi) {
      catalog.actions.selectDate(date);
      return;
    }
    if (!site) {
      // The record can arrive before the passes: show this date once they do.
      if (selectedSiteId !== null && !keepDate) setPendingDate(date);
      return;
    }
    const index = site.scenes?.findIndex((item) => item.date === date) ?? -1;
    if (index >= 0) setSceneIndex(index);
  };

  const evidence = showChain ? (
    <ImpactChain
      key={chainArea?.bbox ?? chainSiteId}
      siteId={chainSiteId}
      area={chainArea}
      areaObservation={areaSeries}
      passDates={areaSeries?.dates ?? site?.scenes?.map((pass) => pass.date)}
      selectedDate={chainArea ? areaSeries?.date : scene?.date}
      passQuality={chainArea ? null : scene?.quality}
      onReturnToStudy={catalogOnMap ? returnToStudy : null}
      onSelectDate={selectAnalysisDate}
      onSelectLayer={siteLayers ? setSiteLayer : null}
      onSaveMoment={chainArea || touring ? null : (m) => openSaveFor(momentDraft(story?.title ?? site?.name, m, m.index))}
      keepDate={keepDate}
      momentHost={momentHost}
      showMomentPopup={touring && !demo && !drawing && !catalogOnMap}
      moreSeries={chainArea ? null : moreSeries}
      open={touring || evidenceOpen}
      onOpenChange={touring ? undefined : setEvidenceOpen}
    />
  ) : null;

  // The part of a site's box some pass didn't image, hatched over the map,
  // while open water (compared over the rest) is what the site charts.
  const footprintOverlay = buildFootprintOverlay({
    site,
    siteLayer,
    hidden: catalogOnMap || Boolean(landSite),
    toUrl: assetUrl,
  });

  // One toggle for the side panel; the tabs and each panel's own back link do the rest.
  const togglePanel = () => {
    cancelDraw();
    setPanelOpen((open) => !open);
    if (!panelOpen && narrow()) window.scrollTo({ top: 0, behavior: "instant" });
  };
  // The Tour button ends a running tour, or starts one. Shift-click starts
  // demo mode, for presenting (full screen, Space to move on).
  const onTourClick = (e) => {
    if (touring) tour.end();
    else if (e.shiftKey) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      tour.startDemo();
    } else tour.start();
  };
  // "Clear" removes a drawing and nothing else: the map stays where it is.
  const clearDrawing = () => {
    clearSelection();
    cancelDraw();
  };
  // An evidence card's Save: its place may not be on the map yet, so build from the card itself.
  const saveFindingCard = (ref, card) => {
    if (card.story.source === "site" && site?.slug === card.site.slug) {
      const m = { ...card.claim, focus: card.claim.focus ?? card.claim.end };
      openSaveFor(momentDraft(card.story.title, m, card.moment));
    } else if (landSite?.slug === card.site.slug) {
      openSaveFor(placeDraft("moment"));
    }
  };
  const nothingSelected = !hasSelection;
  // The selection's own panel (a story, a place's details); a finding card
  // and every list live in the other one.
  const showDetails = view === "story" || view === "details";
  // Gallery places that show something, as markers beside the study sites.
  const galleryPlaces = (landChange?.sites ?? []).filter((s) => s.status !== "not_visible");

  return (
    <div
      className="app-shell"
      data-demo={demo ? "" : undefined}
      data-demo-panel={demo && demoView.panel ? "" : undefined}
      data-demo-chain={demo && demoView.chain ? "" : undefined}
    >
      <div className="app-body" data-sidebar-open={demo ? demoView.panel : panelOpen} data-map-selection={Boolean(selectionTitle)} data-mode={mode}>
        <MapHeader
          title={selectionTitle}
          question={activeStory && !panelOpen ? activeStory.question : null}
          titleRef={mapTitleRef}
          panelButtonRef={panelButtonRef}
          tourButtonRef={tour.buttonRef}
          panelOpen={panelOpen}
          showPanelLabel={showPanelLabel}
          onTogglePanel={togglePanel}
          canSaveView={hasSelection && !drawing}
          onSaveView={() => openSaveFor(viewDraft())}
          touring={touring}
          onTourClick={onTourClick}
        />
        <aside className="sidebar" aria-label="Workspace sidebar" hidden={demo && !demoView.panel}>
          <SidebarResizer />
          <ModeTabs mode={mode} onSwitch={switchMode} findingsCount={notebook.findings.length} />
          <div
            id="workspace-panel"
            className="sidebar-panel"
            role="tabpanel"
            aria-labelledby={`mode-${mode}`}
            ref={sidebarRef}
            hidden={!panelOpen}
          >
            <div id="panel-list" className="sidebar-scroll" hidden={showDetails}>
              <PanelLists
                mode={mode}
                view={view}
                stories={stories}
                story={story}
                onSelectStory={selectStory}
                openFinding={openFinding}
                onCloseFinding={() => setOpenFinding(null)}
                onChangeFindingMoment={(moment) => setOpenFinding({ ...openFinding, moment })}
                findingSaved={openFinding ? notebook.isSaved(openFinding) : false}
                onSaveFinding={saveFindingCard}
                onShowFindingOnMap={showFindingOnMap}
                loading={loading}
                sites={sites}
                changeTypes={changeTypes}
                selectedSiteId={selectedSiteId}
                onSelectSite={selectSite}
                landSites={landChange?.sites}
                landSlug={landSlug}
                onSelectLand={selectLandChange}
                notebook={notebook}
                onShowSaved={showSavedFinding}
                onOpenEvidence={(f) => openFindingCard({ slug: f.source.slug, moment: f.source.moment, title: f.title })}
              />
            </div>
            {/* Kept mounted while another tab shows, so a search or a profile isn't run again. */}
            <div id="selection-details" className="sidebar-scroll" hidden={!showDetails}>
              <CatalogContext.Provider value={catalog}>
                <SelectionDetails
                  onBack={backToList}
                  changeTypeOf={changeTypeOf}
                  landSite={landSite}
                  landLayer={landLayer}
                  onLandLayerChange={setLandLayer}
                  profileLine={profileLine}
                  site={site}
                  selectedDate={shownSiteDate}
                  onSceneIndexChange={setSceneIndex}
                  catalogOpen={catalogOpen}
                  onCatalogToggle={toggleCatalog}
                  granuleProps={granuleProps}
                  selectedSiteId={selectedSiteId}
                  pendingSite={pendingSite}
                  siteError={siteError}
                  onRetrySite={retrySite}
                  backLabel={mode === "stories" && story ? "← All stories" : "← All places"}
                  tourPlace={tourPlace}
                  aoi={aoi}
                  aoiImagery={aoiImagery}
                  changeTypes={changeTypes}
                  activeStory={activeStory}
                  onStorySelectDate={onStorySelectDate}
                  activeChangePair={landLayer === "change" ? land.compared : null}
                  onCompareImages={onCompareImages}
                  onOpenFinding={openFindingCard}
                  onSaveStory={(ctx) => openSaveFor(storyDraft(ctx))}
                  shareOpen={shareOpen}
                  onShareToggle={() => setShareOpen((v) => !v)}
                />
              </CatalogContext.Provider>
            </div>
          </div>
        </aside>
        <main className="workspace" aria-labelledby="map-title" ref={workspaceRef}>
          <section className="map-pane" aria-labelledby="map-title">
            <div className="map-stage">
              {error && <p className="workspace-status error" role="alert">{error}</p>}
              <div
                className="map-frame"
                aria-label="NISAR map"
                ref={mapFrameRef}
              >
                <div className="map-canvas">
                  <ErrorBoundary>
                    <ChangeMap
                      sites={sites}
                      changeTypes={changeTypes}
                      selectedSiteId={selectedSiteId}
                      places={galleryPlaces}
                      selectedPlace={landSlug}
                      focusBbox={site?.bbox ?? pendingSite?.bbox ?? aoi?.bbox ?? landSite?.bbox ?? profileBbox ?? tour.focus}
                      focusObstructionRef={evidenceRef}
                      sceneOverlay={sceneOverlay}
                      footprintOverlay={footprintOverlay}
                      referencePoint={site?.reference ?? null}
                      regionLayers={regionLayers}
                      studyLayers={studyLayers}
                      showFocusOutline={!profileLine && !(tour.focus && nothingSelected)}
                      focusMaxZoom={landSite ? 14 : tour.focus ? 13 : 11}
                      tourMarks={touring ? tour.marks : null}
                      onSelectSite={touring ? ignore : selectSiteOnMap}
                      onSelectPlace={touring ? ignore : selectPlaceOnMap}
                      onMapClick={touring || mode !== "investigate" ? ignore : selectPoint}
                      fitKey={touring ? tour.refit : 0}
                      homeKey={homeKey}
                      onDrawArea={selectArea}
                      onDrawLine={selectLine}
                      finishLineWhen={touring ? (line) => line.length >= 2 : null}
                      locked={touring}
                      drawHint={touring && drawing === "line" ? "Click the yellow A, then the yellow B." : null}
                      drawHost={drawHost}
                      drawing={drawing}
                      onCancelDraw={stopDraw}
                    />
                  </ErrorBoundary>
                  {/* The map's drawing bar: what to do, Finish and Cancel. */}
                  <div className="draw-host" ref={setDrawHost} />
                  <div className="moment-host" ref={setMomentHost} />
                  {mode === "investigate" && (
                    <DrawTools
                      drawing={drawing}
                      onToggle={toggleDraw}
                      canClear={Boolean(aoi || profileLine)}
                      onClear={clearDrawing}
                      areaButtonRef={drawButtonRef}
                      lineButtonRef={lineButtonRef}
                    />
                  )}
                  {!demo && evidence && (
                    <div className="map-evidence" ref={evidenceRef} hidden={Boolean(drawing)} data-tour-active={touring}>
                      {evidence}
                    </div>
                  )}
                </div>
                <TimelineDock
                  hostRef={setTimelineHost}
                  inert={Boolean(drawing)}
                  opacity={overlayOpacity}
                  onOpacityChange={setOverlayOpacity}
                  colourLegend={backscatterLegend}
                  land={land}
                  landKey={tourPlace ? `tour-${aoi.imagery}` : landSite?.slug}
                  onLandLayerChange={setLandLayer}
                  onLandShiftChange={setLandShift}
                  guideDates={touring ? tour.guide : null}
                  site={site}
                  catalogOnMap={catalogOnMap}
                  sceneIndex={sceneIndex}
                  onSceneIndexChange={setSceneIndex}
                  siteLegend={siteLegend}
                  siteLayers={siteLayers}
                  siteLayer={siteLayer}
                  onSiteLayerChange={setSiteLayer}
                  mapSiteUrl={mapSiteUrl}
                />
              </div>
            </div>
            {demo && evidence}
          </section>
        </main>
      </div>
      {saveDraft && (
        <SaveFindingDialog
          key={saveDraft.title}
          draft={saveDraft}
          stories={notebook.stories}
          onSave={commitSave}
          onCancel={() => setSaveDraft(null)}
        />
      )}
      {savedNote && (
        <SaveToast
          title={savedNote}
          onOpen={mode !== "mine" && !touring ? () => switchMode("mine") : null}
        />
      )}
      {touring && demo && (
        <DemoTour
          state={{ drawing, aoiDrawn: Boolean(aoi?.drawn), profileLine: Boolean(profileLine) }}
          actions={tour.actions}
          onEnd={tour.endDemo}
          onView={tour.setDemoView}
        />
      )}
      {touring && !demo && (
        <Tour
          state={{
            saveOpen: Boolean(saveDraft),
            savedCount: notebook.findings.length,
            drawing,
            aoiDrawn: Boolean(aoi?.drawn),
            profileLine: Boolean(profileLine),
            snapped: tour.snapped,
            landDate: landSite ? land.compared.to : null,
          }}
          actions={tour.actions}
          onEnd={tour.end}
        />
      )}
    </div>
  );
}
