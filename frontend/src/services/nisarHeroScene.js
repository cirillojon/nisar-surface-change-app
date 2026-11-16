import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createNisarLoader, disposeNisarModel } from "./nisarModel.js";

/** A fixed camera keeps the satellite, beam, image, and callouts in one space. */
export function createNisarHeroScene(host, { onReady, onError, onImageError, onImageReady }) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-14, 14, 12.4, -12.4, .1, 200);
  const direction = new THREE.Vector3(1, .3, -.75).normalize();
  const target = new THREE.Vector3(3, 2.7, 0);
  camera.position.copy(target).addScaledVector(direction, 60);
  camera.lookAt(target);
  const groundForward = new THREE.Vector3(direction.x, 0, direction.z).normalize();
  const groundRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), groundForward);
  const groundRotation = new THREE.Matrix4().makeBasis(groundRight, groundForward.clone().negate(), new THREE.Vector3(0, 1, 0));

  const studio = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .75;
  studio.dispose();
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff1da, 3.6);
  key.position.set(10, 24, 8);
  const fill = new THREE.DirectionalLight(0xc7d9ff, 1.3);
  fill.position.set(10, 4, -15);
  const rim = new THREE.DirectionalLight(0xbab0ff, 7);
  rim.position.set(2, 18, -18);
  const overhead = new THREE.SpotLight(0xd3c0ff, 2500, 60, .48, .85, 2);
  overhead.position.set(14, 24, -4);
  overhead.target.position.set(6, 10, 0);
  scene.add(key, fill, rim, overhead, overhead.target);

  const satellite = new THREE.Group();
  satellite.scale.setScalar(1.12);
  satellite.position.y = 1.2;
  scene.add(satellite);
  const ground = new THREE.Group();
  ground.position.set(3, -5, 0);
  ground.quaternion.setFromRotationMatrix(groundRotation);
  scene.add(ground);
  const fallbackTexture = new THREE.DataTexture(new Uint8Array([24, 30, 38, 255]), 1, 1);
  fallbackTexture.needsUpdate = true;
  const terrainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      previousMap: { value: fallbackTexture }, currentMap: { value: fallbackTexture },
      blend: { value: 1 }, edgeColor: { value: new THREE.Color(0xa49be0) },
    }, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 imageUv;
      void main() { imageUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D previousMap; uniform sampler2D currentMap;
      uniform float blend; uniform vec3 edgeColor; varying vec2 imageUv;
      void main() {
        vec2 q = abs((imageUv - .5) * vec2(24., 20.)) - vec2(11.4, 9.4);
        float distance = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - .6;
        float alpha = 1. - smoothstep(-.035, .035, distance);
        vec4 image = mix(texture2D(previousMap, imageUv), texture2D(currentMap, imageUv), blend);
        float edge = 1. - smoothstep(.045, .12, abs(distance + .1));
        vec3 radarColor = mix(vec3(.004, .006, .01), image.rgb, image.a);
        gl_FragColor = vec4(mix(radarColor, edgeColor, edge * .75), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const terrainGeometry = new THREE.PlaneGeometry(24, 20);
  // A small shear gives the image the shallow, oblique framing of the hero reference.
  const positions = terrainGeometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    positions.setX(index, positions.getX(index) + positions.getY(index) * .32);
  }
  terrainGeometry.computeBoundingSphere();
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.renderOrder = 1;
  ground.add(terrain);

  const beamVertices = [];
  const beamOpacity = [];
  const footprint = [[-7, -6], [7, -6], [7, 6], [-7, 6]].map(([x, y]) =>
    new THREE.Vector3(3, -4.97, 0).addScaledVector(groundRight, x).addScaledVector(groundForward, y));
  for (let index = 0; index < 4; index++) {
    beamVertices.push(0, .86, 0, ...footprint[index].toArray(), ...footprint[(index + 1) % 4].toArray());
    beamOpacity.push(.035, .13, .13);
  }
  const beamGeometry = new THREE.BufferGeometry();
  beamGeometry.setAttribute("position", new THREE.Float32BufferAttribute(beamVertices, 3));
  beamGeometry.setAttribute("beamAlpha", new THREE.Float32BufferAttribute(beamOpacity, 1));
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: { beamColor: { value: new THREE.Color(0x9380ed) } },
    vertexShader: `attribute float beamAlpha; varying float opacity;
      void main() { opacity = beamAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 beamColor; varying float opacity;
      void main() {
        gl_FragColor = vec4(beamColor, opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.renderOrder = 2;
  scene.add(beam);

  const modelLoader = createNisarLoader(renderer);
  const textureLoader = new THREE.TextureLoader();
  const textures = new Map();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let model = null;
  let disposed = false;
  let inView = true;
  let frame = 0;
  let imageRequest = 0;
  let transitionStart = 0;
  let renderCount = 0;
  let pointerX = 0;
  let pointerY = 0;
  const projected = new THREE.Vector3();
  const dishAnchor = new THREE.Vector3(6.1, 10.2, -6.1);
  const busAnchor = new THREE.Vector3(.2, -.1, -5.5);

  function projectToCss(name, position) {
    projected.copy(position).project(camera);
    host.style.setProperty(`--${name}-x`, `${(projected.x + 1) * 50}%`);
    host.style.setProperty(`--${name}-y`, `${(1 - projected.y) * 50}%`);
  }
  function updateLabels() {
    satellite.updateMatrixWorld();
    projectToCss("dish", satellite.localToWorld(dishAnchor.clone()));
    projectToCss("bus", satellite.localToWorld(busAnchor.clone()));
    projectToCss("image", new THREE.Vector3(3, -4.9, 0).addScaledVector(groundRight, -7.76).addScaledVector(groundForward, -7));
  }
  function requestRender() {
    if (!disposed && !frame && inView && !document.hidden) frame = requestAnimationFrame(render);
  }
  function render(time) {
    frame = 0;
    if (disposed || !inView || document.hidden) return;
    const rotationX = motion.matches ? 0 : pointerY * .025;
    const rotationY = motion.matches ? 0 : pointerX * .055;
    satellite.rotation.x += (rotationX - satellite.rotation.x) * .14;
    satellite.rotation.y += (rotationY - satellite.rotation.y) * .14;
    const moving = Math.abs(rotationX - satellite.rotation.x) + Math.abs(rotationY - satellite.rotation.y) > .0001;
    if (transitionStart) {
      terrainMaterial.uniforms.blend.value = motion.matches ? 1 : Math.min((time - transitionStart) / 280, 1);
      if (terrainMaterial.uniforms.blend.value === 1) {
        terrainMaterial.uniforms.previousMap.value = terrainMaterial.uniforms.currentMap.value;
        transitionStart = 0;
        trimTextures();
      }
    }
    updateLabels();
    renderer.render(scene, camera);
    renderCount++;
    if (transitionStart || moving) requestRender();
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const halfHeight = Math.max(11.9, 13.5 * height / width);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.right = halfHeight * width / height;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  }
  function trimTextures() {
    const active = [terrainMaterial.uniforms.previousMap.value, terrainMaterial.uniforms.currentMap.value];
    for (const [url, entry] of textures) {
      if (textures.size <= 3) break;
      if (entry.texture && !active.includes(entry.texture)) { entry.texture.dispose(); textures.delete(url); }
    }
  }
  function getTexture(url) {
    if (disposed) return Promise.resolve(null);
    const cached = textures.get(url);
    if (cached) { textures.delete(url); textures.set(url, cached); return cached.promise; }
    const entry = {};
    entry.promise = textureLoader.loadAsync(url).then((texture) => {
      if (disposed) { texture.dispose(); return null; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      entry.texture = texture;
      return texture;
    }).catch(() => { textures.delete(url); return null; });
    textures.set(url, entry);
    return entry.promise;
  }
  async function setImage(url) {
    const request = ++imageRequest;
    const texture = await getTexture(url);
    if (disposed || request !== imageRequest) return;
    const uniforms = terrainMaterial.uniforms;
    if (!texture) {
      uniforms.previousMap.value = fallbackTexture;
      uniforms.currentMap.value = fallbackTexture;
      transitionStart = 0;
      onImageError?.();
      requestRender();
      return;
    }
    onImageReady?.();
    if (uniforms.currentMap.value === texture) return;
    uniforms.previousMap.value = uniforms.currentMap.value === fallbackTexture ? texture : uniforms.currentMap.value;
    uniforms.currentMap.value = texture;
    uniforms.blend.value = 0;
    transitionStart = performance.now();
    requestRender();
  }
  function pointerMove(event) {
    if (event.pointerType !== "mouse" || motion.matches) return;
    const bounds = host.getBoundingClientRect();
    pointerX = (event.clientX - bounds.left) / bounds.width - .5;
    pointerY = (event.clientY - bounds.top) / bounds.height - .5;
    requestRender();
  }
  function pointerLeave() { pointerX = 0; pointerY = 0; requestRender(); }
  function themeChanged() {
    const dark = document.documentElement.dataset.theme === "dark";
    scene.environmentIntensity = dark ? .75 : .95;
    beamMaterial.uniforms.beamColor.value.set(dark ? 0x9380ed : 0x7668b8);
    requestRender();
  }
  function contextLost(event) { event.preventDefault(); onError(); dispose(); }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; requestRender(); });
  visibilityObserver.observe(host);
  const themeObserver = new MutationObserver(themeChanged);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  host.addEventListener("pointermove", pointerMove);
  host.addEventListener("pointerleave", pointerLeave);
  document.addEventListener("visibilitychange", requestRender);
  motion.addEventListener("change", requestRender);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  const ready = modelLoader.load().then((gltf) => {
    if (disposed) { disposeNisarModel(gltf.scene); return; }
    model = gltf.scene;
    // Put the leaders just outside the actual silhouette, including the solar wings.
    model.updateMatrixWorld(true);
    let dishEdge = -Infinity;
    let busEdge = -Infinity;
    const point = new THREE.Vector3();
    model.traverse((object) => {
      if (!object.isMesh) return;
      const position = object.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index++) {
        point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        const edge = point.dot(groundRight);
        if (point.y > 8 && edge > dishEdge) { dishEdge = edge; dishAnchor.copy(point); }
        if (point.y < 2 && edge > busEdge) { busEdge = edge; busAnchor.copy(point); }
      }
    });
    dishAnchor.y = 10.2;
    busAnchor.y = .1;
    dishAnchor.addScaledVector(groundRight, .45);
    busAnchor.addScaledVector(groundRight, .45);
    satellite.add(model);
    requestRender();
    onReady();
  }).catch(() => { if (!disposed) { onError(); dispose(); } });

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect(); visibilityObserver.disconnect(); themeObserver.disconnect();
    host.removeEventListener("pointermove", pointerMove); host.removeEventListener("pointerleave", pointerLeave);
    document.removeEventListener("visibilitychange", requestRender); motion.removeEventListener("change", requestRender);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    if (model) disposeNisarModel(model);
    for (const entry of textures.values()) entry.texture?.dispose();
    textures.clear();
    fallbackTexture.dispose(); terrainGeometry.dispose(); terrainMaterial.dispose();
    beamGeometry.dispose(); beamMaterial.dispose(); environment.dispose(); renderer.dispose();
    renderer.domElement.remove();
    ready.finally(() => modelLoader.dispose());
    if (import.meta.env.DEV) delete host.__nisarHero;
  }
  if (import.meta.env.DEV) {
    host.__nisarHero = {
      metrics: () => ({ renderCount, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: textures.size }),
      poster: () => {
        ground.visible = false; beam.visible = false;
        renderer.render(scene, camera);
        const image = renderer.domElement.toDataURL("image/png");
        ground.visible = true; beam.visible = true; requestRender();
        return image;
      },
    };
  }
  themeChanged(); resize();
  return { setImage, preloadImage: (url) => getTexture(url).then(trimTextures), dispose };
}
