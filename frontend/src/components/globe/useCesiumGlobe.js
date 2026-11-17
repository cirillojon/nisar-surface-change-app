import "./cesiumBase.js";
import { useEffect, useState } from "react";
import {
  CameraEventType,
  Cartesian3,
  CesiumWidget,
  Color,
  Credit,
  EllipsoidTerrainProvider,
  ImageryLayer,
  KeyboardEventModifier,
  SkyAtmosphere,
  SkyBox,
  UrlTemplateImageryProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { GLOBE_HOME, GLOBE_IMAGERY_URL, GLOBE_LABELS_URL, TILE_SUBDOMAINS } from "../../services/globe.js";
import { useStableCallback } from "../../services/useStableCallback.js";

const esriLayer = (url, credit) =>
  new ImageryLayer(new UrlTemplateImageryProvider({ url, subdomains: TILE_SUBDOMAINS, maximumLevel: 18, credit: new Credit(credit) }));

/**
 * Google Earth-style mouse controls: drag to spin the globe (freely, over
 * the poles too), scroll or right-drag to zoom, and Shift-, Ctrl- or
 * middle-drag to tilt towards the horizon. Alt-drag looks around.
 */
function setUpControls(widget) {
  const controls = widget.scene.screenSpaceCameraController;
  controls.tiltEventTypes = [
    CameraEventType.MIDDLE_DRAG,
    CameraEventType.PINCH,
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT },
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    { eventType: CameraEventType.RIGHT_DRAG, modifier: KeyboardEventModifier.CTRL },
  ];
  controls.lookEventTypes = [{ eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.ALT }];
  controls.minimumZoomDistance = 80;
  controls.maximumZoomDistance = 6e7;
  // No fixed north: the globe turns any way the drag goes, as in Google Earth.
  widget.camera.constrainedAxis = undefined;
}

/**
 * Keeps more tiles in memory, so going back over a place shows it at once,
 * and loads what is in view first (coarser tiles stand in until the sharp
 * ones arrive, as in Google Earth).
 */
function tuneLoading(globe) {
  globe.tileCacheSize = 600;
  globe.preloadAncestors = true;
  globe.preloadSiblings = false;
  globe.loadingDescendantLimit = 40;
  globe.showGroundAtmosphere = true;
  // Ground whose tiles haven't arrived yet is a dark ocean blue, not Cesium's bright default.
  globe.baseColor = Color.fromCssColorString("#0a1a2f");
  // Markers and lines on the far side of the Earth are hidden by it.
  globe.depthTestAgainstTerrain = true;
}

function createGlobe(container) {
  const widget = new CesiumWidget(container, {
    baseLayer: esriLayer(GLOBE_IMAGERY_URL, "Esri, Maxar, Earthstar Geographics, GIS User Community"),
    terrainProvider: new EllipsoidTerrainProvider(),
    // The Milky Way and the stars around the Earth, and a glowing atmosphere at its rim.
    skyBox: SkyBox.createEarthSkyBox(),
    skyAtmosphere: new SkyAtmosphere(),
    // Draw only when something changes: a still globe costs nothing.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    msaaSamples: 4,
  });
  const labels = esriLayer(GLOBE_LABELS_URL, "Labels © Esri");
  widget.imageryLayers.add(labels);
  setUpControls(widget);
  tuneLoading(widget.scene.globe);
  widget.camera.setView({ destination: Cartesian3.fromDegrees(GLOBE_HOME.lon, GLOBE_HOME.lat, GLOBE_HOME.height) });
  return { widget, labels };
}

/**
 * The Cesium globe in `containerRef` ({widget, labels}, null until made).
 * Calls `onUnavailable` where the browser can't draw it (no WebGL).
 */
export function useCesiumGlobe(containerRef, onUnavailable) {
  const [globe, setGlobe] = useState(null);
  const unavailable = useStableCallback(onUnavailable);
  useEffect(() => {
    let made;
    try {
      made = createGlobe(containerRef.current);
    } catch {
      unavailable();
      return undefined;
    }
    setGlobe(made);
    return () => {
      setGlobe(null);
      if (!made.widget.isDestroyed()) made.widget.destroy();
    };
  }, [containerRef, unavailable]);
  return globe;
}
