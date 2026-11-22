import { Suspense, lazy } from "react";

import ChangeMap from "../../components/ChangeMap.jsx";
import ErrorBoundary from "../../components/ErrorBoundary.jsx";
import ImpactChain from "../../components/ImpactChain.jsx";
import SaveFindingDialog from "../../components/SaveFindingDialog.jsx";
import SidebarResizer from "../../components/SidebarResizer.jsx";
import { CatalogContext } from "../../components/catalog/CatalogContext.js";
import DemoTour from "../../components/tour/DemoTour.jsx";
import Tour from "../../components/tour/Tour.jsx";
import { evidenceSubjectOf, moreSeriesOf } from "../workspaceView.js";
import DrawTools from "./DrawTools.jsx";
import MapHeader from "./MapHeader.jsx";
import MapViewToggle from "./MapViewToggle.jsx";
import ModeTabs from "./ModeTabs.jsx";
import PanelLists from "./PanelLists.jsx";
import SaveToast from "./SaveToast.jsx";
import SelectionDetails from "./SelectionDetails.jsx";
import TimelineDock from "./TimelineDock.jsx";

// The layout of the map workspace, drawn from `ws` (workspace/useWorkspace.js):
// its state, what it shows, and what it does.

const ignore = () => {};

// CesiumJS is large: the globe loads only when someone switches to 3D.
const GlobeMap = lazy(() => import("../../components/GlobeMap.jsx"));

/** Each tab's list (stories, an evidence card, places, My findings). */
function ListPanel({ ws }) {
  const { act, data, ui, v, notebook } = ws;
  const { openFinding } = ui;
  return (
    <PanelLists
      mode={ui.mode}
      view={v.view}
      stories={data.stories}
      story={v.story}
      onSelectStory={act.selectStory}
      storyList={ui.storyList}
      onStoryListChange={ui.setStoryList}
      openFinding={openFinding}
      onCloseFinding={() => ui.setOpenFinding(null)}
      onChangeFindingMoment={(moment) => ui.setOpenFinding({ ...openFinding, moment })}
      findingSaved={openFinding ? notebook.isSaved(openFinding) : false}
      onSaveFinding={act.saveFindingCard}
      onShowFindingOnMap={act.showFindingOnMap}
      loading={data.loading}
      sites={data.sites}
      changeTypes={data.changeTypes}
      selectedSiteId={v.selectedSiteId}
      onSelectSite={act.selectSite}
      landSites={data.landChange?.sites}
      landSlug={v.landSlug}
      onSelectLand={act.selectLandChange}
      notebook={notebook}
      onShowSaved={act.showSavedFinding}
      onOpenEvidence={(f) => act.openFindingCard({ slug: f.source.slug, moment: f.source.moment, title: f.title })}
    />
  );
}

/** The selection's own panel (a story, a place's details), with the catalog search it may hold. */
function DetailsPanel({ ws }) {
  const { act, data, sel, ui, v, siteQuery, land } = ws;
  return (
    <CatalogContext.Provider value={ws.catalog}>
      <SelectionDetails
        onBack={act.backToList}
        changeTypeOf={data.changeTypeOf}
        landSite={v.landSite}
        landLayer={sel.landLayer}
        onLandLayerChange={sel.setLandLayer}
        profileLine={v.profileLine}
        site={v.site}
        selectedDate={v.shownDate ?? undefined}
        onSceneIndexChange={sel.setSceneIndex}
        catalogOpen={sel.catalogOpen}
        onCatalogToggle={act.toggleCatalog}
        granuleProps={{
          products: data.products,
          onBack: act.backToList,
          overlayOpacity: ui.overlayOpacity,
          onOverlayOpacityChange: ui.setOverlayOpacity,
          timelineHost: ui.timelineHost,
        }}
        selectedSiteId={v.selectedSiteId}
        pendingSite={v.pendingSite}
        siteError={v.siteError}
        onRetrySite={siteQuery.retry}
        backLabel={ui.mode === "stories" && v.story ? "← All stories" : "← All places"}
        tourPlace={v.tourPlace}
        aoi={v.aoi}
        aoiImagery={v.aoiImagery}
        changeTypes={data.changeTypes}
        activeStory={v.activeStory}
        onStorySelectDate={act.onStorySelectDate}
        activeChangePair={sel.landLayer === "change" ? land.compared : null}
        onCompareImages={act.onCompareImages}
        onOpenFinding={act.openFindingCard}
        onSaveStory={(ctx) => act.openSaveFor(act.storyDraft(ctx))}
        shareOpen={sel.shareOpen}
        onShareToggle={() => sel.setShareOpen((open) => !open)}
      />
    </CatalogContext.Provider>
  );
}

