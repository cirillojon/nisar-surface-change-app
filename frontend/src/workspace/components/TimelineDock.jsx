import LandPlayer from "../../components/LandPlayer.jsx";
import ScenePlayer from "../../components/ScenePlayer.jsx";

/**
 * The dock under the map: time, layer and opacity for whatever is on it —
 * a gallery place (or the tour's Kīlauea imagery), or a study site's passes.
 * The workspace keeps it mounted while the tabs and the panel change, so a
 * time-lapse keeps its date, layer and playback. `hostRef` receives the
 * dock's element, where panels portal their own timelines.
 */
export default function TimelineDock({
  hostRef,
  inert,
  opacity,
  onOpacityChange,
  colourLegend,
  // A gallery place, or the tours' Kīlauea box played like one (useLandPlayer).
  land,
  landKey,
  onLandLayerChange,
  onLandShiftChange,
  guideDates,
  // A study site's passes (hidden while the catalog's images are on the map).
  site,
  catalogOnMap,
  sceneIndex,
  onSceneIndexChange,
  siteLegend,
  siteLayers,
  siteLayer,
  onSiteLayerChange,
  mapSiteUrl,
}) {
  let player = null;
  if (land.site) {
    player = (
      <LandPlayer
        key={landKey}
        player={land}
        opacity={opacity}
        onOpacityChange={onOpacityChange}
        onLayerChange={onLandLayerChange}
        onRemoveShiftChange={onLandShiftChange}
        guideDates={guideDates}
        colourLegend={colourLegend}
      />
    );
  } else if (site?.scenes?.length > 0 && !catalogOnMap) {
    player = (
      <ScenePlayer
        key={site.id}
        scenes={site.scenes}
        index={sceneIndex}
        onIndexChange={onSceneIndexChange}
        opacity={opacity}
        onOpacityChange={onOpacityChange}
        product={site.product}
        imageRange={site.image_range}
        legend={siteLegend.text}
        ramp={siteLegend.ramp}
        layers={siteLayers}
        layer={siteLayer}
        onLayerChange={onSiteLayerChange}
        imageUrl={siteLayers ? mapSiteUrl : undefined}
        docked
      />
    );
  }

  return (
    <div className="map-timeline" ref={hostRef} inert={inert}>
      {player}
    </div>
  );
}
