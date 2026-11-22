import { Cartesian2, Cartesian3, HeadingPitchRange, Math as CesiumMath, Matrix4 } from "cesium";

import { GLOBE_HOME } from "../../services/globe.js";

const TILTED = CesiumMath.toRadians(-30);
const TOP_DOWN = CesiumMath.toRadians(-90);

/** The point on the Earth at the middle of the view (null when it shows space there). */
function viewCenter(scene) {
  const { clientWidth, clientHeight } = scene.canvas;
  return scene.camera.pickEllipsoid(new Cartesian2(clientWidth / 2, clientHeight / 2), scene.globe.ellipsoid) ?? null;
}

/** Turns the camera about the middle of the view to `heading` and `pitch`, keeping its distance. */
function orbit(scene, { heading, pitch }) {
  const camera = scene.camera;
  const center = viewCenter(scene);
  if (!center) return;
  const range = Cartesian3.distance(camera.positionWC, center);
  camera.lookAt(center, new HeadingPitchRange(heading ?? camera.heading, pitch ?? camera.pitch, range));
  camera.lookAtTransform(Matrix4.IDENTITY);
  scene.requestRender();
}

const zoom = (scene, factor) => {
  const height = scene.camera.positionCartographic.height;
  if (factor > 1) scene.camera.zoomOut(height * (factor - 1));
  else scene.camera.zoomIn(height * (1 - factor));
  scene.requestRender();
};

/**
 * Buttons for what the mouse does (zoom, tilt, north up, the whole Earth),
 * for keyboards and touch screens, and place names on or off. The title says
 * the mouse controls.
 */
export default function GlobeControls({ scene, reducedMotion, namesShown, onToggleNames }) {
  const tilted = () => scene.camera.pitch > CesiumMath.toRadians(-60);
  const home = () =>
    scene.camera.flyTo({
      destination: Cartesian3.fromDegrees(GLOBE_HOME.lon, GLOBE_HOME.lat, GLOBE_HOME.height),
      orientation: { heading: 0, pitch: TOP_DOWN, roll: 0 },
      duration: reducedMotion ? 0 : 2,
    });
  return (
    <div className="globe-controls" role="group" aria-label="Globe controls" title="Drag to spin · scroll to zoom · right-drag: sideways turns, up and down zooms · middle- or Shift-drag tilts">
      <button type="button" aria-label="Zoom in" onClick={() => zoom(scene, 0.5)}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoom(scene, 2)}>−</button>
      <button type="button" aria-label="Tilt the view, or look straight down" onClick={() => orbit(scene, { pitch: tilted() ? TOP_DOWN : TILTED })}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 18 9 7h6l6 11Z" />
        </svg>
      </button>
      <button type="button" aria-label="North up" onClick={() => orbit(scene, { heading: 0 })}>N</button>
      <button type="button" aria-label="Show the whole Earth" onClick={home}>⌂</button>
      <button type="button" aria-label="Place names" aria-pressed={namesShown} title="Place names and borders" onClick={onToggleNames}>
        Aa
      </button>
    </div>
  );
}