/** The sidebar: its tabs, each tab's list, and the selection's panel (kept mounted, so a search or a profile isn't run again). */
function WorkspaceSidebar({ ws }) {
  const { act, ui, v, refs, notebook, tour } = ws;
  return (
    <aside className="sidebar" aria-label="Workspace sidebar" hidden={tour.demo && !tour.demoView.panel}>
      <SidebarResizer />
      <ModeTabs mode={ui.mode} onSwitch={act.switchMode} findingsCount={notebook.findings.length} />
      <div
        id="workspace-panel"
        className="sidebar-panel"
        role="tabpanel"
        aria-labelledby={`mode-${ui.mode}`}
        ref={refs.sidebarRef}
        hidden={!ui.panelOpen}
      >
        <div id="panel-list" className="sidebar-scroll" hidden={v.showDetails}>
          <ListPanel ws={ws} />
        </div>
        <div id="selection-details" className="sidebar-scroll" hidden={!v.showDetails}>
          <DetailsPanel ws={ws} />
        </div>
      </div>
    </aside>
  );
}

/** What NISAR measured at the site or area, with related series, beside the map. */
function Evidence({ ws, subject }) {
  const { act, data, sel, ui, v, catalog, tour, map } = ws;
  const { area } = subject;
  const observation = catalog.observation;
  const touring = tour.touring;
  return (
    <ImpactChain
      key={subject.key}
      siteId={subject.siteId}
      area={area}
      areaObservation={observation}
      passDates={observation?.dates ?? v.site?.scenes?.map((pass) => pass.date)}
      selectedDate={area ? observation?.date : v.scene?.date}
      passQuality={area ? null : v.scene?.quality}
      onReturnToStudy={map.catalogOnMap ? act.returnToStudy : null}
      onSelectDate={act.selectAnalysisDate}
      onSelectLayer={ws.images.siteLayers ? sel.setSiteLayer : null}
      onSaveMoment={area || touring ? null : (m) => act.openSaveFor(act.momentDraft(v.story?.title ?? v.site?.name, m, m.index))}
      keepDate={sel.keepDate}
      momentHost={ui.momentHost}
      showMomentPopup={touring && !tour.demo && !ui.drawing && !map.catalogOnMap}
      moreSeries={area ? null : moreSeriesOf(v.site, data.changeTypeOf)}
      open={touring || sel.evidenceOpen}
      onOpenChange={touring ? undefined : sel.setEvidenceOpen}
    />
  );
}

/**
 * The map: markers, the selection's image and outlines, the catalog's images,
 * drawing. The 2D map (Leaflet) or the 3D globe (CesiumJS) shows them, and
 * both draw areas and lines; the tour and the demo use the 2D map.
 */
