import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createNisarLoader, disposeNisarModel } from "./nisarModel.js";

const MODEL_SCALE = 1.12;
const MAX_TILT = 22;
const IMAGE_WIDTH = 24;
const IMAGE_DEPTH = 20;
const IMAGE_SHEAR = .32;

/** A fixed camera keeps the satellite, beam, image, and callouts in one space. */
export function createNisarHeroScene(host, dragArea, { onReady, onError, onImageError, onImageReady }) {
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
  const up = new THREE.Vector3(0, 1, 0);
  const cameraUp = up.clone().applyQuaternion(camera.quaternion);
  const groundForward = new THREE.Vector3(direction.x, 0, direction.z).normalize();
  const groundRight = new THREE.Vector3().crossVectors(up, groundForward);
  const groundRotation = new THREE.Matrix4().makeBasis(groundRight, groundForward.clone().negate(), up);

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
  satellite.scale.setScalar(MODEL_SCALE);
  satellite.position.y = 1.2;
  scene.add(satellite);
  const ground = new THREE.Group();
  ground.position.set(3, -5, 0);
  ground.quaternion.setFromRotationMatrix(groundRotation);
  scene.add(ground);
  // Align the controls and badges to the two rounded left corners of the image.
  const imageTop = IMAGE_DEPTH / 2;
  const imageLeft = -IMAGE_WIDTH / 2 + .6;
  const imageTopLeft = ground.localToWorld(new THREE.Vector3(imageLeft + imageTop * IMAGE_SHEAR, imageTop, 0));
  const imageBottomLeft = ground.localToWorld(new THREE.Vector3(imageLeft - imageTop * IMAGE_SHEAR, -imageTop, 0));
  const beamColor = new THREE.Color(0xa794ff);
  const aperture = new THREE.Vector3(0, -.35, 0);
  const beamSource = new THREE.Vector3();
  const beamLanding = ground.position.clone().addScaledVector(up, .03);
  const fallbackTexture = new THREE.DataTexture(new Uint8Array([24, 30, 38, 255]), 1, 1);
  fallbackTexture.needsUpdate = true;
  const terrainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      previousMap: { value: fallbackTexture }, currentMap: { value: fallbackTexture },
      blend: { value: 1 }, edgeColor: { value: new THREE.Color(0xa49be0) },
      beamColor: { value: beamColor },
    }, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 imageUv;
      void main() { imageUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D previousMap; uniform sampler2D currentMap;
      uniform float blend; uniform vec3 edgeColor; uniform vec3 beamColor; varying vec2 imageUv;
      void main() {
        vec2 q = abs((imageUv - .5) * vec2(24., 20.)) - vec2(11.4, 9.4);
        float distance = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - .6;
        float alpha = 1. - smoothstep(-.035, .035, distance);
        vec4 image = mix(texture2D(previousMap, imageUv), texture2D(currentMap, imageUv), blend);
        float edge = 1. - smoothstep(.045, .12, abs(distance + .1));
        vec3 radarColor = mix(vec3(.004, .006, .01), image.rgb, image.a);
        float footprint = 1. - smoothstep(.08, 1., length((imageUv - .5) / vec2(.25, .29)));
        radarColor += beamColor * .14 * footprint * image.a;
        gl_FragColor = vec4(mix(radarColor, edgeColor, edge * .75), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const terrainGeometry = new THREE.PlaneGeometry(IMAGE_WIDTH, IMAGE_DEPTH);
  // A small shear gives the image the shallow, oblique framing of the hero reference.
  const positions = terrainGeometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    positions.setX(index, positions.getX(index) + positions.getY(index) * IMAGE_SHEAR);
  }
  terrainGeometry.computeBoundingSphere();
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.renderOrder = 1;
  ground.add(terrain);

  // One sheet across the beam's width gives the fixed camera a continuous gradient.
  const beamGeometry = new THREE.PlaneGeometry();
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: {
      source: { value: beamSource },
      landing: { value: beamLanding },
      acrossBeam: { value: groundRight },
      beamColor: { value: beamColor },
    },
    vertexShader: `uniform vec3 source; uniform vec3 landing; uniform vec3 acrossBeam;
      varying vec3 beamPosition;
      void main() {
        float width = mix(.13, 6.6, uv.y);
        float offset = (uv.x * 2. - 1.) * width;
        beamPosition = vec3(offset, width, uv.y);
        vec3 point = mix(source, landing, uv.y) + acrossBeam * offset;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.);
      }`,
    fragmentShader: `uniform vec3 beamColor; varying vec3 beamPosition;
      void main() {
        float across = beamPosition.x / beamPosition.y;
        float along = beamPosition.z;
        float edge = 1. - smoothstep(.22, 1., abs(across));
        float core = exp(-across * across * 9.);
        float falloff = smoothstep(0., .17, along) * (1. - smoothstep(.70, 1., along));
        gl_FragColor = vec4(beamColor, edge * (.16 + .10 * core) * falloff);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.frustumCulled = false;
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
  let yaw = 0;
  let tilt = 0;
  let poseChanged = true;
  let drag = null;
  const projected = new THREE.Vector3();
  const labelPoint = new THREE.Vector3();
  const dishAnchor = new THREE.Vector3(6.1, 10.2, -6.1);
  const busAnchor = new THREE.Vector3(.2, -.1, -5.5);
  const tiltRotation = new THREE.Quaternion();
  const inverseRotation = new THREE.Quaternion();
  const localCameraUp = new THREE.Vector3();
  const pivotHeight = cameraUp.dot(satellite.position);
  const pivotViewY = pivotHeight - cameraUp.dot(camera.position);
  const roomBelow = pivotHeight - cameraUp.dot(imageTopLeft) - .4;
  let modelVertices = new Float32Array();

  function projectToCss(name, position) {
    projected.copy(position).project(camera);
    host.style.setProperty(`--${name}-x`, `${(projected.x + 1) * 50}%`);
    host.style.setProperty(`--${name}-y`, `${(1 - projected.y) * 50}%`);
  }
  function updatePose() {
    poseChanged = false;
    satellite.quaternion.setFromAxisAngle(up, THREE.MathUtils.degToRad(yaw))
      .premultiply(tiltRotation.setFromAxisAngle(groundRight, THREE.MathUtils.degToRad(tilt)));

    // Keep the reflector and wings in the space above the image at every angle.
    localCameraUp.copy(cameraUp).applyQuaternion(inverseRotation.copy(satellite.quaternion).invert());
    let top = 0;
    let bottom = 0;
    for (let index = 0; index < modelVertices.length; index += 3) {
      const height = modelVertices[index] * localCameraUp.x
        + modelVertices[index + 1] * localCameraUp.y
        + modelVertices[index + 2] * localCameraUp.z;
      top = Math.max(top, height);
      bottom = Math.max(bottom, -height);
    }
    const roomAbove = camera.top - pivotViewY - .18;
    satellite.scale.setScalar(Math.min(MODEL_SCALE, roomAbove / top, roomBelow / bottom));

    satellite.localToWorld(beamSource.copy(aperture));
    const rotated = Math.abs(yaw) > .05 || Math.abs(tilt) > .05;
    host.toggleAttribute("data-rotated", rotated);
    if (!rotated) {
      projectToCss("dish", satellite.localToWorld(labelPoint.copy(dishAnchor)));
      projectToCss("bus", satellite.localToWorld(labelPoint.copy(busAnchor)));
    }
  }
  function requestRender() {
    if (!disposed && !frame && inView && !document.hidden) frame = requestAnimationFrame(render);
  }
  function render(time) {
    frame = 0;
    if (disposed || !inView || document.hidden) return;
    if (poseChanged) updatePose();
    if (transitionStart) {
      terrainMaterial.uniforms.blend.value = motion.matches ? 1 : Math.min((time - transitionStart) / 280, 1);
      if (terrainMaterial.uniforms.blend.value === 1) {
        terrainMaterial.uniforms.previousMap.value = terrainMaterial.uniforms.currentMap.value;
        transitionStart = 0;
        trimTextures();
      }
    }
    renderer.render(scene, camera);
    renderCount++;
    if (transitionStart) requestRender();
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
    projectToCss("image-top", imageTopLeft);
    projectToCss("image-bottom", imageBottomLeft);
    poseChanged = true;
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
  function rotateView(turn, tip) {
    yaw = THREE.MathUtils.euclideanModulo(yaw + turn + 180, 360) - 180;
    tilt = THREE.MathUtils.clamp(tilt + tip, -MAX_TILT, MAX_TILT);
    poseChanged = true;
    requestRender();
  }
  function resetView() {
    yaw = 0;
    tilt = 0;
    poseChanged = true;
    requestRender();
  }
  function startDrag(event) {
    if (drag || !event.isPrimary || event.button !== 0) return;
    dragArea.setPointerCapture(event.pointerId);
    dragArea.setAttribute("data-dragging", "");
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: host.clientWidth, height: host.clientHeight };
  }
  function moveDrag(event) {
    if (drag?.id !== event.pointerId) return;
    const turn = 420 * (event.clientX - drag.x) / drag.width;
    const tip = event.pointerType === "touch" ? 0 : 150 * (event.clientY - drag.y) / drag.height;
    drag.x = event.clientX;
    drag.y = event.clientY;
    rotateView(turn, tip);
  }
  function endDrag(event) {
    if (event && event.pointerId !== drag?.id) return;
    drag = null;
    dragArea.removeAttribute("data-dragging");
  }
  function contextLost(event) { event.preventDefault(); onError(); dispose(); }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; requestRender(); });
  visibilityObserver.observe(host);
  dragArea.addEventListener("pointerdown", startDrag);
  dragArea.addEventListener("pointermove", moveDrag);
  dragArea.addEventListener("lostpointercapture", endDrag);
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
    const vertices = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      const position = object.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index++) {
        point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        vertices.push(point.x, point.y, point.z);
        const edge = point.dot(groundRight);
        if (point.y > 8 && edge > dishEdge) { dishEdge = edge; dishAnchor.copy(point); }
        if (point.y < 2 && edge > busEdge) { busEdge = edge; busAnchor.copy(point); }
      }
    });
    dishAnchor.y = 10.2;
    busAnchor.y = .1;
    dishAnchor.addScaledVector(groundRight, .45);
    busAnchor.addScaledVector(groundRight, .45);
    modelVertices = new Float32Array(vertices);
    satellite.add(model);
    poseChanged = true;
    requestRender();
    onReady();
  }).catch(() => { if (!disposed) { onError(); dispose(); } });

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect(); visibilityObserver.disconnect();
    dragArea.removeEventListener("pointerdown", startDrag);
    dragArea.removeEventListener("pointermove", moveDrag);
    dragArea.removeEventListener("lostpointercapture", endDrag);
    if (drag && dragArea.hasPointerCapture(drag.id)) dragArea.releasePointerCapture(drag.id);
    endDrag();
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
  resize();
  return { setImage, preloadImage: (url) => getTexture(url).then(trimTextures), rotateView, resetView, dispose };
}
