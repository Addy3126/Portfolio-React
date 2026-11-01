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
// Ground height past the waterline (slopes into the sea), 0 inland.
float seabedY(vec2 xz){ float below = shoreZ(xz.x) - xz.y; return below > 0.0 ? -min(0.45, below * 0.22) : 0.0; }
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
      float d = texture2D(uShadowMap, c.xy + vec2(float(i), float(j)) * r).r;
      lit += (c.z - 0.003 > d) ? 0.0 : 1.0;
    }
  }
  return lit / 25.0;
}
float pianoContact(vec2 xz){
  float e = length((xz - vec2(-1.45, 3.7)) / vec2(1.45, 0.85));
  float bench = length((xz - vec2(-3.33, 3.7)) / vec2(0.32, 0.55));
  return (1.0 - 0.45 * (1.0 - smoothstep(0.55, 1.35, e))) * (1.0 - 0.3 * (1.0 - smoothstep(0.6, 1.4, bench)));
}
`