function WorkspaceMap({ ws }) {
  const { act, data, ui, v, map, tour, refs } = ws;
  const { touring } = tour;
  const shared = {
    sites: data.sites,
    changeTypes: data.changeTypes,
    selectedSiteId: v.selectedSiteId,
    places: v.galleryPlaces,
    selectedPlace: v.landSlug,
    focusBbox: map.focusBbox,
    focusObstructionRef: refs.evidenceRef,
    sceneOverlay: map.sceneOverlay,
    footprintOverlay: map.footprintOverlay,
    referencePoint: v.site?.reference ?? null,
    regionLayers: map.regionLayers,
    studyLayers: map.studyLayers,
    showFocusOutline: map.showFocusOutline,
    focusMaxZoom: map.focusMaxZoom,
    onSelectSite: touring ? ignore : act.selectSiteOnMap,
    onSelectPlace: touring ? ignore : act.selectPlaceOnMap,
    onMapClick: touring || ui.mode !== "investigate" ? ignore : act.selectPoint,
    fitKey: touring ? tour.refit : 0,
    homeKey: ui.homeKey,
  };
  if (ws.globeShown) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<div className="map-loading" aria-hidden="true">Loading the globe…</div>}>
          <GlobeMap
            {...shared}
            drawing={ui.drawing}
            drawHost={ui.drawHost}
            onDrawArea={act.selectArea}
            onDrawLine={act.selectLine}
            onCancelDraw={act.stopDraw}
            onUnavailable={act.globeUnavailable}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary>
      <ChangeMap
        {...shared}
        tourMarks={touring ? tour.marks : null}
        onDrawArea={act.selectArea}
        onDrawLine={act.selectLine}
        finishLineWhen={touring ? (line) => line.length >= 2 : null}
        locked={touring}
        drawHint={touring && ui.drawing === "line" ? "Click the yellow A, then the yellow B." : null}
        drawHost={ui.drawHost}
        drawing={ui.drawing}
        onCancelDraw={act.stopDraw}
      />
    </ErrorBoundary>
  );
}

/** The dock under the map: time, layer and opacity for whatever is on it. */
function WorkspaceDock({ ws }) {
  const { data, sel, ui, v, map, tour, land, images } = ws;
  return (
    <TimelineDock
      hostRef={ui.setTimelineHost}
      inert={Boolean(ui.drawing)}
      opacity={ui.overlayOpacity}
      onOpacityChange={ui.setOverlayOpacity}
      colorLegend={data.backscatterLegend}
      land={land}
      comparison={v.landSite ? sel.comparison : images.comparison}
      landKey={v.tourPlace ? `tour-${v.aoi.imagery}` : v.landSite?.slug}
      onLandLayerChange={sel.setLandLayer}
      onLandShiftChange={sel.setLandShift}
      guideDates={tour.touring ? tour.guide : null}
      site={v.site}
      catalogOnMap={map.catalogOnMap}
      sceneIndex={v.sceneIndex}
      onSceneIndexChange={sel.setSceneIndex}
      siteLegend={map.siteLegend}
      siteLayers={images.siteLayers}
      siteLayer={sel.siteLayer}
      onSiteLayerChange={sel.setSiteLayer}
      mapSiteUrl={images.mapSiteUrl}
    />
  );
}

/** The map pane: the map with its drawing tools and evidence card over it, and the dock under it. */
function MapPane({ ws }) {
  const { act, data, ui, v, refs, tour } = ws;
  const subject = evidenceSubjectOf({ v, catalog: ws.catalog });
  const evidence = subject && <Evidence ws={ws} subject={subject} />;
  return (
    <main className="workspace" aria-labelledby="map-title" ref={refs.workspaceRef}>
      <section className="map-pane" aria-labelledby="map-title">
        <div className="map-stage">
          {data.error && <p className="workspace-status error" role="alert">{data.error}</p>}
          <div className="map-frame" aria-label="NISAR map" ref={refs.mapFrameRef}>
            <div className="map-canvas">
              <WorkspaceMap ws={ws} />
              {!tour.touring && !tour.demo && (
                <MapViewToggle view={ws.globeShown ? "3d" : "2d"} globeUnavailable={ui.globeUnavailable} onChange={act.setMapView} />
              )}
              {/* The map's drawing bar: what to do, Finish and Cancel. */}
              <div className="draw-host" ref={ui.setDrawHost} />
              <div className="moment-host" ref={ui.setMomentHost} />
              {ui.mode === "investigate" && (
                <DrawTools
                  drawing={ui.drawing}
                  onToggle={act.toggleDraw}
                  canClear={Boolean(v.aoi || v.profileLine)}
                  onClear={act.clearDrawing}
                  areaButtonRef={refs.drawButtonRef}
                  lineButtonRef={refs.lineButtonRef}
                  onPlace={tour.touring ? null : act.selectPlace}
                />
              )}
              {!tour.demo && evidence && (
                <div className="map-evidence" ref={refs.evidenceRef} hidden={Boolean(ui.drawing)} data-tour-active={tour.touring}>
                  {evidence}
                </div>
              )}
            </div>
            <WorkspaceDock ws={ws} />
          </div>
        </div>
        {tour.demo && evidence}
      </section>
    </main>
  );
}

