// What the workspace shows, worked out from its state: the selection in
// detail, the side panel's view, the catalog's area, what goes on the map and
// what the evidence card charts. Plain functions, so WorkspaceApp and its
// layout only read the results.

import { assetUrl } from "../services/api.js";
import { imageLayerOptions, layerLegend } from "../services/layers.js";
import { siteSeries } from "../services/measurements.js";
import { footprintOverlay, profileLayers } from "./mapLayers.js";
import { panelView } from "./navigation.js";
import { defaultSceneIndex } from "./state/selection.js";

/** The selection's title over the map: a place, the line, a site (or one loading), an area. */
function selectionTitle({ landSite, profileLine, site, pendingSite, aoi }) {
  if (landSite) return landSite.name;
  if (profileLine) return "Height profile";
  const named = site?.name ?? pendingSite?.name;
  if (named) return named;
  if (!aoi) return null;
  return aoi.drawn ? "Drawn area" : "Selected area";
}

/** The tours' Kīlauea box, drawn on its own imagery: it opens on the first pass, so the timelapse runs forward. */
function tourPlaceOf(aoi, imagery) {
  if (!imagery) return null;
  const firstPass = imagery.passes?.[0]?.date;
  return { ...imagery, bbox: aoi.bbox, suggested: [firstPass, firstPass] };
}

/**
 * The selection in detail: what is selected (a site, place, area or line),
 * the site's pass shown, the place or site just picked, its story, the tour's
 * box, and what the side panel shows of it.
 */
export function selectionOf({ sel, site, siteError, data, mode, openFinding }) {
  const { target } = sel;
  const selectedSiteId = target?.kind === "site" ? target.id : null;
  const landSlug = target?.kind === "place" ? target.slug : null;
  const aoi = target?.kind === "area" ? target.aoi : null;
  const profileLine = target?.kind === "line" ? target.line : null;
  // The pass shown: the one picked, else the date asked for (a link, a finding), else the latest.
  const sceneIndex = sel.sceneIndex ?? defaultSceneIndex(site, sel.pendingDate);
  const scene = site?.scenes?.[sceneIndex];
  // A study site that was just picked, from its list row, until its passes arrive.
  const pendingSite = selectedSiteId !== null && !site ? data.sites.find((s) => s.id === selectedSiteId) ?? null : null;
  const landSite = landSlug ? data.landChange?.sites.find((s) => s.slug === landSlug) ?? null : null;
  // In Stories, a site or place with a story shows that story, its data panel inside.
  const story = data.storyIndex.get(site?.slug ?? pendingSite?.slug ?? landSite?.slug) ?? null;
  // The tours' Kīlauea box plays its own imagery (no catalog search).
  const aoiImagery = aoi?.imagery ? data.landChange?.imagery?.[aoi.imagery] ?? null : null;
  // Is something selected? Its panel (SelectionDetails) shows one of: a
  // gallery place, a line, a site (loaded or loading), the tour's box or an area.
  const hasSelection = Boolean(landSite || profileLine || site || aoi) || selectedSiteId !== null;
  // What the side panel holds: this tab's view of the selection where it has one, otherwise its list.
  const view = panelView({ mode, hasStory: Boolean(story), hasSelection, findingOpen: Boolean(openFinding) });
  return {
    selectedSiteId,
    landSlug,
    aoi,
    profileLine,
    site,
    siteError,
    sceneIndex,
    scene,
    shownDate: scene?.date ?? null,
    pendingSite,
    landSite,
    story,
    activeStory: mode === "stories" && !siteError ? story : null,
    aoiImagery,
    tourPlace: tourPlaceOf(aoi, aoiImagery),
    hasSelection,
    view,
    // The selection's own panel (a story, a place's details); a finding card and every list live in the other one.
    showDetails: view === "story" || view === "details",
    showPanelLabel: mode === "mine" ? "Show My findings" : `Show ${view}`,
    title: selectionTitle({ landSite, profileLine, site, pendingSite, aoi }),
    // Gallery places that show something, as markers beside the study sites.
    galleryPlaces: (data.landChange?.sites ?? []).filter((s) => s.status !== "not_visible"),
  };
}

