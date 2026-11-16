import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";

import AoiPanel from "../components/AoiPanel.jsx";
import ChangeMap from "../components/ChangeMap.jsx";
import CoverageCheck from "../components/CoverageCheck.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import FindingCard from "../components/FindingCard.jsx";
import ImpactChain from "../components/ImpactChain.jsx";
import LandChangePanel from "../components/LandChangePanel.jsx";
import LandPlayer from "../components/LandPlayer.jsx";
import NotebookPanel from "../components/NotebookPanel.jsx";
import PlacesList from "../components/PlacesList.jsx";
import ProfilePanel from "../components/ProfilePanel.jsx";
import SaveFindingDialog from "../components/SaveFindingDialog.jsx";
import ScenePlayer from "../components/ScenePlayer.jsx";
import SidebarResizer from "../components/SidebarResizer.jsx";
import SiteDetail from "../components/SiteDetail.jsx";
import SitePending from "../components/SitePending.jsx";
import StoryList from "../components/StoryList.jsx";
import StoryPanel from "../components/StoryPanel.jsx";
import DemoTour from "../components/tour/DemoTour.jsx";
import Tour from "../components/tour/Tour.jsx";
import { Icon } from "../platform/icons.jsx";
import { LANGTANG, SYLHET } from "../components/tour/steps.js";
import { setWorkspaceContext } from "../platform/workspaceContext.js";
import {
  KILAUEA,
  TOUR_BOX,
  TOUR_IMAGERY,
  TOUR_LINE,
  TOUR_VIEW,
  markTourSeen,
  tourSeen,
} from "../services/tour.js";
import {
  assetUrl,
  fetchChangeTypes,
  fetchLandChange,
  fetchProducts,
  fetchSite,
  fetchSites,
  fetchStories,
  fetchStory,
} from "../services/api.js";
import { loadImage } from "../services/imageCache.js";
import { imageLayerOptions, layerLegend, useLayerMapper } from "../services/layers.js";
import { siteSeries } from "../services/measurements.js";
import { useNotebook } from "../services/notebook.js";
import {
  momentDraft as buildMomentDraft,
  placeDraft as buildPlaceDraft,
  viewDraft as buildViewDraft,
} from "./drafts.js";
import { aoiAround, footprintOverlay as buildFootprintOverlay, profileLayers } from "./mapLayers.js";
import {
  DEFAULT_MODE,
  MODES,
  findingParam,
  historyAction,
  modeForPlace,
  modeFrom,
  panelView,
  parseFinding,
  workspaceParams,
} from "./navigation.js";

const NARROW_LAYOUT = "(max-width: 760px)";

