# NISAR 3D asset

The deployed satellite model is checked into this repository and can be loaded locally without contacting NASA or a model hosting service.

## Files

| File | Purpose | Size |
| --- | --- | ---: |
| [`frontend/public/models/nisar/nisar-web.glb`](../../frontend/public/models/nisar/nisar-web.glb) | Recommended web model; 22,386 triangles, 7 model draw calls | 985,044 bytes |
| [`frontend/public/models/nisar/nisar-compact.glb`](../../frontend/public/models/nisar/nisar-compact.glb) | Smaller textures and simplified bus; 15,512 triangles, 7 model draw calls | 587,804 bytes |
| [`nisar-master.blend`](nisar-master.blend) | Editable Blender master with packed textures and a separate preview studio | 1,822,973 bytes |
| [`frontend/public/models/nisar/manifest.json`](../../frontend/public/models/nisar/manifest.json) | Model hashes, dimensions convention, source credit, and measured metrics | — |
| [`frontend/public/decoders/basis/`](../../frontend/public/decoders/basis/) | Shared KTX2 texture transcoder and software licenses | — |
| [`frontend/src/services/nisarModel.js`](../../frontend/src/services/nisarModel.js) | Three.js loader, model URLs, and resource cleanup | — |
| [`frontend/public/models/nisar/nisar-hero-poster.png`](../../frontend/public/models/nisar/nisar-hero-poster.png) | Transparent render used while loading and when WebGL is unavailable | — |

At the default Vite base, the web model is served at `/models/nisar/nisar-web.glb`. `npm run build` copies both models and the decoders into `frontend/dist/`; the Blender source remains outside the public build. No Git LFS or separate download step is required.

## Load into an existing Three.js scene

Three.js is pinned in `frontend/package.json`. The helper configures the Meshopt geometry decoder, KTX2 texture decoder, and reflector transparency. Import it inside the view that uses the model so other routes do not load the 3D runtime.

```js
const { createNisarLoader, NISAR_MODELS, disposeNisarModel } =
  await import("./services/nisarModel.js"); // Adjust relative to your component.

const nisarLoader = createNisarLoader(renderer);
const gltf = await nisarLoader.load(NISAR_MODELS.web);
scene.add(gltf.scene);

// Use NISAR_MODELS.compact when the model occupies a small area on screen.
// Call this on view teardown, after any pending load has completed:
const cleanup = () => {
  disposeNisarModel(gltf.scene);
  nisarLoader.dispose();
};
```

Use the existing renderer, camera, and render loop. Metallic surfaces need an environment or suitable fill lighting. Preserve the helper's transparent-material settings to match the measured seven draw calls. Model file sizes exclude Three.js and the shared decoders. The home hero now uses this loader in `nisarHeroScene.js`, with the real pass imagery and controls in `HeroObservatory.jsx`. The hero is an illustration, not live orbit tracking. See [hero implementation notes](../../docs/NISAR_HERO.md).

For React, create the loader inside an effect. If a load finishes after the effect was cleaned up, dispose that returned model immediately instead of adding it to the scene. Wait until outstanding loads settle before disposing the loader's workers. Do not dispose model resources that are still shared by a clone or a cache.

## Coordinates and accuracy

The exports use glTF's right-handed Y-up coordinates and retain the source model's meter-scale units and origin. Blender uses Z-up. Use a parent group for positioning, orientation and unit conversion. The origin may differ from the spacecraft's center of mass.

The Blender adaptation preserves the proportions of the source model. It removes a helper cube and a coincident reverse reflector surface and changes the reflector frame from bright aluminum to dark composite based on NASA's flight description. The compact export simplifies three meshes on the bus and instruments and retains the reflector, boom and solar panels.

This is an illustrative model. NASA specifies a nominal 12 m reflector; this model's reflector is approximately 12.5 m across. Exact flight geometry has not been verified. The files contain no real-time orbital location, attitude telemetry, or deployment animation.

The supplied GLBs were checked in the browser and with geometry and KTX validators. Both use full texture mip chains. The original asset pipeline reported zero geometry errors; its older glTF Validator emitted KTX2-format warnings, covered by separate Khronos KTX validation and actual GPU decoding.

## Source and attribution

Courtesy of **NASA/JPL-Caltech** via [NASA's Eyes](https://eyes.nasa.gov/apps/earth/). The editable Blender file and web exports use geometry and textures from the [original NISAR glTF](https://eyes.nasa.gov/assets/static/models/sc_nisar/Nisar.gltf). The [source manifest](nasa-source-manifest.json) records the six original files and their hashes.

The source glTF carries no model-specific license statement. The app's Apache 2.0 license covers original project material. See [NASA media-use guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/) and the [JPL image-use policy](https://www.jpl.nasa.gov/jpl-image-use-policy/) for credit and use guidance.

References used for appearance: [NISAR quick facts](https://www.jpl.nasa.gov/press-kits/nisar/quick-facts/) and the [deployed reflector description](https://www.jpl.nasa.gov/news/giant-radar-antenna-reflector-on-nasa-isro-satellite-in-full-bloom/).

The vendored Basis transcoder files are unmodified copies from Three.js 0.187.0 (Apache 2.0, Binomial LLC). Three.js and Meshoptimizer use MIT licenses. Their notices are retained in `frontend/public/decoders/basis/` and must accompany redistribution.
