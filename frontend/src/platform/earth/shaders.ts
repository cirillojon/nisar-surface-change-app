export const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vTangent;
uniform mat4 uReferenceMatrix;
uniform mat3 uReferenceRotation;
varying vec3 vReference;
#ifdef TERRAIN
uniform sampler2D uHeight;
uniform float uReliefScale;
uniform float uReferenceFinish;
#endif
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec3 tangent = normalize(vec3(normal.z, 0.0, -normal.x) + vec3(0.00001, 0.0, 0.0));
  vTangent = normalize(mat3(modelMatrix) * tangent);
  vec3 surfacePosition = position;
  #ifdef TERRAIN
    // Elevation changes the mesh itself; cloud and atmosphere shells stay smooth.
    surfacePosition += normal * texture2D(uHeight, uv).r * uReliefScale * (1.0 - uReferenceFinish);
  #endif
  vWorld = (modelMatrix * vec4(surfacePosition, 1.0)).xyz;
  vReference = vec3((uReferenceMatrix * vec4(position, 1.0)).xy * 0.5 + 0.5, (uReferenceRotation * normal).z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const referenceProjection = /* glsl */ `
uniform sampler2D uReference;
uniform float uReferenceFinish;
varying vec3 vReference;
float referenceWeight(vec4 sampleColor) {
  vec2 uv = vReference.xy;
  // Let the lower edge extend beyond the crop; fading at y=0 creates a visible
  // strip across the initial hero. Reference mode's orbit is deliberately limited.
  vec2 fade = smoothstep(vec2(-0.03, -0.10), vec2(0.0, -0.06), uv) * (1.0 - smoothstep(vec2(1.0), vec2(1.03), uv));
  return fade.x * fade.y * smoothstep(0.0, 0.12, vReference.z) * sampleColor.a * uReferenceFinish;
}
`;

// Color textures are decoded by the GPU to linear light; masks are linear data.
// These are deliberately art-directed materials, not an orbital science model.
export const surfaceFragment = /* glsl */ `
${referenceProjection}
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uWater;
uniform sampler2D uNormal;
uniform sampler2D uRoughness;
uniform sampler2D uDetail;
uniform sampler2D uLandingDetail;
uniform vec4 uLandingBounds;
uniform float uLandingClarity;
uniform float uLandingDetailStrength;
uniform sampler2D uLightDetail;
uniform sampler2D uHeight;
uniform float uReliefScale;
uniform float uDetailMipOffset;
uniform float uArtDirected;
uniform vec2 uTexel;
uniform vec3 uSun;
uniform float uCloudOffset;
uniform float uLights;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vTangent;
void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float water = texture2D(uWater, vUv).r;
  vec3 surfaceNormal = n;
  float roughness = mix(0.90, 0.125, water);
  float terrainShade = 1.0;
  if (uArtDirected > 0.5) {
    vec3 t = normalize(vTangent - n * dot(n, vTangent));
    vec3 b = normalize(cross(n, t));
    vec3 normalSample = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    // Derive slopes from elevation with spherical texel spacing. Latitude
    // correction keeps the same physical relief at different longitudes/latitudes.
    float hEast = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r;
    float hWest = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
    float hNorth = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r;
    float hSouth = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
    float latitudeScale = max(sin(vUv.y * 3.14159265), 0.15);
    vec2 gradient = vec2((hEast - hWest) / (2.0 * uTexel.x * 6.2831853 * latitudeScale),
      (hNorth - hSouth) / (2.0 * uTexel.y * 3.14159265));
    normalSample.xy = (normalSample.xy * 1.25 - gradient * uReliefScale * 1.7) * (1.0 - water);
    surfaceNormal = normalize(mat3(t, b, n) * normalSample);
    roughness = texture2D(uRoughness, vUv).r;
    // A raking key reveals ridges without changing the broad day-side palette.
    vec3 reliefLight = normalize(vec3(-0.72, 0.38, 0.58));
    float smoothLight = 0.24 + max(dot(n, reliefLight), 0.0) * 0.9;
    float reliefLightValue = 0.24 + max(dot(surfaceNormal, reliefLight), 0.0) * 0.9;
    terrainShade = clamp(reliefLightValue / smoothLight, 0.32, 1.48);
    float height = texture2D(uHeight, vUv).r;
    float surroundingHeight = textureLod(uHeight, vUv, 2.0 + uDetailMipOffset).r;
    terrainShade *= 1.0 - clamp((surroundingHeight - height) * 1.8, 0.0, 0.24);
    terrainShade = mix(terrainShade, 1.0, water);
  }
  float sun = max(dot(n, uSun), 0.0);
  vec3 land = texture2D(uDay, vUv).rgb;
  vec3 ocean = land * vec3(0.12, 0.30, 0.45) + vec3(0.0, 0.0015, 0.003);
  vec3 albedo = mix(pow(land, vec3(1.16)) * vec3(0.95, 1.10, 0.92), ocean, water);
  // The authored albedo already contains the reference palette. Applying the
  // source-map grade again would crush its navy water and forest detail.
  if (uArtDirected > 0.5) {
    // Transfer the authored broad color field onto native satellite detail.
    // This preserves crisp terrain/coastlines without baking low-res painted
    // mountain shapes into the close hero view.
    vec3 fine = texture2D(uDetail, vUv).rgb;
    if (uLandingDetailStrength > 0.0) {
      vec2 uv = (vUv - uLandingBounds.xy) / uLandingBounds.zw;
      // Feather the regional image into the world atlas, including at the pole.
      vec2 edge = min(uv, 1.0 - uv);
      float blend = smoothstep(0.0, 0.10, min(edge.x, edge.y)) * uLandingDetailStrength;
      fine = mix(fine, texture2D(uLandingDetail, uv, -0.55).rgb, blend);
    }
    vec3 broad = textureLod(uDetail, vUv, 5.5 + uDetailMipOffset).rgb;
    vec3 authoredBroad = textureLod(uDay, vUv, 4.0).rgb;
    vec3 correction = clamp((authoredBroad + 0.008) / (broad + 0.008), vec3(0.28), vec3(2.8));
    vec3 coloredTerrain = fine * correction;
    float snow = smoothstep(0.45, 0.70, min(fine.r, min(fine.g, fine.b)));
    coloredTerrain = mix(coloredTerrain, fine * vec3(0.96, 0.99, 1.04), snow);
    albedo = mix(coloredTerrain, land, water);
  }
  float cloud = texture2D(uClouds, vUv + vec2(uCloudOffset - 0.0018, 0.0012)).r;
  float cloudShadow = 1.0 - smoothstep(0.1, 0.8, cloud) * mix(0.25, 0.06, uLandingClarity);
  vec3 color = albedo * (0.24 + sun * mix(1.04, 0.92, uArtDirected)) * cloudShadow * terrainShade;
  float glint = pow(max(dot(reflect(-uSun, surfaceNormal), viewDir), 0.0), mix(110.0, 12.0, roughness));
  color += vec3(0.62, 0.78, 0.88) * glint * pow(1.0 - roughness, 3.0) * water * 0.12;

  // Warm lights remain faintly visible in daylight to echo the supplied artwork.
  vec3 night = texture2D(uNight, vUv).rgb;
  float luminance = dot(night, vec3(0.2126, 0.7152, 0.0722));
  float lights = smoothstep(0.014, 0.35, luminance);
  vec3 emission = vec3(1.0, 0.53, 0.12) * lights;
  if (uArtDirected > 0.5) {
    vec3 nativeLights = max(texture2D(uLightDetail, vUv).rgb - vec3(0.012), vec3(0.0));
    float city = dot(nativeLights, vec3(0.2126, 0.7152, 0.0722));
    float nearbyWater = max(max(texture2D(uWater, vUv + vec2(uTexel.x, 0.0)).r, texture2D(uWater, vUv - vec2(uTexel.x, 0.0)).r),
      max(texture2D(uWater, vUv + vec2(0.0, uTexel.y)).r, texture2D(uWater, vUv - vec2(0.0, uTexel.y)).r));
    float coast = (1.0 - water) * nearbyWater;
    float inhabited = smoothstep(0.001, 0.04, dot(textureLod(uNight, vUv, 3.0).rgb, vec3(0.2126, 0.7152, 0.0722)));
    emission = vec3(1.0, 0.57, 0.16) * (city * 2.1 + coast * inhabited * 0.17) + night * 0.075;
  }
  // Keep the wide shot's lights, then let the coastline and terrain lead the close-up.
  color += emission * uLights * (0.5 + 0.5 * (1.0 - sun)) * cloudShadow * mix(1.0, 0.15, uLandingClarity);

  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.8);
  vec3 air = mix(vec3(0.025, 0.19, 0.46), vec3(0.10, 0.69, 1.0), pow(rim, 2.0));
  color = mix(color, air, rim * mix(0.88, 0.38, uArtDirected));
  // The lower, near-facing surface falls gently into shadow, as in the reference.
  float grade = mix(0.43, 1.03, smoothstep(0.25, 0.95, n.y));
  color *= grade;
  color *= mix(1.0, 0.30, uReferenceFinish);
  vec4 reference = texture2D(uReference, vReference.xy);
  reference.rgb *= exp(min(vReference.y, 0.0) * 35.0);
  color = mix(color, reference.rgb, referenceWeight(reference));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const cloudFragment = /* glsl */ `
${referenceProjection}
uniform sampler2D uClouds;
uniform sampler2D uCloudDetail;
uniform float uLandingClarity;
uniform vec3 uSun;
uniform float uArtDirected;
uniform float uDetailMipOffset;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  float density = texture2D(uClouds, vUv).r;
  if (uArtDirected > 0.5) {
    float fine = texture2D(uCloudDetail, vUv).r;
    float broad = textureLod(uCloudDetail, vUv, 4.5 + uDetailMipOffset).r;
    float authoredBroad = textureLod(uClouds, vUv, 3.0).r;
    density = pow(clamp(fine * clamp((authoredBroad + 0.08) / (broad + 0.08), 0.35, 1.65), 0.0, 1.0), 0.82);
  }
  float alpha = smoothstep(mix(0.12, 0.10, uArtDirected), mix(0.88, 0.78, uArtDirected), density) * 0.94;
  // Fade the lifted cloud shell at grazing angles so it does not form a second
  // bright outline above the mountains after the atmospheric halo is reduced.
  alpha *= mix(1.0, smoothstep(0.08, 0.26, normalize(vNormal).z), uArtDirected);
  alpha *= 1.0 - referenceWeight(texture2D(uReference, vReference.xy));
  alpha *= mix(1.0, 0.18, uLandingClarity);
  if (alpha < 0.008) discard;
  vec3 n = normalize(vNormal);
  float sun = max(dot(n, uSun), 0.0);
  float rim = pow(1.0 - max(n.z, 0.0), 3.0);
  vec3 color = vec3(0.83, 0.91, 1.0) * (0.32 + sun * 0.86);
  color = mix(color, vec3(0.12, 0.51, 0.84), rim * 0.75);
  color *= mix(0.37, 1.0, smoothstep(0.22, 0.95, n.y));
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const atmosphereFragment = /* glsl */ `
uniform vec3 uCenter;
uniform float uReferenceFinish;
uniform float uArtDirected;
varying vec3 vWorld;
void main() {
  // Orthographic rays run parallel to Z. This is the ray's closest distance
  // to the planet center, so glow follows the real silhouette after rotation.
  float altitude = max(length(vWorld.xy - uCenter.xy) - 1.0, 0.0);
  // Keep the authored atmosphere close to the limb with a quieter outer halo.
  float edge = altitude / mix(mix(0.05, 0.022, uArtDirected), 0.08, uReferenceFinish);
  float density = exp(-edge * 3.0) * (1.0 - smoothstep(0.72, 1.0, edge));
  vec3 color = mix(vec3(0.12, 0.75, 1.0), vec3(0.17, 0.44, 0.86), smoothstep(0.0, 0.7, edge));
  float opacity = mix(mix(0.88, 0.24, uArtDirected), 0.88, uReferenceFinish);
  gl_FragColor = vec4(color, density * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
