import { Mesh, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// Vite's base also supports deployments under a path prefix.
const baseUrl = import.meta.env.BASE_URL;

export const NISAR_MODELS = Object.freeze({
  web: `${baseUrl}models/nisar/nisar-web.glb`,
  compact: `${baseUrl}models/nisar/nisar-compact.glb`,
});

/** Create once per renderer; dispose after its pending loads have finished. */
export function createNisarLoader(renderer, transcoderPath = `${baseUrl}decoders/basis/`) {
  const ktx = new KTX2Loader()
    .setTranscoderPath(transcoderPath)
    .setWorkerLimit(2)
    .detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);

  return {
    async load(url = NISAR_MODELS.web) {
      const result = await loader.loadAsync(url);
      result.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.transparent) {
            material.depthWrite = false;
            material.forceSinglePass = true;
          }
          for (const value of Object.values(material)) {
            if (value instanceof Texture) {
              value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            }
          }
        }
      });
      return result;
    },
    dispose() {
      ktx.dispose();
    },
  };
}

/** Release an owned model instance; do not use on resources shared with clones. */
export function disposeNisarModel(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });
  root.removeFromParent();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
