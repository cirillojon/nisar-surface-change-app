import { Cartesian2, Cartesian3, Matrix4, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from "cesium";

// A drag across about 600 px turns the view half way round.
const TURN_PER_PX = Math.PI / 600;
// Each pixel dragged up or down changes the distance to the middle of the view by this share.
const ZOOM_PER_PX = 0.004;

/** Moves the camera along its view by `share` of `distance` (negative: away), no closer than `closest`. */
function dolly(camera, distance, share, closest) {
  const step = Math.min(distance * share, distance - closest);
  if (step > 0) camera.zoomIn(step);
  else if (step < 0) camera.zoomOut(-step);
}

/**
 * Google Earth's right-drag: sideways turns the view about the middle of
 * the screen, down zooms in and up zooms out, towards that same spot. The
 * place in the middle stays where it is the whole time. (Middle-, Shift- and
 * Ctrl-drag tilt and turn, set up in useCesiumGlobe.js.) Returns a cleanup.
 */
export function addTurnAndZoom(scene) {
  const camera = scene.camera;
  const controls = scene.screenSpaceCameraController;
  const handler = new ScreenSpaceEventHandler(scene.canvas);
  let drag = null;

  handler.setInputAction((e) => {
    // Taking hold of the view stops a fly-to, as dragging does.
    camera.cancelFlight();
    const middle = new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
    const center = camera.pickEllipsoid(middle, scene.globe.ellipsoid);
    // On the Earth, turn about the ground's "up" there; in space, about the Earth's center.
    drag = { last: Cartesian2.clone(e.position), frame: center ? Transforms.eastNorthUpToFixedFrame(center) : Matrix4.IDENTITY };
  }, ScreenSpaceEventType.RIGHT_DOWN);

  handler.setInputAction((e) => {
    if (!drag || !controls.enableInputs) return;
    const dx = e.endPosition.x - drag.last.x;
    const dy = e.endPosition.y - drag.last.y;
    drag.last = Cartesian2.clone(e.endPosition, drag.last);
    camera.lookAtTransform(drag.frame);
    // About the frame's own vertical (the ground's up there), not the camera's.
    if (dx) camera.rotate(Cartesian3.UNIT_Z, dx * TURN_PER_PX);
    if (dy) dolly(camera, Cartesian3.magnitude(camera.position), dy * ZOOM_PER_PX, controls.minimumZoomDistance);
    camera.lookAtTransform(Matrix4.IDENTITY);
    scene.requestRender();
  }, ScreenSpaceEventType.MOUSE_MOVE);

  const end = () => {
    drag = null;
  };
  handler.setInputAction(end, ScreenSpaceEventType.RIGHT_UP);
  return () => handler.destroy();
}
