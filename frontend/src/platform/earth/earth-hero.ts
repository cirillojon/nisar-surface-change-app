import * as THREE from 'three';
import regionalCrops from './regional-crops.json';
import { vertex, surfaceFragment, compactSurfaceFragment, cloudFragment, atmosphereFragment } from './shaders';

export type EarthHeroState = {
  finish: 'reference' | 'satellite';
  ready: boolean;
  autoRotate: boolean;
  dragging: boolean;
  reducedMotion: boolean;
  contextLost: boolean;
};

type DescentTarget = {
  latitude: number;
  longitude: number;
  region: keyof typeof regionalCrops.regions;
};

export type EarthHeroOptions = {
  textureSet?: 'authored' | 'original';
  finish?: EarthHeroState['finish'];
  assetBase?: string;
  quality?: 'auto' | 'high' | 'low';
  autoRotate?: boolean;
  loadReference?: boolean;
  layout?: (width: number, height: number) => { x: number; y: number; radius: number };
  descentFocus?: number;
  descentTarget?: DescentTarget | null;
  onChange?: (state: EarthHeroState) => void;
};

export type EarthHero = ReturnType<typeof createEarthHero>;

function detailBounds(region: DescentTarget['region']) {
  const { sourceWidth, sourceHeight, regions } = regionalCrops;
  const [left, top, width, height] = regions[region];
  // UV coordinates run north from the bottom of the texture.
  return new THREE.Vector4(left / sourceWidth, 1 - (top + height) / sourceHeight, width / sourceWidth, height / sourceHeight);
}

