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
