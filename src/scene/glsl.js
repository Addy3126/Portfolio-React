// Shared GLSL helpers.
export const noiseGLSL = /* glsl */ `
float spow(float x, float e){ return pow(max(x, 0.0), e); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
`

// Exponential-squared fog that warms toward the sun, matching the sky's horizon.
export const fogGLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogGlow;
uniform float uFogDensity;
uniform vec3 uSunDir;
vec3 applyFog(vec3 col, float dist, vec3 V){
  float fd = dist * uFogDensity;
  float f = 1.0 - exp(-fd * fd);
  float sd = max(dot(V, uSunDir), 0.0);
  vec3 fc = mix(uFogColor, uFogGlow, pow(max(sd, 0.0), 8.0) * 0.7);
  return mix(col, fc, f);
}
`

// Analytic shoreline (matches shoreZ in world.js) and the beach/seabed height there.
export const shoreGLSL = /* glsl */ `
float shoreZ(float x){ return -8.0 + sin(x * 0.15) * 1.2 + sin(x * 0.37 + 1.3) * 0.5; }
float bankX(float z){ return -22.0 - 1.5 * sin(z * 0.13) - 0.8 * sin(z * 0.41 + 2.0); }
float rightX(float z){ return 58.0 + 3.0 * sin(z * 0.17) + 1.5 * sin(z * 0.5 + 1.0); }
float mainDist(vec2 xz){ return min(min(xz.y - shoreZ(xz.x), xz.x - bankX(xz.y)), rightX(xz.y) - xz.x); }
// Spit (keep in sync with world.js).
vec2 spitPoint(float t){ return vec2(16.0 + 6.0 * sin(t * 3.0) + 22.0 * t * t, -5.0 - 48.0 * t); }
float spitHalfWidth(float t){ return 2.2 + 8.5 * pow(1.0 - t, 0.8) + 0.9 * sin(t * 13.0); }
float spitDist(vec2 xz){
  // Skip only where it provably can't matter. The spit (centre line plus max half-width)
  // fits in x 10..45, z -53..-5 expanded by 11 m. More than 40 m from that box the spit is
  // over 29 m away, so the smooth union returns the field's value unchanged, or both are
  // deep water where every shore effect has already saturated. (A tighter box made shore
  // colours and foam jump along straight lines at its edges.)
  vec2 dq = max(abs(xz - vec2(22.5, -29.0)) - vec2(23.5, 35.0), 0.0);
  if (length(dq) > 40.0) return -1e3;
  float best = -1e9;
  vec2 prev = spitPoint(0.0);
  for (int i = 1; i <= 24; i++) {
    float t1 = float(i) / 24.0;
    vec2 cur = spitPoint(t1);
    vec2 e = cur - prev;
    float h = clamp(dot(xz - prev, e) / dot(e, e), 0.0, 1.0);
    float d = length(xz - prev - e * h);
    best = max(best, spitHalfWidth((float(i - 1) + h) / 24.0) - d);
    prev = cur;
  }
  return best;
}
// Metres from the nearest waterline (negative = under water).
float smaxk(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
float landDist(vec2 xz){ return smaxk(mainDist(xz), spitDist(xz), 9.0); }
// Ground height past the waterline (slopes into the sea), 0 inland.
float seabedY(vec2 xz){ float below = -landDist(xz); return below > 0.0 ? -min(0.45, below * 0.22) : 0.0; }
`

// Soft piano shadow (PCF) and a contact darkening under the case.
export const shadowGLSL = /* glsl */ `
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
float pianoShadow(vec3 wp){
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float lit = 0.0;
  float r = 1.0 / 512.0;
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      float d = textureLod(uShadowMap, c.xy + vec2(float(i), float(j)) * r, 0.0).r;
      lit += (c.z - 0.003 > d) ? 0.0 : 1.0;
    }
  }
  return lit / 25.0;
}
// Baked shadows of the beach stones and rocks (scene/BeachShadow.jsx); 1 = lit.
uniform sampler2D uBeachMap;
uniform mat4 uBeachMatrix;
float beachShadow(vec3 wp){
  vec4 sc = uBeachMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float lit = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float d = textureLod(uBeachMap, c.xy + vec2(float(i), float(j)) / 2048.0, 0.0).r;
      lit += (c.z - 0.0008 > d) ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}
