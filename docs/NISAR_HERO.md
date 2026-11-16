# NISAR home hero

The home page places the deployed satellite above the existing Sylhet radar time-lapse. Both the spacecraft and the image plane are rendered in one Three.js scene, so the radar beam, image badge, and component leaders stay aligned when the viewport changes. The satellite has warm key lighting, a violet rim, and an overhead spotlight. Pointer movement adds a small, settling parallax to the model.

## Visual target

The user-provided hero mockup is the primary reference: left-aligned headline and actions; an open, unboxed satellite scene on the right; an oblique, shallow radar image plane below the satellite; restrained violet lighting; component labels and the existing pass controls. Existing BDO Grotesk and theme tokens are retained, including light mode.

Refero's SpaceX reference informed the continuous media backdrop, and its VITURE reference informed lighting the actual object instead of surrounding it with a card. These references contribute only scene treatment; the supplied mockup owns the layout and the app owns its typography, actions, and data.

| Decision | Source | Implementation |
| --- | --- | --- |
| Satellite above a flattened image plane | User mockup | Fixed orthographic camera; image plane with a small shear |
| Warm overhead light and violet edges | User mockup; VITURE object lighting | Environment, key/fill/rim lights, overhead spotlight; no bloom pass |
| Continuous backdrop | User mockup; SpaceX media treatment | Transparent canvas and a restrained CSS light pool |
| Real images, dates, and water values | Existing home page and API | Same Sylhet site, scene URLs, and observations; no synthesized radar imagery |
| Playback and fallback | App behavior and motion/accessibility requirements | Pause/select controls, reduced-motion default, static rendered poster |

## Files and lifecycle

- `frontend/src/platform/HeroObservatory.jsx` owns data, playback, accessible controls, and fallback UI.
- `frontend/src/services/nisarHeroScene.js` is dynamically imported on the home page. It owns rendering, image decoding, projection, and cleanup.
- `frontend/src/services/nisarModel.js` supplies the shared GLB loader and model disposal.
- `frontend/public/models/nisar/nisar-hero-poster.png` is a transparent render of this same model and camera, used while loading or when WebGL fails.

The main model retains seven draw calls. The image and illustrative beam add two, for nine scene draw calls. Device pixel ratio is capped at 1.75. There are no shadow-map or postprocessing passes. The scene renders on demand, with short updates during image crossfades and pointer settling. Image textures are retained in a bounded cache of three; active crossfade textures are protected until the transition completes. In-flight image requests may briefly exceed that count.

Both playback and rendering suspend while offscreen or when the document is hidden. Reduced-motion users start with playback paused and no pointer parallax. They can explicitly play the radar sequence. Unmounting removes observers and listeners and releases GPU resources; loader workers are disposed after any pending model load settles. Failed WebGL initialization, failed model loading, and context loss use the static fallback.

The plane respects source image alpha. Missing pixels stay dark rather than displaying RGB values hidden by the source alpha channel. A failed image request shows an unavailable message and clears the previous GPU image so its pixels are not shown beneath the new date.

The beam, satellite placement, and relative scale are illustrative. They do not depict current spacecraft location, attitude, footprint, or live telemetry. The UI labels the illustration as not to scale.

## Verification

The frontend suite covers selection/image/value agreement, reduced-motion playback, offscreen pausing, timer cleanup, and failed site loading. Browser validation additionally checks actual GPU decoding, rendering inactivity while paused/offscreen, bounded texture use across all 12 passes, desktop/mobile layouts, light/dark themes, route remounts, no-WebGL/model-failure fallbacks, and the production bundle. Source GLBs are unchanged.

To refresh the poster after art-direction changes, open the home page in the Vite dev server and use the dev-only `document.querySelector('.pf-hero-stage').__nisarHero.poster()` method once the model is ready. It returns a transparent PNG data URL with the plane and beam hidden. This hook is excluded from production builds.
