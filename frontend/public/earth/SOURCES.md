# Sources and attribution

This folder contains the NISAR homepage's runtime textures and the world maps used to bake the mobile variants. The complete authoring project, native masters, prompts, and preparation scripts are in the separate `nisar-earth-hero` package. Paths to authoring files below refer to that package. Source manifests retain the provenance of the full texture set.

The supplied **Asia-Centered Earth Horizon (1).png** is the artistic reference. The original 1775 × 887 file is retained unaltered as `public/earth/reference.png` for comparison and fallback. No ownership or license beyond the user's supplied working reference is asserted here.

## Solar System Scope maps

Earth day, night, cloud, specular/water, and normal maps are from [Solar System Scope](https://www.solarsystemscope.com/textures/), published under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Attribute Solar System Scope when using these specific adapted files.

- [Day map](https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg)
- [Night map](https://www.solarsystemscope.com/textures/download/8k_earth_nightmap.jpg)
- [Cloud map](https://www.solarsystemscope.com/textures/download/8k_earth_clouds.jpg)
- [Specular / water map](https://www.solarsystemscope.com/textures/download/8k_earth_specular_map.tif)
- [Normal map](https://www.solarsystemscope.com/textures/download/8k_earth_normal_map.tif)

These originals are 8192 × 4096. In the new world pack, they supply terrain detail, cloud detail, fine city lights, the water mask, and normals. Roughness is derived from the water mask. Changes include resizing, WebP encoding, longitude-boundary blending, polar conditioning, and shader-based color/lighting treatment. Source and output hashes are recorded in `public/earth/world-v2/manifest.json`.

The regional `world-v2/*-detail.webp` images use the same credited day map at its native resolution. The renderer's `regional-crops.json` records their source dimensions and offsets.

The `mobile` maps use the same credits. The mobile preparation script combines the authored palette with the terrain and water maps, applies that grading to the native-resolution regional crops, and blends the two cloud maps into a single density texture.

## Generated artistic maps

The built-in **image_gen** tool adapted the supplied reference and Solar System Scope maps into three coordinated full-world maps: surface palette, cloud coverage, and warm emission. A second generated albedo pass became `albedo-final.png`. These are artistic adaptations; generated detail is not verified geographic data.

Native output is **1774 × 887**. The 2K/4K delivery variants are upscaled and use separate original-detail maps in the provided renderer. The tool was used directly; no image-generation CLI fallback was used. Native masters, initial prompts, and the albedo refinement prompt are in `source/art-direction-v2/`. The initial `albedo.png` is retained for provenance; the renderer uses exports made from `albedo-final.png`.

Sharp handles technical texture preparation: scalar-channel packing, UV seam/pole conditioning, resolution variants, and encoding. The creative map edits were generated with image_gen.

Suggested credit: **Earth textures adapted from Solar System Scope (CC BY 4.0), with AI-assisted surface color, clouds, and lighting based on the supplied reference.** Link both Solar System Scope and the license when displaying this credit.

## Elevation data

The height layer comes from [NASA Earth Observatory's Blue Marble Next Generation topography atlas](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/): [21600 × 10800 elevation image](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_21600x10800.jpg). NASA describes its encoded range as 0–6400 meters. Source filename: `gebco_08_rev_elev_21600x10800.jpg`; credited to NASA Earth Observatory / Blue Marble Next Generation, using GEBCO elevation.

Adaptations: downsampling to 2K/4K, matching the water mask, longitude/pole conditioning, and lossless WebP encoding. Mesh heights and lighting slopes are exaggerated for visual readability. Source and output hashes, range, sample checks, and exact download URL are recorded in `public/earth/relief/manifest.json`. This scalar elevation layer was not AI-generated.

## Renderer implementation

Three.js is used under its MIT license; the package includes `THREE-LICENSE.txt`. [ShaderMaterial documentation](https://threejs.org/docs/pages/ShaderMaterial.html) describes the custom material mechanism. The custom atmospheric shell, palette/detail blend, and fixed hero camera are implemented in this project's source.
