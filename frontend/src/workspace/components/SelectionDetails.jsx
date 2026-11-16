import AoiPanel from "../../components/AoiPanel.jsx";
import CoverageCheck from "../../components/CoverageCheck.jsx";
import LandChangePanel from "../../components/LandChangePanel.jsx";
import ProfilePanel from "../../components/ProfilePanel.jsx";
import SiteDetail from "../../components/SiteDetail.jsx";
import SitePending from "../../components/SitePending.jsx";
import StoryPanel from "../../components/StoryPanel.jsx";

/** The tours' Kīlauea box: its imagery ships with the app and plays in the dock. */
function TourAreaPanel({ place, onBack }) {
  return (
    <article className="panel detail" aria-label="Selected area">
      <button type="button" className="btn btn-link" onClick={onBack}>
        ← All places
      </button>
      <p className="muted small detail-meta">Kīlauea summit · {place.region}</p>
      <p>
        Every NISAR pass over the summit caldera, {place.passes.length} of them on frame{" "}
        <code>{place.frame}</code>, ~{place.pixel_m} m pixels. Play them under the map.
      </p>
    </article>
  );
}

/**
 * The side panel's view of what is selected on the map: a gallery place, a
 * profile line, a study site (or one still loading), the tour's box, or a
 * searched area — in that order. In Stories, a selection with a story is
 * shown inside its StoryPanel. Renders nothing when nothing is selected.
 */
export default function SelectionDetails({
  onBack,
  changeTypeOf,
  // A gallery place.
  landSite,
  landLayer,
  onLandLayerChange,
  // A drawn line.
  profileLine,
  // A study site.
  site,
  selectedDate,
  onSceneIndexChange,
  catalogOpen,
  onCatalogToggle,
  granuleProps,
  // A site picked but not loaded yet.
  selectedSiteId,
  pendingSite,
  siteError,
  onRetrySite,
  backLabel,
  // The tours' box, or an area drawn or clicked.
  tourPlace,
  aoi,
  aoiImagery,
  changeTypes,
  // The story shown around the selection, and what its panel does.
  activeStory,
  onStorySelectDate,
  activeChangePair,
  onCompareImages,
  onOpenFinding,
  onSaveStory,
  shareOpen,
  onShareToggle,
}) {
  const embedded = Boolean(activeStory);
  let details = null;
  if (landSite) {
    details = (
      <LandChangePanel
        key={landSite.slug}
        site={landSite}
        onBack={onBack}
        changeShown={landLayer === "change"}
        onToggleChange={
          landSite.passes?.some((p) => p.hh_url)
            ? () => onLandLayerChange((layer) => (layer === "change" ? null : "change"))
            : null
        }
        embedded={embedded}
      />
    );
  } else if (profileLine) {
    details = <ProfilePanel key={JSON.stringify(profileLine)} line={profileLine} onBack={onBack} />;
  } else if (site) {
    details = (
      <SiteDetail
        key={site.id}
        site={site}
        changeType={changeTypeOf(site.change_type)}
        selectedDate={selectedDate}
        onSceneIndexChange={onSceneIndexChange}
        catalogOpen={catalogOpen}
        onCatalogToggle={onCatalogToggle}
        embedded={embedded}
        {...granuleProps}
      />
    );
  } else if (tourPlace) {
    // No catalog search, no NASA browse images: the box plays like a gallery place.
    details = <TourAreaPanel place={tourPlace} onBack={onBack} />;
  } else if (aoi) {
    details = (
      <AoiPanel
        key={aoi.bbox.join(",")}
        aoi={aoi}
        changeTypes={changeTypes}
        imagery={aoiImagery}
        {...granuleProps}
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
        onRetry={onRetrySite}
        onBack={onBack}
        backLabel={backLabel}
        embedded={embedded}
      />
    );
  }

  if (!activeStory || !details) return details;
  return (
    <StoryPanel
      key={activeStory.slug}
      slug={activeStory.slug}
      summary={activeStory}
      selectedDate={selectedDate}
      onSelectDate={onStorySelectDate}
      activeChangePair={activeChangePair}
      onCompareImages={onCompareImages}
      onOpenFinding={onOpenFinding}
      onSave={onSaveStory}
      shareOpen={shareOpen}
      onShareToggle={onShareToggle}
      onBack={onBack}
    >
      {details}
    </StoryPanel>
  );
}