float pianoContact(vec2 xz){
  float e = length((xz - vec2(-1.45, 3.7)) / vec2(1.45, 0.85));
  float bench = length((xz - vec2(-3.33, 3.7)) / vec2(0.32, 0.55));
  return (1.0 - 0.45 * (1.0 - smoothstep(0.55, 1.35, e))) * (1.0 - 0.3 * (1.0 - smoothstep(0.6, 1.4, bench)));
}
`

// 3D value noise for surface detail that doesn't stretch on steep faces.
export const noise3GLSL = /* glsl */ `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y),
    u.z);
}
float fbm3g(vec3 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * vnoise3(p); p = p * 2.03 + vec3(11.3, 7.1, 3.7); a *= 0.5; }
  return v;
}
`

// Shore swash and foam, shared by the sea and the sand so they meet seamlessly.
// Needs noiseGLSL (vnoise), shoreGLSL (landDist) and fogGLSL (uSunDir, uFogGlow) first.
// Model (after field observations of the swash zone): each stretch of beach gets a wave
// every ~8 s, out of phase with its neighbours; the water runs up quickly (~40% of the
// cycle) and drains back more slowly; it reaches further at cusp "horns", giving a
// scalloped edge. A bright foam line leads the water, a lace of foam cells trails
// behind it, the sand under the film shows through darkened, and the sand stays wet and
// glossy up to the highest recent reach.
export const swashGLSL = /* glsl */ `
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// Voronoi: x = F1 (distance to nearest cell centre), y = F2 - F1 (small along borders).
vec2 voronoi2(vec2 p, float t){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * hash22(i + g)); // cells slowly breathe
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(d1, d2 - d1);
}
// L = landDist (metres, + on land). Returns
//   x: water cover over the sand, y: foam, z: sand wetness, w: rim shadow beside the foam line.
vec4 swash(vec2 xz, float L, float t){
  if (L > 4.5) return vec4(0.0);
  if (L < -10.0) return vec4(1.0, 0.0, 0.0, 0.0);
  float seed = vnoise(xz * 0.05 + 3.1);
  float ph = fract(t / 8.0 + seed * 2.3);
  const float UP = 0.4;
  float s = ph < UP ? 1.0 - pow(1.0 - ph / UP, 2.2) : pow(1.0 - (ph - UP) / (1.0 - UP), 1.5);
  float cusp = 0.7 + 0.55 * vnoise(xz * 0.21 + seed * 9.0);
  float reach = 2.3 * cusp;
  float R = 0.1 + reach * s;
  float wig = (vnoise(xz * 1.3 + vec2(t * 0.04, 0.0)) - 0.5) * 0.35 + (vnoise(xz * 3.7) - 0.5) * 0.12;
  float e = L - R + wig; // < 0 under the water
  float cover = 1.0 - smoothstep(-0.04, 0.02, e);
  float advancing = 1.0 - smoothstep(UP - 0.08, UP + 0.02, ph);

  // Leading foam line: thick and bright while running up, thinning as it drains.
  float lineW = 0.09 + 0.22 * advancing;
  float line = smoothstep(-lineW, -lineW * 0.25, e) * (1.0 - smoothstep(-0.02, 0.015, e));
  line *= 0.75 + 0.25 * vnoise(xz * 9.0); // uneven thickness, like the reference

  // Foam behind the front: dense and spongy right behind it (white with small bubble
  // holes), thinning seaward into a lace of strands, then breaking up into streaks.
  // Strand width follows foam density, so one Voronoi pattern covers the whole range.
  float behind = max(-e, 0.0);
  float patchy = vnoise(xz * 0.9 + vec2(t * 0.05, -t * 0.03)) * 0.6 + vnoise(xz * 2.4 - t * 0.04) * 0.4;
  float dens = exp(-behind * 1.15) * (0.45 + 0.55 * s) * smoothstep(0.15, 0.6, patchy + 0.25 * exp(-behind * 1.5));
  // Surf lace drifting through the shallows, only in water and only in places.
  float surf = (1.0 - smoothstep(-6.0, -0.5, L)) * smoothstep(-12.0, -6.0, L) *
               smoothstep(0.62, 0.85, vnoise(vec2(L * 0.7 - t * 0.3, (xz.x + xz.y) * 0.07))) * 0.45;
  dens = max(dens * cover, surf);
  // Warp the lookup so cells are organic and strands wavy, not polygons.
  vec2 p = xz * 2.2 + vec2(t * 0.02, t * 0.035);
  p += (vec2(vnoise(xz * 1.1 + 3.0), vnoise(xz * 1.1 - 5.0)) - 0.5) * 1.6;
  p += (vec2(vnoise(xz * 4.3 + t * 0.1), vnoise(xz * 4.3 + 9.0)) - 0.5) * 0.45;
  vec2 vA = voronoi2(p, t * 0.2);
  vec2 vB = voronoi2(p * 2.4 + 4.0, t * 0.25);
  float width = mix(0.02, 0.45, dens);
  float strands = max(1.0 - smoothstep(width * 0.55, width, vA.y), (1.0 - smoothstep(width * 0.45, width * 0.9, vB.y)) * 0.85);
  // Small round bubble holes pitting the dense foam.
  vec2 vC = voronoi2(xz * 14.0 + p * 0.5, t * 0.6);
  float holes = (1.0 - smoothstep(0.12, 0.26, vC.x)) * smoothstep(0.35, 0.85, dens) * smoothstep(0.35, 0.65, vnoise(xz * 5.0 + 1.0));
  float lace = strands * smoothstep(0.02, 0.2, dens) * (1.0 - holes * 0.9);
  float foam = clamp(max(line, lace * (0.6 + 0.4 * dens)), 0.0, 1.0);

  float wet = 1.0 - smoothstep(reach - 0.1, reach + 0.8, L + wig);
  float rimLine = smoothstep(0.0, 0.03, e) * (1.0 - smoothstep(0.03, 0.12, e)) * (0.4 + 0.6 * advancing);
  return vec4(cover, foam, wet, rimLine);
}
// Foam colour: bright but lit by the twilight, warmer toward the sun.
vec3 foamShade(vec3 base, vec3 V){
  float sd = max(dot(V, uSunDir), 0.0);
  return base * 0.78 + uFogGlow * (0.08 + 0.35 * pow(sd, 6.0));
}
// Foam with a little tonal variation and soft relief (thicker foam catches more light).
vec3 foamShadeAt(vec3 base, vec3 V, vec2 xz, float amt){
  float v = 0.86 + 0.14 * vnoise(xz * 7.0) ;
  return foamShade(base, V) * v * (0.85 + 0.15 * amt);
}
`