// The map workspace. The platform keeps it mounted while docs pages are
// shown (platform/WorkspaceHost.jsx) so the map and selection survive a
// trip to the docs. `active` says whether it is the visible route; only
// then does it read and write `?site=<slug>&date=<YYYY-MM-DD>` in the URL.
export default function WorkspaceApp({ active = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  // A date asked for in the URL, applied once its site has loaded.
  const pendingDateRef = useRef(null);
  // A site (its id) or place (its slug) selected from the URL, until it shows.
  const pendingSiteRef = useRef(null);
  const pendingPlaceRef = useRef(null);
  const [changeTypes, setChangeTypes] = useState([]);
  const [products, setProducts] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [site, setSite] = useState(null);
  // Why the selected site couldn't be loaded, and a counter to try again.
  const [siteError, setSiteError] = useState(null);
  const [siteAttempt, setSiteAttempt] = useState(0);
  const [aoi, setAoi] = useState(null);
  const [granules, setGranules] = useState([]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Is the side panel showing? What it holds follows the tab and the
  // selection (navigation.js). An evidence card opened from a link must
  // show even on a phone, where the panel otherwise starts closed.
  const [panelOpen, setPanelOpen] = useState(
    () => !window.matchMedia(NARROW_LAYOUT).matches || Boolean(searchParams.get("finding")),
  );
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  // Drawing tool in use: null, "area" (rectangle) or "line" (height profile).
  const [drawing, setDrawing] = useState(null);
  // A line drawn for a height profile: [[lon, lat], ...] or null.
  const [profileLine, setProfileLine] = useState(null);
  // Land-change gallery: data, the selected place, its layer (null: the
  // place's starting layer), its map overlay and the two dates it compares.
  const [landChange, setLandChange] = useState(null);
  const [landSlug, setLandSlug] = useState(null);
  const [landLayer, setLandLayer] = useState(null);
  const [landOverlay, setLandOverlay] = useState(null);
  const [landDates, setLandDates] = useState(null);
  // A date the tour asks the land player to show (n makes a repeat count).
  const [landFocus, setLandFocus] = useState(null);
  const [timelineHost, setTimelineHost] = useState(null);
  // Where the map draws its drawing bar (instructions, Finish, Cancel).
  const [drawHost, setDrawHost] = useState(null);
  // Bumped to send the map back to the whole world (a back link, the default workspace).
  const [homeKey, setHomeKey] = useState(0);
  // Which image layer the selected study site's images are drawn as.
  const [siteLayer, setSiteLayer] = useState("colour");
  // The guided tour: on a first visit it opens on its first step (how radar
  // sees), which offers to skip. Not when someone arrives on a specific
  // place or evidence card from a link.
  const [touring, setTouring] = useState(
    () => Boolean(searchParams.get("demo"))
      || !(tourSeen() || searchParams.get("site") || searchParams.get("place") || searchParams.get("finding")),
  );
  // Demo mode: the tour cut down for a live pitch (DemoTour.jsx), and which
  // panels its step shows (everything else is hidden while it runs).
  const [demo, setDemo] = useState(() => Boolean(searchParams.get("demo")));
  const [demoView, setDemoView] = useState({ panel: false, chain: false });
  const tourButtonRef = useRef(null);
  const touringRef = useRef(touring);
  touringRef.current = touring;
  // Kīlauea steps: the pin / box / line drawn on the map, the place the map
  // is held on, a nonce that returns the map to it, and whether the line
  // the viewer drew was matched to the suggested one.
  const [tourMarks, setTourMarks] = useState(null);
  const [tourFocus, setTourFocus] = useState(null);
  const [tourRefit, setTourRefit] = useState(0);
  const [tourSnapped, setTourSnapped] = useState(false);
  const tourFocusRef = useRef(tourFocus);
  tourFocusRef.current = tourFocus;
  // Dates marked with yellow lines on the land player's bar (Langtang steps).
  const [tourGuide, setTourGuide] = useState(null);
  const [momentHost, setMomentHost] = useState(null);
  const sidebarRef = useRef(null);
  const workspaceRef = useRef(null);
  const mapTitleRef = useRef(null);
  const mapFrameRef = useRef(null);
  const evidenceRef = useRef(null);
  const drawButtonRef = useRef(null);
  const lineButtonRef = useRef(null);
  const panelButtonRef = useRef(null);
  // Images and outlines from the data explorer ({ tiles, outlines, opacity }).
  const [regionLayers, setRegionLayers] = useState(null);
  // A drawn area's searched dates, its NISAR series and the date asked for from the chart.
  const [areaRange, setAreaRange] = useState(null);
  const [areaSeries, setAreaSeries] = useState(null);
  const [areaFocus, setAreaFocus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(() =>
    modeFrom(searchParams.get("mode"), DEFAULT_MODE, { hasFinding: Boolean(searchParams.get("finding")) }));
  const [stories, setStories] = useState(null);
  const [openFinding, setOpenFinding] = useState(() => parseFinding(searchParams.get("finding")));
  // True while the shown pass was asked for by a link or a finding, so the
  // chart panel doesn't move off it to the site's first moment.
  const [keepDate, setKeepDate] = useState(() => Boolean(searchParams.get("date")));
  // A finding to put on the map once the sites have loaded.
  const [pendingFinding, setPendingFinding] = useState(null);
  // My findings (this browser), the finding being saved, and the note after a save.
  const notebook = useNotebook();
  const [saveDraft, setSaveDraft] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  // A story's Save / share menu.
  const [shareOpen, setShareOpen] = useState(false);

  const showGranules = useCallback((rows) => setGranules(rows), []);

  useEffect(() => {
    Promise.all([fetchChangeTypes(), fetchProducts(), fetchSites()])
      .then(([types, prods, rows]) => {
        setChangeTypes(types);
        setProducts(prods);
        setSites(rows);
      })
      .catch((err) =>
        setError(`Can't reach the backend: ${err?.message || "unknown error"}`),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchLandChange()
      .then(setLandChange)
      .catch(() => setLandChange({ sites: [] }));
  }, []);

  useEffect(() => {
    fetchStories()
      .then(setStories)
      .catch(() => setStories({ themes: [], stories: [] }));
  }, []);

  useEffect(() => {
    if (selectedSiteId === null) return undefined;
    let cancelled = false;
    setSiteError(null);
    fetchSite(selectedSiteId)
      .then((s) => {
        // A newer selection replaced this one while it loaded: drop it.
        if (cancelled) return;
        setSite(s);
        const wanted = pendingDateRef.current;
        pendingDateRef.current = null;
        const asked = wanted ? (s.scenes ?? []).findIndex((x) => x.date === wanted) : -1;
        setSceneIndex(asked >= 0 ? asked : Math.max(0, (s.scenes?.length ?? 0) - 1));
      })
      .catch((err) => {
        // The selection stays, so the panel can say what failed and offer to retry.
        if (!cancelled) setSiteError(err?.message || "Couldn't load this site.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, siteAttempt]);

  const clearSelection = () => {
    setEvidenceOpen(true);
    setCatalogOpen(false);
    setGranules([]);
    setRegionLayers(null);
    setAreaRange(null);
    setAreaSeries(null);
    setAreaFocus(null);
    setSelectedSiteId(null);
    setSite(null);
    setSiteError(null);
    setSiteLayer("colour");
    setAoi(null);
    setProfileLine(null);
    setLandSlug(null);
    setLandLayer(null);
    setLandOverlay(null);
    setLandDates(null);
    setLandFocus(null);
    setShareOpen(false);
    setKeepDate(false);
    setError(null);
    pendingDateRef.current = null;
    pendingSiteRef.current = null;
  };

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
      clearSelection();
      setSelectedSiteId(id);
    } else if (siteError) {
      setSiteAttempt((n) => n + 1);
    }
    setEvidenceOpen(true);
    cancelDraw();
    revealSelection();
  };

  const selectPoint = ({ latitude, longitude }) => {
    clearSelection();
    setMode("investigate");
    setAoi(aoiAround(latitude, longitude));
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
    clearSelection();
    setMode("investigate");
    setAoi({
      latitude: (bbox[1] + bbox[3]) / 2,
      longitude: (bbox[0] + bbox[2]) / 2,
      bbox,
      drawn: true,
      imagery: snapped ? TOUR_IMAGERY : null,
    });
    cancelDraw();
    revealSelection();
  };

  const selectLandChange = (slug) => {
    clearSelection();
    setLandSlug(slug);
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
  // Put a finding's place and pass on the map. A card does this by itself when
  // it opens (`focusMap: false`, so the card stays in view on a phone); the
  // card's "Show on map" button also brings the map forward.
  const showFindingOnMap = (finding, { focusMap = true } = {}) => {
    if (finding.story.source === "site") {
      const target = sites.find((s) => s.slug === finding.site.slug);
      if (!target) {
        // A finding opened from a link can load before the sites do: wait for them.
        if (sites.length === 0) setPendingFinding(finding);
        return;
      }
      if (target.id === selectedSiteId) {
        const i = site?.id === target.id ? site.scenes?.findIndex((x) => x.date === finding.claim.end) ?? -1 : -1;
        if (i >= 0) setSceneIndex(i);
        // The site is still loading: apply the date when it arrives.
        else pendingDateRef.current = finding.claim.end;
        setKeepDate(true);
      } else {
        clearSelection();
        pendingDateRef.current = finding.claim.end;
        setKeepDate(true);
        setSelectedSiteId(target.id);
      }
    } else if (finding.site.slug !== landSlug) {
      clearSelection();
      setLandSlug(finding.site.slug);
    }
    cancelDraw();
    if (focusMap && narrow()) {
      setPanelOpen(false);
      mapTitleRef.current?.scrollIntoView({ block: "nearest" });
    }
  };
  useEffect(() => {
    if (!pendingFinding || sites.length === 0) return;
    setPendingFinding(null);
    showFindingOnMap(pendingFinding, { focusMap: false });
    // showFindingOnMap is recreated each render; the finding and the site list drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFinding, sites]);

  // A line drawn with the line tool: height profile over time.
  const selectLine = (line) => {
    clearSelection();
    // Likewise any line drawn during a tour becomes the suggested one (its
    // result ships with the app, so it opens at once).
    const snapped = touring ? TOUR_LINE : null;
    setMode("investigate");
    setTourSnapped(Boolean(snapped));
    setProfileLine(snapped ?? line);
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
        else if (date) pendingDateRef.current = date;
      } else {
        clearSelection();
        pendingDateRef.current = date;
        setSelectedSiteId(target.id);
      }
      setKeepDate(Boolean(date));
      if (layer) setSiteLayer(layer);
    } else {
      if (slug !== landSlug) {
        clearSelection();
        setLandSlug(slug);
      }
      setLandLayer(layer);
      setLandFocus(date ? (f) => ({ date, n: (f?.n ?? 0) + 1 }) : null);
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
    buildPlaceDraft({ place: landSite, kind, layer: landLayer, dates: landDates, story: landSite && storyIndex.get(landSite.slug) });
  // Whatever is on the map now ("Save view").
  const viewDraft = () =>
    buildViewDraft({
      place: landSite,
      placeLayer: landLayer,
      placeDates: landDates,
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
    const story = await fetchStory(slug).catch(() => null);
    if (!story || signal.aborted) return;
    const moments = story.saw?.moments ?? [];
    const date = site?.scenes?.[sceneIndex]?.date;
    const shown = moments.find((m) => m.end === date) ?? moments.find((m) => date && date >= m.start && date <= m.end);
    const momentIndex = story.source === "site" ? shown?.index ?? story.hero_moment ?? 0 : null;
    openSaveFor(storyDraft({ story, moment: momentIndex == null ? null : moments[momentIndex], momentIndex }));
  };

  const startTour = () => {
    cancelDraw();
    setSaveDraft(null);
    setTouring(true);
  };
  const startDemo = () => {
    cancelDraw();
    setSaveDraft(null);
    setDemoView({ panel: false, chain: false });
    setDemo(true);
    setTouring(true);
  };
  const endTour = useCallback(() => {
    markTourSeen();
    cancelDraw();
    if (tourFocusRef.current) {
      // Ending mid-demo at Kīlauea: leave nothing the tour had the user draw, and hand back the default workspace.
      clearSelection();
      setMode(DEFAULT_MODE);
      setPanelOpen(!narrow());
      setHomeKey((n) => n + 1);
    }
    setTouring(false);
    setSaveDraft(null);
    setLandFocus(null);
    setTourMarks(null);
    setTourFocus(null);
    setTourGuide(null);
    tourButtonRef.current?.focus({ preventScroll: true });
    // clearSelection and narrow only call setters; a stale copy is the same.
  }, [cancelDraw]);
  // Leaving demo mode: the default workspace, out of full screen.
  const endDemo = useCallback(() => {
    endTour();
    setDemo(false);
    clearSelection();
    setMode(DEFAULT_MODE);
    setPanelOpen(!narrow());
    setHomeKey((n) => n + 1);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    // clearSelection and narrow only call setters; a stale copy is the same.
  }, [endTour]);
  // The page around the workspace (the top bar) hides in demo mode too.
  useEffect(() => {
    if (!demo || !active) return undefined;
    document.documentElement.dataset.demo = "";
    return () => {
      delete document.documentElement.dataset.demo;
    };
  }, [demo, active]);
  const tourActions = {
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
        fetchSite(sylhet.id)
          .then((s) => (s.scenes ?? []).forEach((scene) => scene.image_url && loadImage(assetUrl(scene.image_url))))
          .catch(() => {});
      }
    },
    // Show this date of the land-change place on the map (its bar moves to it).
    focusLandDate: (date) => setLandFocus((f) => ({ date, n: (f?.n ?? 0) + 1 })),
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
    // Each step starts from a map free of the Kīlauea drawings and place,
    // and a bar free of yellow lines.
    leaveKilauea: () => {
      setTourMarks(null);
      setTourFocus(null);
      setTourGuide(null);
    },
    // Point at these dates on the land player's bar.
    setGuide: setTourGuide,
    // A Kīlauea step: its tab and panel (undefined: as it is), what to draw
    // on the map, and the map held on the summit.
    showKilauea: ({ marks, panel } = {}) => {
      setMode("investigate");
      if (panel != null) setPanelOpen(panel);
      else if (narrow()) setPanelOpen(false);
      setTourMarks(
        marks && {
          pin: marks.pin ? KILAUEA : null,
          box: marks.box ? TOUR_BOX : null,
          line: marks.line ? TOUR_LINE : null,
        },
      );
      setTourFocus(TOUR_VIEW);
      setTourRefit((n) => n + 1);
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
  };

  const changeTypeOf = (id) => changeTypes.find((ct) => ct.id === id);

  // Nothing selected, the Stories list, the whole world: where the workspace starts.
  const goHome = () => {
    clearSelection();
    cancelDraw();
    setOpenFinding(null);
    setMode(DEFAULT_MODE);
    setPanelOpen(!narrow());
    setHomeKey((n) => n + 1);
  };
  // The top bar's Workspace link, clicked while already here, goes there.
  // (Arriving from another page keeps what was open: see WorkspaceHost.)
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const here = wasActiveRef.current;
    wasActiveRef.current = active;
    if (active && here && navigationType === "PUSH" && !location.search && !touringRef.current) goHome();
    // Only a navigation should run this, not each render's new goHome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // ── URL ⇄ selection (deep links from the docs and the assistant) ──
  const selectedSiteIdRef = useRef(selectedSiteId);
  selectedSiteIdRef.current = selectedSiteId;
  const siteRef = useRef(site);
  siteRef.current = site;
  const urlSite = searchParams.get("site");
  const urlDate = searchParams.get("date");
  const urlMode = searchParams.get("mode");
  const urlPlace = searchParams.get("place");
  const urlFinding = searchParams.get("finding");
  // A mode, place or finding asked for by a link while the workspace is open
  // (an old `mode=findings` link opens Stories or My findings).
  useEffect(() => {
    if (active && urlMode) setMode((m) => modeFrom(urlMode, m, { hasFinding: Boolean(urlFinding) }));
    // The finding is read with the mode; a new finding alone is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, urlMode]);
  useEffect(() => {
    if (!active || !urlFinding || findingParam(openFinding) === urlFinding) return;
    setOpenFinding(parseFinding(urlFinding));
    setMode("stories");
    setPanelOpen(true);
    // Only a new finding in the URL should reopen the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, urlFinding]);
  // A link that names a place but no tab: My findings has no view of a
  // place, so move to a tab that does. A finding link keeps its card in view.
  const showLinkedPlace = (slug) => {
    if (!urlMode) setMode((m) => (m === "mine" ? modeForPlace(m, storyIndex.has(slug)) : m));
    if (urlFinding) setPanelOpen(true);
  };
  const landSlugRef = useRef(landSlug);
  landSlugRef.current = landSlug;
  useEffect(() => {
    if (!active || !urlPlace || !landChange || urlPlace === landSlugRef.current) return;
    // Only places with passes open: a "checked, nothing visible" place has no images.
    if (landChange.sites.some((s) => s.slug === urlPlace && s.passes?.length)) {
      pendingPlaceRef.current = urlPlace;
      selectLandChange(urlPlace);
      showLinkedPlace(urlPlace);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, urlPlace, landChange]);
  useEffect(() => {
    if (!active || !urlSite || sites.length === 0) return;
    const target = sites.find((s) => s.slug === urlSite || String(s.id) === urlSite);
    if (!target) return;
    if (target.id === selectedSiteIdRef.current) {
      const index = urlDate ? siteRef.current?.scenes?.findIndex((x) => x.date === urlDate) ?? -1 : -1;
      if (index >= 0) setSceneIndex(index);
      return;
    }
    selectSite(target.id);
    // After selectSite, which clears whatever was left waiting.
    pendingSiteRef.current = target.id;
    pendingDateRef.current = urlDate;
    setKeepDate(Boolean(urlDate));
    showLinkedPlace(target.slug);
    // selectSite is recreated each render; the URL and site list drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, urlSite, urlDate, sites]);

  // ?demo=1 (the search menu's "Demo mode"): start demo mode, then drop it from the URL.
  const urlDemo = searchParams.get("demo");
  useEffect(() => {
    if (!active || !urlDemo) return;
    if (!demo) startDemo();
    const next = new URLSearchParams(searchParams);
    next.delete("demo");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, urlDemo]);

  // Back or Forward to a URL without a place or finding: close what is open,
  // so the panel shows the list the URL describes.
  const openFindingRef = useRef(openFinding);
  openFindingRef.current = openFinding;
  useEffect(() => {
    if (!active || navigationType !== "POP") return;
    if (!urlSite && !urlPlace && (selectedSiteIdRef.current != null || landSlugRef.current)) {
      clearSelection();
      cancelDraw();
    }
    if (!urlFinding && openFindingRef.current) setOpenFinding(null);
    // Only a Back or Forward should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const shownDate = site?.scenes?.[sceneIndex]?.date ?? null;
  // State → URL: ?mode=…&site=…&date=… or &place=…, plus &finding=… in Findings.
  useEffect(() => {
    if (!active) return;
    // A site or place asked for by the URL stays there until it shows; after
    // that the URL follows the selection (and empties when it is cleared).
    if ((urlSite && sites.length === 0) || (urlPlace && !landChange)) return;
    if (pendingSiteRef.current != null) {
      if (!site && !siteError) return;
      pendingSiteRef.current = null;
    }
    if (pendingPlaceRef.current) {
      if (pendingPlaceRef.current !== landSlug) return;
      pendingPlaceRef.current = null;
    }
    const next = workspaceParams({ mode, site: site?.slug, date: shownDate, place: landSlug, finding: openFinding });
    if (new URLSearchParams(next).toString() === searchParams.toString()) return;
    // Opening a place, tab or finding adds a step Back can undo; dates don't.
    setSearchParams(next, { replace: historyAction(searchParams, next) === "replace" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, site, siteError, shownDate, mode, landSlug, openFinding, landChange]);

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
  const toggleCatalog = (open) => {
    setCatalogOpen(open);
    if (!open) setGranules([]);
  };
  const returnToStudy = () => {
    toggleCatalog(false);
    mapTitleRef.current?.focus({ preventScroll: true });
  };
  const granuleProps = {
    products,
    granules,
    onGranuleResults: showGranules,
    onBack: backToList,
    overlayOpacity,
    onOverlayOpacityChange: setOverlayOpacity,
    onMapLayers: setRegionLayers,
    timelineHost,
    // The tour's steps and imagery are for backscatter only.
    lockedProduct: touring ? "GCOV" : null,
    // SME2 backscatter is drawn like the GCOV (crop) sites, so reuse their legend.
    backscatterLegend: changeTypes.find((ct) => ct.product === "GCOV")
      ?.image_legend,
  };

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

  let details = null;
  if (landSite) {
    details = (
      <LandChangePanel
        key={landSite.slug}
        site={landSite}
        onBack={backToList}
        changeShown={landLayer === "change"}
        onToggleChange={
          landSite.passes?.some((p) => p.hh_url)
            ? () => setLandLayer((layer) => (layer === "change" ? null : "change"))
            : null
        }
        embedded={Boolean(activeStory)}
      />
    );
  } else if (profileLine) {
    details = (
      <ProfilePanel
        key={JSON.stringify(profileLine)}
        line={profileLine}
        onBack={backToList}
      />
    );
  } else if (site) {
    details = (
      <SiteDetail
        key={site.id}
        site={site}
        changeType={changeTypeOf(site.change_type)}
        selectedDate={site.scenes?.[sceneIndex]?.date}
        onSceneIndexChange={setSceneIndex}
        catalogOpen={catalogOpen}
        onCatalogToggle={toggleCatalog}
        embedded={Boolean(activeStory)}
        {...granuleProps}
      />
    );
  } else if (tourPlace) {
    // The tours' Kīlauea box: its imagery ships with the app and plays in
    // the dock like a gallery place. No catalog search, no NASA browse images.
    details = (
      <article className="panel detail" aria-label="Selected area">
        <button type="button" className="btn btn-link" onClick={backToList}>
          ← All places
        </button>
        <p className="muted small detail-meta">Kīlauea summit · {tourPlace.region}</p>
        <p>
          Every NISAR pass over the summit caldera, {tourPlace.passes.length} of them on frame{" "}
          <code>{tourPlace.frame}</code>, ~{tourPlace.pixel_m} m pixels. Play them under the map.
        </p>
      </article>
    );
  } else if (aoi) {
    details = (
      <AoiPanel
        key={aoi.bbox.join(",")}
        aoi={aoi}
        changeTypes={changeTypes}
        imagery={aoi.imagery ? landChange?.imagery?.[aoi.imagery] ?? null : null}
        {...granuleProps}
        onAreaRange={setAreaRange}
        onAreaSeries={setAreaSeries}
        areaFocus={areaFocus}
      >
        {aoi.drawn && !aoi.imagery && <CoverageCheck key={`cov-${aoi.bbox.join(",")}`} bbox={aoi.bbox} />}
      </AoiPanel>
    );
  } else if (selectedSiteId !== null) {
    details = (
      <SitePending
        site={pendingSite}
        changeType={changeTypeOf(pendingSite?.change_type)}
        error={siteError}
        onRetry={() => setSiteAttempt((n) => n + 1)}
        onBack={backToList}
        backLabel={mode === "stories" && story ? "← All stories" : "← All places"}
        embedded={Boolean(activeStory)}
      />
    );
  }

  if (activeStory && details) {
    details = (
      <StoryPanel
        key={activeStory.slug}
        slug={activeStory.slug}
        summary={activeStory}
        selectedDate={site?.scenes?.[sceneIndex]?.date}
        onSelectDate={(date, layer) => {
          if (!site?.scenes?.some((pass) => pass.date === date)) return;
          if (catalogOpen) returnToStudy();
          setKeepDate(true);
          selectAnalysisDate(date);
          if (layer) setSiteLayer(layer);
          if (narrow()) mapTitleRef.current?.scrollIntoView({ block: "nearest" });
        }}
        activeChangePair={landLayer === "change" ? landDates : null}
        onCompareImages={landSite ? (from, date, layer = "change") => {
          const before = landSite.passes.find((p) => p.date === from);
          if (!before || !landSite.passes.some((p) => p.date === date)) return;
          setLandFocus((previous) => ({ from, date, n: (previous?.n ?? 0) + 1 }));
          setLandLayer(layer === "change" && !before.hh_url ? "hh" : layer);
          if (narrow()) mapTitleRef.current?.scrollIntoView({ block: "nearest" });
        } : null}
        onOpenFinding={openFindingCard}
        onSave={(ctx) => openSaveFor(storyDraft(ctx))}
        shareOpen={shareOpen}
        onShareToggle={() => setShareOpen((v) => !v)}
        onBack={backToList}
      >
        {details}
      </StoryPanel>
    );
  }

  // What the side panel holds: this tab's view of the selection where it has
  // one, otherwise its list (navigation.js).
  const view = panelView({
    mode,
    hasStory: Boolean(story),
    hasSelection: Boolean(details),
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

  const onModeTabKeyDown = (event, index) => {
    const count = MODES.length;
    const destinations = {
      ArrowLeft: (index + count - 1) % count,
      ArrowRight: (index + 1) % count,
      Home: 0,
      End: count - 1,
    };
    if (!Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    const nextIndex = destinations[event.key];
    event.currentTarget.parentElement.children[nextIndex]?.focus({ preventScroll: true });
    switchMode(MODES[nextIndex].id);
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
  if (landOverlay) {
    sceneOverlay = { ...landOverlay, opacity: overlayOpacity };
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
    ? { bbox: aoi.bbox.join(","), ...areaRange }
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
  const backscatterLegend = changeTypes.find((ct) => ct.product === "GCOV")?.image_legend;
  const siteLegend = site
    ? layerLegend(siteLayers ? siteLayer : "colour", changeTypeOf(site.change_type)?.image_legend)
    : { ramp: null, text: null };
  // The dock under the map: time, layer and opacity for whatever is on it.
  // It stays mounted while the tabs and the panel change, so a time-lapse
  // keeps its date, layer and playback.
  const timeline = (
    <div
      className="map-timeline"
      ref={setTimelineHost}
      inert={Boolean(drawing)}
    >
      {tourPlace ? (
        <LandPlayer
          key={`tour-${aoi.imagery}`}
          site={tourPlace}
          dbRange={landChange.db_range}
          opacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
          onOverlay={setLandOverlay}
          layer={landLayer}
          onLayerChange={setLandLayer}
          colourLegend={backscatterLegend}
        />
      ) : landSite ? (
        <LandPlayer
          key={landSite.slug}
          site={landSite}
          dbRange={landChange.db_range}
          opacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
          onOverlay={setLandOverlay}
          layer={landLayer}
          onLayerChange={setLandLayer}
          onDatesChange={setLandDates}
          focus={landFocus}
          guideDates={touring ? tourGuide : null}
          colourLegend={backscatterLegend}
        />
      ) : site?.scenes?.length > 0 && !catalogOnMap ? (
        <ScenePlayer
          key={site.id}
          scenes={site.scenes}
          index={sceneIndex}
          onIndexChange={setSceneIndex}
          opacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
          product={site.product}
          imageRange={site.image_range}
          legend={siteLegend.text}
          ramp={siteLegend.ramp}
          layers={siteLayers}
          layer={siteLayer}
          onLayerChange={setSiteLayer}
          imageUrl={siteLayers ? mapSiteUrl : undefined}
          docked
        />
      ) : null}
    </div>
  );

  const selectAnalysisDate = (date) => {
    if (aoi) {
      setAreaFocus({ date });
      return;
    }
    if (!site) {
      // The record can arrive before the passes: show this date once they do.
      if (selectedSiteId !== null && !keepDate) pendingDateRef.current = date;
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
  // "Clear" removes a drawing and nothing else: the map stays where it is.
  const clearDrawing = () => {
    clearSelection();
    cancelDraw();
  };
  const nothingSelected = !details;
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
        <section className="map-header" aria-label="Map controls">
          <div className="map-heading">
            <h1
              id="map-title"
              ref={mapTitleRef}
              tabIndex={-1}
              className={selectionTitle ? undefined : "visually-hidden"}
              title={selectionTitle ?? undefined}
            >
              {selectionTitle ?? "NISAR map"}
            </h1>
            {/* With the story panel closed, its question stays with the map. */}
            {activeStory && !panelOpen && <p title={activeStory.question}>{activeStory.question}</p>}
          </div>
          <div className="map-actions">
            <button
              type="button"
              ref={panelButtonRef}
              className="btn btn-secondary map-action panel-action"
              aria-label={panelOpen ? "Hide panel" : showPanelLabel}
              aria-controls="workspace-panel"
              aria-expanded={panelOpen}
              onClick={togglePanel}
            >
              <span className="panel-action-full">{panelOpen ? "Hide panel" : showPanelLabel}</span>
              <span className="panel-action-short" aria-hidden="true">Panel</span>
            </button>
            {/* Save what is on the map: a place on a date and layer, a drawn area or line. */}
            {details && !drawing && (
              <button
                type="button"
                className="btn btn-secondary map-action"
                data-tour="save-view"
                title="Save what is on the map, with your own notes, to My findings"
                onClick={() => openSaveFor(viewDraft())}
              >
                Save view
              </button>
            )}
            <button
              type="button"
              ref={tourButtonRef}
              className="btn btn-secondary map-action tour-button"
              title={touring ? "End the guided tour" : "Take the guided tour (about 3 minutes)"}
              onClick={(e) => {
                if (touring) endTour();
                // Shift-click: demo mode, for presenting (full screen, Space to move on).
                else if (e.shiftKey) {
                  document.documentElement.requestFullscreen?.().catch(() => {});
                  startDemo();
                } else startTour();
              }}
            >
              <Icon name="compass" size={16} strokeWidth={2} />
              <span className="map-action-label">{touring ? "End tour" : "Tour"}</span>
            </button>
          </div>
        </section>
        <aside className="sidebar" aria-label="Workspace sidebar" hidden={demo && !demoView.panel}>
          <SidebarResizer />
          <div className="sidebar-tabs">
            <div className="mode-switch" role="tablist" aria-label="Workspace mode">
              {MODES.map((m, index) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  id={`mode-${m.id}`}
                  className="mode-tab"
                  tabIndex={mode === m.id ? 0 : -1}
                  aria-selected={mode === m.id}
                  aria-controls="workspace-panel"
                  title={m.hint}
                  onClick={() => switchMode(m.id)}
                  onKeyDown={(event) => onModeTabKeyDown(event, index)}
                >
                  {m.label}
                  {m.id === "mine" && notebook.findings.length > 0 && (
                    <span className="mode-count">{notebook.findings.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div
            id="workspace-panel"
            className="sidebar-panel"
            role="tabpanel"
            aria-labelledby={`mode-${mode}`}
            ref={sidebarRef}
            hidden={!panelOpen}
          >
            <div id="panel-list" className="sidebar-scroll" hidden={showDetails}>
              {mode === "stories" && view === "finding" && openFinding && (
                <div className="findings-open">
                  <button type="button" className="btn btn-link" onClick={() => setOpenFinding(null)}>
                    {story ? "← Back to the story" : "← All stories"}
                  </button>
                  <FindingCard
                    key={`${openFinding.slug}/${openFinding.moment ?? ""}`}
                    slug={openFinding.slug}
                    moment={openFinding.moment}
                    saved={notebook.isSaved(openFinding)}
                    onSave={(ref, card) => {
                      // The card's place may not be on the map yet: build from the card itself.
                      if (card.story.source === "site" && site?.slug === card.site.slug) {
                        const m = { ...card.claim, focus: card.claim.focus ?? card.claim.end };
                        openSaveFor(momentDraft(card.story.title, m, card.moment));
                      } else if (landSite?.slug === card.site.slug) {
                        openSaveFor(placeDraft("moment"));
                      }
                    }}
                    onShowOnMap={showFindingOnMap}
                    autoShow
                    onChangeMoment={(moment) => setOpenFinding({ ...openFinding, moment })}
                  />
                </div>
              )}
              {mode === "stories" && view !== "finding" && (
                <StoryList data={stories} selected={story?.slug} onSelect={selectStory} />
              )}
              {mode === "investigate" && (
                <PlacesList
                  loading={loading}
                  sites={sites}
                  changeTypes={changeTypes}
                  selectedSiteId={selectedSiteId}
                  onSelectSite={selectSite}
                  landSites={landChange?.sites}
                  landSlug={landSlug}
                  onSelectLand={selectLandChange}
                />
              )}
              {mode === "mine" && (
                <NotebookPanel
                  notebook={notebook}
                  onShow={showSavedFinding}
                  onOpenEvidence={(f) => openFindingCard({ slug: f.source.slug, moment: f.source.moment, title: f.title })}
                />
              )}
            </div>
            {/* Kept mounted while another tab shows, so a search or a profile isn't run again. */}
            <div id="selection-details" className="sidebar-scroll" hidden={!showDetails}>
              {details}
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
                      focusBbox={site?.bbox ?? pendingSite?.bbox ?? aoi?.bbox ?? landSite?.bbox ?? profileBbox ?? tourFocus}
                      focusObstructionRef={evidenceRef}
                      sceneOverlay={sceneOverlay}
                      footprintOverlay={footprintOverlay}
                      referencePoint={site?.reference ?? null}
                      regionLayers={regionLayers}
                      studyLayers={studyLayers}
                      showFocusOutline={!profileLine && !(tourFocus && nothingSelected)}
                      focusMaxZoom={landSite ? 14 : tourFocus ? 13 : 11}
                      tourMarks={touring ? tourMarks : null}
                      onSelectSite={touring ? ignore : selectSiteOnMap}
                      onSelectPlace={touring ? ignore : selectPlaceOnMap}
                      onMapClick={touring || mode !== "investigate" ? ignore : selectPoint}
                      fitKey={touring ? tourRefit : 0}
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
                    <div className="map-draw-tools" role="group" aria-label="Drawing tools">
                      <button
                        type="button"
                        ref={drawButtonRef}
                        data-tour="draw-area"
                        className="btn map-action draw-action"
                        aria-pressed={drawing === "area"}
                        aria-describedby={drawing === "area" ? "draw-instructions" : undefined}
                        onClick={() => toggleDraw("area")}
                      >
                        <Icon name="drawArea" size={16} strokeWidth={2} />
                        <span className="map-action-label">Draw area</span>
                      </button>
                      <button
                        type="button"
                        ref={lineButtonRef}
                        data-tour="draw-line"
                        className="btn map-action draw-action"
                        aria-pressed={drawing === "line"}
                        aria-describedby={drawing === "line" ? "draw-instructions" : undefined}
                        title="Draw a line to see a height profile over time"
                        onClick={() => toggleDraw("line")}
                      >
                        <Icon name="drawLine" size={16} strokeWidth={2} />
                        <span className="map-action-label">Draw line</span>
                      </button>
                      {(aoi || profileLine) && (
                        <button
                          type="button"
                          className="btn map-action"
                          title="Remove what you drew from the map"
                          onClick={clearDrawing}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                  {!demo && evidence && (
                    <div className="map-evidence" ref={evidenceRef} hidden={Boolean(drawing)} data-tour-active={touring}>
                      {evidence}
                    </div>
                  )}
                </div>
                {timeline}
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
        <div className="save-toast" role="status">
          Saved “{savedNote}” to My findings.
          {mode !== "mine" && !touring && (
            <button type="button" className="btn btn-link" onClick={() => switchMode("mine")}>Open</button>
          )}
        </div>
      )}
      {touring && demo && (
        <DemoTour
          state={{ drawing, aoiDrawn: Boolean(aoi?.drawn), profileLine: Boolean(profileLine) }}
          actions={tourActions}
          onEnd={endDemo}
          onView={setDemoView}
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
            snapped: tourSnapped,
            landDate: landDates?.to ?? null,
          }}
          actions={tourActions}
          onEnd={endTour}
        />
      )}
    </div>
  );
}