/** The NISAR catalog over a drawn area, or a study site's while it is open (null: none). */
export function catalogTargetOf({ v, data, catalogOpen, touring }) {
  if (v.aoi && !v.aoiImagery) {
    // The tour's steps are for backscatter only.
    return { bbox: v.aoi.bbox, defaultProduct: data.changeTypes[0]?.product ?? "GCOV", imagery: null, lockedProduct: touring ? "GCOV" : null };
  }
  if (v.site && catalogOpen) {
    return { bbox: v.site.bbox, defaultProduct: data.changeTypeOf(v.site.change_type)?.product ?? "GCOV", imagery: null, lockedProduct: null };
  }
  return null;
}

/**
 * A backscatter site's image layers (HH, HV, the open-water mask, if its data
 * has them; ground-motion sites have just their displacement), and every
 * image the layer mapper may draw.
 */
export function siteImagesOf(site, scene) {
  if (site?.product !== "GCOV") return { siteLayers: null, items: [] };
  const metrics = new Set((site.observations ?? []).map((o) => o.metric));
  return {
    siteLayers: imageLayerOptions({ hh: metrics.has("hh_db"), hv: metrics.has("hv_db") }),
    items: [scene, ...(site.scenes ?? [])].filter((s) => s?.image_url).map((s) => ({ url: assetUrl(s.image_url) })),
  };
}

/** The image on the map: a place's (or the tour's), else the site's pass in its layer, unless the catalog's images are shown. */
function sceneOverlayOf({ v, land, catalogOnMap, siteLayers, mapSiteUrl, opacity }) {
  if (land.overlay) return { ...land.overlay, opacity };
  if (catalogOnMap || !v.scene?.image_url) return null;
  const url = assetUrl(v.scene.image_url);
  return { url: siteLayers ? mapSiteUrl(url) : url, bbox: v.site.bbox, opacity };
}

/** Where the map zooms: the selection, else the line, else where the tour holds it. */
function focusOf(v, profileBbox, tourFocus) {
  return v.site?.bbox ?? v.pendingSite?.bbox ?? v.aoi?.bbox ?? v.landSite?.bbox ?? profileBbox ?? tourFocus;
}

/** What goes on the map, and the site player's legend. */
export function mapViewOf({ v, sel, data, land, catalog, tour, siteLayers, mapSiteUrl, opacity }) {
  const regionLayers = catalog.mapLayers;
  const catalogOnMap = Boolean(v.site && sel.catalogOpen && regionLayers?.mode);
  const { bbox: profileBbox, layers: studyLayers } = profileLayers(v.profileLine);
  const legendOf = data.changeTypeOf(v.site?.change_type)?.image_legend;
  return {
    regionLayers,
    catalogOnMap,
    studyLayers,
    focusBbox: focusOf(v, profileBbox, tour.focus),
    sceneOverlay: sceneOverlayOf({ v, land, catalogOnMap, siteLayers, mapSiteUrl, opacity }),
    // The part of a site's box some pass didn't image, hatched, while open water (compared over the rest) is what the site charts.
    footprintOverlay: footprintOverlay({ site: v.site, siteLayer: sel.siteLayer, hidden: catalogOnMap || Boolean(v.landSite), toUrl: assetUrl }),
    showFocusOutline: !v.profileLine && !(tour.focus && !v.hasSelection),
    focusMaxZoom: v.landSite ? 14 : tour.focus ? 13 : 11,
    siteLegend: v.site ? layerLegend(siteLayers ? sel.siteLayer : "colour", legendOf) : { ramp: null, text: null },
  };
}

/**
 * The evidence card's subject: a drawn area over its search dates, or a site
 * (as soon as it is picked, so the map is laid out once and its record loads
 * alongside its passes). Null: no card.
 */
export function evidenceSubjectOf({ v, catalog }) {
  const area = v.aoi && !v.tourPlace
    ? { bbox: v.aoi.bbox.join(","), start: catalog.results.query?.start, end: catalog.results.query?.end }
    : null;
  const siteId = v.site?.id ?? (v.siteError ? null : v.pendingSite?.id) ?? null;
  if (!area && siteId == null) return null;
  return { area, siteId, key: area?.bbox ?? siteId };
}

/** The site's other series, charted beside its story. */
export function moreSeriesOf(site, changeTypeOf) {
  return site?.story_metric ? siteSeries(changeTypeOf(site.change_type), site.observations, site.story_metric) : null;
}
