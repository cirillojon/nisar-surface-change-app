// Where CesiumJS finds its workers, star textures and other run-time files
// (copied there by the cesium-assets plugin in vite.config.js). Imported
// before "cesium", which reads it the first time it needs one.
window.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
