import FindingCard from "../../components/FindingCard.jsx";
import NotebookPanel from "../../components/NotebookPanel.jsx";
import PlacesList from "../../components/PlacesList.jsx";
import StoryList from "../../components/StoryList.jsx";

/**
 * Each tab's own list: Stories (or an evidence card opened from one),
 * Investigate's places, and My findings. `view` is what the panel shows
 * (navigation.js panelView).
 */
export default function PanelLists({
  mode,
  view,
  // Stories, and an open evidence card.
  stories,
  story,
  onSelectStory,
  openFinding,
  onCloseFinding,
  onChangeFindingMoment,
  findingSaved,
  onSaveFinding,
  onShowFindingOnMap,
  // Investigate.
  loading,
  sites,
  changeTypes,
  selectedSiteId,
  onSelectSite,
  landSites,
  landSlug,
  onSelectLand,
  // My findings.
  notebook,
  onShowSaved,
  onOpenEvidence,
}) {
  return (
    <>
      {mode === "stories" && view === "finding" && openFinding && (
        <div className="findings-open">
          <button type="button" className="btn btn-link" onClick={onCloseFinding}>
            {story ? "← Back to the story" : "← All stories"}
          </button>
          <FindingCard
            key={`${openFinding.slug}/${openFinding.moment ?? ""}`}
            slug={openFinding.slug}
            moment={openFinding.moment}
            saved={findingSaved}
            onSave={onSaveFinding}
            onShowOnMap={onShowFindingOnMap}
            onChangeMoment={onChangeFindingMoment}
          />
        </div>
      )}
      {mode === "stories" && view !== "finding" && (
        <StoryList data={stories} selected={story?.slug} onSelect={onSelectStory} />
      )}
      {mode === "investigate" && (
        <PlacesList
          loading={loading}
          sites={sites}
          changeTypes={changeTypes}
          selectedSiteId={selectedSiteId}
          onSelectSite={onSelectSite}
          landSites={landSites}
          landSlug={landSlug}
          onSelectLand={onSelectLand}
        />
      )}
      {mode === "mine" && <NotebookPanel notebook={notebook} onShow={onShowSaved} onOpenEvidence={onOpenEvidence} />}
    </>
  );
}