/** A complete globe with a fixed, cropped hero camera. No DOM work at import time. */
export function createEarthHero(host: HTMLElement, options: EarthHeroOptions = {}) {
  const compact = options.quality === 'low' || (options.quality !== 'high' && host.clientWidth < 700);
  const authored = options.textureSet !== 'original';
  const compactSurface = compact && authored && options.loadReference === false;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !compactSurface, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.className = 'earth-hero__canvas';
  if (compactSurface) canvas.dataset.renderer = 'compact';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-roledescription', 'interactive globe');
  canvas.setAttribute('aria-label', 'Rotate Earth by dragging or using arrow keys. Space pauses rotation. Home resets the opening view.');
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 4;
  const position = new THREE.Group();
  const tilt = new THREE.Group();
  const earth = new THREE.Group();
  position.add(tilt);
  tilt.add(earth);
  scene.add(position);

  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const state: EarthHeroState = {
    finish: options.finish || 'satellite',
    ready: false, autoRotate: options.autoRotate !== false && !media.matches,
    dragging: false, reducedMotion: media.matches,
    contextLost: false,
  };
  let disposed = false;
  let visible = true;
  let suspended = false;
  let descentFocusY = 0;
  let descentAlignment = 0;
  let clippedTop = 0;
  let framedLatitude = 0;
  let descentTarget = options.descentTarget;
  let texturesReady = false;
  let frame = 0;
  let frames = 0;
  let previousTime = 0;
  let longitude = THREE.MathUtils.degToRad(options.descentFocus === undefined ? 170 : 18);
  let pitch = THREE.MathUtils.degToRad(options.descentFocus === undefined ? -29 : 0);
  let cloudSpin = 0;
  let referenceTime = 0;
  let velocity = 0;
  let lastInteraction = performance.now();
  let pointer: { id: number; x: number; y: number; time: number } | null = null;
  const initialLongitude = longitude;
  const initialPitch = pitch;
  const textures: THREE.Texture[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const renderSize = new THREE.Vector2();
  const width = compact ? 2048 : 4096;
  const geometry = new THREE.SphereGeometry(1, compact ? 96 : 160, compact ? 64 : 96);
  const terrainGeometry = authored ? new THREE.SphereGeometry(1, compact ? 192 : 512, compact ? 96 : 256) : geometry;
  const reliefScale = authored ? 0.009 : 0;
  terrainGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1 + reliefScale);
  const sun = new THREE.Vector3(-0.25, 0.93, 0.38).normalize();
  let clouds: THREE.Mesh | null = null;
  let cloudMaterial: THREE.ShaderMaterial | null = null;
  let surface: THREE.ShaderMaterial | null = null;
  const emit = () => options.onChange?.({ ...state });

  function canRender() {
    return texturesReady && !disposed && visible && !suspended && !document.hidden && !state.contextLost;
  }

  function invalidate() {
    if (!frame && canRender()) frame = requestAnimationFrame(render);
  }

  function render(now: number) {
    frame = 0;
    if (!canRender()) { previousTime = 0; return; }
    const dt = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
    previousTime = now;
    const descentActive = camera.zoom > 1 || descentAlignment > 0;
    if (!state.dragging && !descentActive) {
      if (Math.abs(velocity) > 0.0001 && !state.reducedMotion) {
        longitude += velocity * dt;
        velocity *= Math.exp(-5.0 * dt);
      } else velocity = 0;
      if (state.autoRotate && now - lastInteraction > 1800) {
        if (state.finish === 'satellite') {
          longitude += dt * 0.014;
          cloudSpin += dt * 0.0012;
        } else {
          // One photograph cannot support a seamless full revolution. A gentle
          // two-degree oscillation preserves it; Satellite finish rotates 360°.
          const nextTime = referenceTime + dt * 0.12;
          longitude += (Math.sin(nextTime) - Math.sin(referenceTime)) * 0.035;
          referenceTime = nextTime;
        }
      }
    }
    if (state.finish === 'reference') {
      longitude = THREE.MathUtils.clamp(longitude, initialLongitude - 0.1, initialLongitude + 0.1);
      pitch = initialPitch;
      if (Math.abs(longitude - initialLongitude) >= 0.0999) velocity = 0;
    }
    // Keep the opening view near the chosen region. Scroll steers the rendered
    // camera while preserving the user's orbit offset for the return trip.
    const alignment = descentTarget && state.finish === 'satellite' ? descentAlignment : 0;
    const targetYaw = descentTarget ? THREE.MathUtils.degToRad(-90 - descentTarget.longitude) : 0;
    const targetPitch = descentTarget ? THREE.MathUtils.degToRad(descentTarget.latitude) - framedLatitude : pitch;
    const orbit = THREE.MathUtils.euclideanModulo(longitude + Math.PI, Math.PI * 2) - Math.PI;
    earth.rotation.y = targetYaw + longitude - orbit * alignment;
    tilt.rotation.x = THREE.MathUtils.lerp(pitch, targetPitch, alignment);
    if (clouds) clouds.rotation.y = cloudSpin;
    const clarity = THREE.MathUtils.smoothstep(alignment, 0.32, 0.94);
    if (surface) {
      surface.uniforms.uCloudOffset.value = -cloudSpin / (Math.PI * 2);
      surface.uniforms.uLandingClarity.value = clarity;
      surface.uniforms.uLandingDetailStrength.value = landDetail ? clarity : 0;
    }
    if (cloudMaterial) cloudMaterial.uniforms.uLandingClarity.value = clarity;
    renderer.render(scene, camera);
    // Reveal the canvas only after it contains the real, fully textured globe.
    if (!state.ready) {
      state.ready = true;
      host.dataset.ready = 'true';
      emit();
    }
    frames++;
    if (!descentActive && (state.autoRotate || Math.abs(velocity) > 0.0001)) invalidate();
    else previousTime = 0;
  }

  function updateProjection() {
    // Keep the surface just below the horizon fixed as the framing gets closer.
    camera.position.y = descentFocusY * (1 - 1 / camera.zoom);
    camera.updateProjectionMatrix();
  }

  function updateScissor() {
    if (!compactSurface) return;
    renderer.getSize(renderSize);
    // WebGL's scissor starts at the bottom, so cutting the top reduces height.
    renderer.setScissor(0, 0, renderSize.x, Math.max(0, renderSize.y - clippedTop));
    renderer.setScissorTest(clippedTop > 0);
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height || disposed) return;
    // Never reveal more vertical surface than the reference contains. Narrow
    // heroes crop the sides instead of exposing the missing lower hemisphere.
    const layout = options.layout?.(width, height);
    const radiusPx = layout?.radius ?? Math.max(width * 0.568, height * (1775 * 0.568 / 887));
    const halfHeight = height / radiusPx / 2;
    const halfWidth = width / radiusPx / 2;
    camera.left = -halfWidth; camera.right = halfWidth;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    descentFocusY = (height / 2 - height * (options.descentFocus ?? 0.82)) / radiusPx;
    updateProjection();
    // Reference: solid horizon at 36.6% of frame height; planet center below crop.
    position.position.x = ((layout?.x ?? width / 2) - width / 2) / radiusPx;
    position.position.y = (height / 2 - (layout?.y ?? height * 0.366 + radiusPx)) / radiusPx;
    // Aim the study site near mid-screen after zooming around the lower hero focal point.
    const closeUpY = descentFocusY + (height * 0.36) / (radiusPx * 3.8);
    framedLatitude = Math.asin(THREE.MathUtils.clamp(closeUpY - position.position.y, -0.98, 0.98));
    const pixelRatio = Math.min(devicePixelRatio || 1, compact ? 1.25 : 1.5);
    renderer.setDrawingBufferSize(width, height, pixelRatio);
    updateScissor();
    if (surface) surface.uniforms.uFrameHeight.value = canvas.height;
    invalidate();
  }

  function setAutoRotate(value: boolean) {
    state.autoRotate = value;
    velocity = 0;
    lastInteraction = value ? performance.now() - 1801 : performance.now();
    emit(); invalidate();
  }

  function reset() {
    longitude = initialLongitude; pitch = initialPitch; cloudSpin = 0; referenceTime = 0; velocity = 0;
    lastInteraction = performance.now();
    invalidate();
  }

  function setFinish(finish: EarthHeroState['finish']) {
    state.finish = finish;
    reset();
    for (const material of materials) material.uniforms.uReferenceFinish.value = finish === 'reference' ? 1 : 0;
    emit(); invalidate();
  }

  function down(event: PointerEvent) {
    if (pointer || !state.ready || event.button !== 0 || !event.isPrimary) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    canvas.setPointerCapture(event.pointerId);
    state.dragging = true; velocity = 0;
    canvas.dataset.dragging = 'true';
    lastInteraction = performance.now();
    emit();
  }

  function move(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const step = dx / Math.max(host.clientWidth, 1) * Math.PI * 0.9;
    longitude += step;
    if (event.pointerType !== 'touch' && state.finish === 'satellite') {
      pitch = THREE.MathUtils.clamp(pitch + dy / Math.max(host.clientHeight, 1) * 0.8, -0.85, 0.05);
    }
    velocity = THREE.MathUtils.clamp(step / Math.max((now - pointer.time) / 1000, 0.008), -1.2, 1.2);
    pointer = { id: pointer.id, x: event.clientX, y: event.clientY, time: now };
    lastInteraction = now;
    invalidate();
  }

  function up(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (media.matches || event.type !== 'pointerup' || performance.now() - pointer.time > 100) velocity = 0;
    pointer = null; state.dragging = false;
    delete canvas.dataset.dragging;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    lastInteraction = performance.now();
    emit(); invalidate();
  }

  function key(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', ' '].includes(event.key)) return;
    event.preventDefault();
    lastInteraction = performance.now(); velocity = 0;
    if (event.key === 'ArrowLeft') longitude -= 0.12;
    if (event.key === 'ArrowRight') longitude += 0.12;
    if (event.key === 'ArrowUp') pitch = Math.max(-0.85, pitch - 0.06);
    if (event.key === 'ArrowDown') pitch = Math.min(0.05, pitch + 0.06);
    if (event.key === 'Home') reset();
    if (event.key === ' ') setAutoRotate(!state.autoRotate);
    invalidate();
  }

  function visibility() {
    previousTime = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (document.hidden) {
      pointer = null; state.dragging = false; velocity = 0;
      delete canvas.dataset.dragging;
    }
    invalidate();
  }

  function motionPreference() {
    state.reducedMotion = media.matches;
    if (media.matches) { state.autoRotate = false; velocity = 0; }
    emit(); invalidate();
  }

  function lost(event: Event) {
    event.preventDefault(); state.contextLost = true; state.ready = false;
    host.dataset.context = 'lost'; delete host.dataset.ready;
    emit(); visibility();
  }
  function restored() {
    state.contextLost = false;
    delete host.dataset.context;
    updateScissor();
    visibility();
  }
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  media.addEventListener('change', motionPreference);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting; previousTime = 0; invalidate();
  });
  intersection.observe(host);
  resize();

  const base = (options.assetBase || '/earth').replace(/\/$/, '');
  // Generated style fields have 1774px native width. Spend desktop GPU memory
  // on the 8K-derived terrain/cloud detail instead of oversized color fields.
  const artWidth = Math.min(width, 2048);
  const layers = authored ? [
    { key: 'day', file: compactSurface ? 'mobile/surface' : 'world-v2/albedo', resolution: artWidth },
    { key: 'night', file: 'world-v2/lights', resolution: artWidth },
    { key: 'clouds', file: compactSurface ? 'mobile/clouds' : 'world-v2/clouds', resolution: artWidth },
    { key: 'water', file: 'world-v2/water', resolution: width },
    { key: 'normal', file: 'world-v2/normal', resolution: width },
    { key: 'height', file: 'relief/height', resolution: width },
  ] : ['day', 'night', 'clouds', 'water'].map(key => ({ key, file: key, resolution: width }));
  if (authored && !compactSurface) {
    layers.push(
      { key: 'detail', file: 'world-v2/detail', resolution: width },
      { key: 'cloudDetail', file: 'world-v2/cloud-detail', resolution: width },
      { key: 'roughness', file: 'world-v2/roughness', resolution: artWidth },
      { key: 'lightDetail', file: 'world-v2/light-detail', resolution: width },
    );
  }
  if (options.loadReference !== false) layers.push({ key: 'reference', file: 'reference', resolution: 1775 });
  const loader = new THREE.TextureLoader();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  let landDetail: THREE.Texture | undefined;
  let requestedRegion: DescentTarget['region'] | undefined;
  let detailRequest = 0;

  function loadLandDetail() {
    const region = descentTarget?.region;
    if (!authored || !region || requestedRegion === region) return;
    requestedRegion = region;
    const request = ++detailRequest;
    const folder = compactSurface ? 'mobile' : 'world-v2';
    loader.load(`${base}/${folder}/${region}-detail.webp`, texture => {
      if (disposed || request !== detailRequest) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(maxAnisotropy, 8);
      if (compactSurface && !state.contextLost) renderer.initTexture(texture);
      landDetail = texture;
      if (surface) {
        surface.uniforms.uLandingDetail.value = texture;
        surface.uniforms.uLandingBounds.value = detailBounds(region);
      }
      invalidate();
    }, undefined, () => {
      // The globe already has a complete world texture if this optional detail fails.
    });
  }

  function setDescentTarget(target?: DescentTarget | null) {
    if (target === descentTarget) return;
    const previousRegion = descentTarget?.region;
    descentTarget = target;
    if (previousRegion !== target?.region) {
      detailRequest++;
      requestedRegion = undefined;
      if (surface) surface.uniforms.uLandingDetail.value = surface.uniforms.uDetail.value;
      landDetail?.dispose();
      landDetail = undefined;
      if (compactSurface || camera.zoom > 1) loadLandDetail();
    }
    invalidate();
  }

  // Warm the first region with the mobile globe so the descent does not
  // have to upload a new map just as the visitor starts scrolling.
  if (compactSurface) loadLandDetail();
  const ready = (async () => {
    const results = await Promise.allSettled(layers.map(async ({ key, file, resolution }) => {
      const texture = await loader.loadAsync(key === 'reference' ? `${base}/reference.png` : `${base}/${file}-${resolution}.webp`);
      texture.colorSpace = ['day', 'night', 'detail', 'lightDetail', 'reference'].includes(key) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = key === 'reference' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      texture.anisotropy = Math.min(maxAnisotropy, compactSurface ? 4 : 8);
      textures.push(texture);
      return { key, texture };
    }));
    if (disposed) { textures.forEach(t => t.dispose()); return; }
    const error = results.find(r => r.status === 'rejected');
    if (error) { dispose(); throw new Error('Earth textures could not load.', { cause: error.reason }); }
    const maps: Record<string, THREE.Texture> = {};
    for (const result of results) if (result.status === 'fulfilled') maps[result.value.key] = result.value.texture;
    const { day, night, clouds: cloud, water, reference } = maps;
    // Calibrate the projector against the original 1775 x 887 frame, independent
    // of the live viewport. Projected pixels stay attached to the rotating mesh.
    const referenceRadius = 1775 * 0.568;
    const referenceHalfHeight = 887 / referenceRadius / 2;
    const referenceHalfWidth = 1775 / referenceRadius / 2;
    const referenceCamera = new THREE.OrthographicCamera(-referenceHalfWidth, referenceHalfWidth, referenceHalfHeight, -referenceHalfHeight, 0.1, 10);
    const referenceYaw = options.descentTarget ? THREE.MathUtils.degToRad(-90 - options.descentTarget.longitude) : 0;
    const rotation = new THREE.Matrix4().makeRotationX(initialPitch)
      .multiply(new THREE.Matrix4().makeRotationY(initialLongitude + referenceYaw));
    const referenceModel = new THREE.Matrix4().makeTranslation(0, (887 * 0.134 - referenceRadius) / referenceRadius, 0).multiply(rotation);
    const referenceUniforms = () => ({
      uReference: { value: reference || day },
      uReferenceFinish: { value: state.finish === 'reference' ? 1 : 0 },
      uReferenceMatrix: { value: new THREE.Matrix4().multiplyMatrices(referenceCamera.projectionMatrix, referenceModel) },
      uReferenceRotation: { value: new THREE.Matrix3().setFromMatrix4(rotation) },
    });
    surface = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: compactSurface ? compactSurfaceFragment : surfaceFragment,
      transparent: compactSurface,
      defines: { TERRAIN: 1 },
      uniforms: {
        ...referenceUniforms(),
        uDay: { value: day }, uNight: { value: night }, uClouds: { value: cloud }, uWater: { value: water },
        uNormal: { value: maps.normal || day }, uRoughness: { value: maps.roughness || water },
        uDetail: { value: maps.detail || day }, uLightDetail: { value: maps.lightDetail || night },
        uLandingDetail: { value: landDetail || maps.detail || day },
        uLandingBounds: { value: descentTarget ? detailBounds(descentTarget.region) : new THREE.Vector4() },
        uLandingClarity: { value: 0 }, uLandingDetailStrength: { value: 0 },
        uCloudDetail: { value: maps.cloudDetail || cloud }, uFrameHeight: { value: canvas.height },
        uHeight: { value: maps.height || water }, uReliefScale: { value: reliefScale },
        uDetailMipOffset: { value: Math.log2(width / 4096) },
        uArtDirected: { value: authored ? 1 : 0 }, uTexel: { value: new THREE.Vector2(1 / width, 2 / width) },
        uSun: { value: sun }, uCloudOffset: { value: 0 }, uLights: { value: authored ? 1.0 : 1.15 },
      },
    });
    materials.push(surface);
    const globe = new THREE.Mesh(terrainGeometry, surface);
    globe.name = 'Earth surface';
    earth.add(globe);
    if (!compactSurface) {
      cloudMaterial = new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: cloudFragment,
        transparent: true, depthWrite: false,
        uniforms: { ...referenceUniforms(), uClouds: { value: cloud }, uCloudDetail: { value: maps.cloudDetail || cloud },
          uLandingClarity: { value: 0 },
          uArtDirected: { value: authored ? 1 : 0 }, uDetailMipOffset: { value: Math.log2(width / 4096) }, uSun: { value: sun } },
      });
      const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: atmosphereFragment,
        transparent: true, side: THREE.BackSide, depthWrite: false,
        uniforms: { uCenter: { value: position.position }, uReferenceFinish: { value: state.finish === 'reference' ? 1 : 0 },
          uArtDirected: { value: authored ? 1 : 0 } },
      });
      materials.push(cloudMaterial, atmosphereMaterial);
      clouds = new THREE.Mesh(geometry, cloudMaterial);
      clouds.name = 'Independent cloud shell'; clouds.scale.setScalar(authored ? 1.013 : 1.004); clouds.renderOrder = 2;
      const atmosphere = new THREE.Mesh(geometry, atmosphereMaterial);
      atmosphere.name = 'Horizon atmosphere'; atmosphere.scale.setScalar(1.08); atmosphere.renderOrder = 1;
      earth.add(clouds);
      position.add(atmosphere);
    }
    texturesReady = true;
    lastInteraction = performance.now();
    invalidate();
  })();

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame); frame = 0;
    observer.disconnect(); intersection.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    media.removeEventListener('change', motionPreference);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('lostpointercapture', up);
    canvas.removeEventListener('keydown', key);
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometry.dispose();
    landDetail?.dispose();
    if (terrainGeometry !== geometry) terrainGeometry.dispose();
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    delete host.dataset.ready; delete host.dataset.context;
  }

  return {
    ready, dispose, reset, setAutoRotate, setFinish, setDescentTarget,
    setDescentView(zoom: number, alignment: number, scrollFrameTime?: number, clipTop = 0) {
      const clipChanged = clipTop !== clippedTop;
      if (camera.zoom === zoom && descentAlignment === alignment && !clipChanged) return;
      const wasDescending = camera.zoom > 1 || descentAlignment > 0;
      const isDescending = zoom > 1 || alignment > 0;
      if (wasDescending !== isDescending) {
        previousTime = 0;
        velocity = 0;
      }
      camera.zoom = zoom;
      descentAlignment = alignment;
      if (clipChanged) {
        clippedTop = clipTop;
        updateScissor();
      }
      if (isDescending) loadLandDetail();
      updateProjection();
      // Scroll has its own animation callback. Draw its camera and CSS fades
      // on that refresh instead of queueing the canvas for the next one.
      if (compactSurface && scrollFrameTime !== undefined && canRender()) {
        if (frame) cancelAnimationFrame(frame);
        render(scrollFrameTime);
      } else invalidate();
    },
    getState: () => ({ ...state }),
    setSuspended(value: boolean) {
      if (suspended === value) return;
      suspended = value;
      visibility();
    },
    metrics: () => ({ ...state, frames, longitude, pitch, cloudSpin, quality: width, textureSet: authored ? 'authored' : 'original',
      mapResolutions: Object.fromEntries(layers.map(layer => [layer.key, layer.resolution])),
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      terrainVertices: terrainGeometry.attributes.position.count, maximumRelief: state.finish === 'satellite' ? reliefScale : 0,
      pixelRatio: renderer.getPixelRatio(), disposed, visible, suspended }),
  };
}