/** Over everything: the save dialog, the note after a save, and the tour or demo mode. */
function WorkspaceOverlays({ ws }) {
  const { act, ui, v, tour, notebook, land } = ws;
  const { touring, demo } = tour;
  const drawn = { drawing: ui.drawing, aoiDrawn: Boolean(v.aoi?.drawn), profileLine: Boolean(v.profileLine) };
  return (
    <>
      {ui.saveDraft && (
        <SaveFindingDialog
          key={ui.saveDraft.title}
          draft={ui.saveDraft}
          stories={notebook.stories}
          onSave={act.commitSave}
          onCancel={() => ui.setSaveDraft(null)}
        />
      )}
      {ui.savedNote && (
        <SaveToast title={ui.savedNote} onOpen={ui.mode !== "mine" && !touring ? () => act.switchMode("mine") : null} />
      )}
      {touring && demo && <DemoTour state={drawn} actions={tour.actions} onEnd={tour.endDemo} />}
      {touring && !demo && (
        <Tour
          state={{
            ...drawn,
            saveOpen: Boolean(ui.saveDraft),
            savedCount: notebook.findings.length,
            snapped: tour.snapped,
            landDate: v.landSite ? land.compared.to : null,
          }}
          actions={tour.actions}
          onEnd={tour.end}
        />
      )}
    </>
  );
}

/** The header over the map: the selection's title, its story's question, and the panel, Save view and Tour buttons. */
function WorkspaceHeader({ ws }) {
  const { act, ui, v, refs, tour } = ws;
  return (
    <MapHeader
      title={v.title}
      question={v.activeStory && !ui.panelOpen ? v.activeStory.question : null}
      titleRef={refs.mapTitleRef}
      panelButtonRef={refs.panelButtonRef}
      tourButtonRef={tour.buttonRef}
      panelOpen={ui.panelOpen}
      showPanelLabel={v.showPanelLabel}
      onTogglePanel={act.togglePanel}
      canSaveView={v.hasSelection && !ui.drawing}
      onSaveView={() => act.openSaveFor(act.viewDraft())}
      touring={tour.touring}
      onTourClick={act.onTourClick}
    />
  );
}

/** The workspace: the header, the sidebar and the map; in demo mode, only what the step shows. */
export default function WorkspaceLayout({ ws }) {
  const { ui, v, tour } = ws;
  const { demo, demoView } = tour;
  return (
    <div
      className="app-shell"
      data-demo={demo ? "" : undefined}
      data-demo-panel={demo && demoView.panel ? "" : undefined}
      data-demo-chain={demo && demoView.chain ? "" : undefined}
    >
      <div className="app-body" data-sidebar-open={demo ? demoView.panel : ui.panelOpen} data-map-selection={Boolean(v.title)} data-mode={ui.mode}>
        <WorkspaceHeader ws={ws} />
        <WorkspaceSidebar ws={ws} />
        <MapPane ws={ws} />
      </div>
      <WorkspaceOverlays ws={ws} />
    </div>
  );
}
