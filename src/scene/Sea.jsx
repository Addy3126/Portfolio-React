import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { fogGLSL, noiseGLSL, shoreGLSL, swashGLSL } from './glsl'
import { sunLanesGLSL } from './sunLanes'
import { color, hideInReflection, palette, shared } from './world'

const SEA_LEVEL = -0.04

// Long, low swell rolling toward the beach. Returns height and slope (d/dx, d/dz).
const swellGLSL = /* glsl */ `
void addSwell(inout vec3 acc, vec2 p, vec2 dir, float len, float amp, float t){
  float k = 6.2831853 / len;
  float ph = k * dot(dir, p) - sqrt(9.8 * k) * t;
  acc.x += amp * sin(ph);
  acc.yz += dir * amp * k * cos(ph);
}
vec3 swell(vec2 p, float t){
  vec3 acc = vec3(0.0);
  addSwell(acc, p, vec2(0.15, 0.989), 18.0, 0.05, t);
  addSwell(acc, p, vec2(-0.45, 0.893), 27.0, 0.035, t);
  addSwell(acc, p, vec2(0.6, 0.8), 11.0, 0.018, t);
  return acc;
}
`

const vertex = /* glsl */ `
uniform mat4 textureMatrix;
uniform float uTime;
uniform float uMotion;
varying vec4 vUv;
varying vec3 vWorld;
varying vec2 vSwellSlope;
varying float vSwellPhase;
${shoreGLSL}
${swellGLSL}
void main(){
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  float t = uTime * uMotion;
  // Smaller swell in the shallows, so the waterline creeps rather than jumps.
  float depth0 = ${SEA_LEVEL.toFixed(3)} - seabedY(w.xz);
  float damp = mix(0.25, 1.0, smoothstep(0.0, 0.5, depth0));
  vec3 s = swell(w.xz, t) * damp;
  w.y += s.x;
  vSwellSlope = s.yz;
  vSwellPhase = 6.2831853 / 18.0 * dot(vec2(0.15, 0.989), w.xz) - sqrt(9.8 * 6.2831853 / 18.0) * t;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 color;
uniform float uTime;
uniform float uMotion;
uniform vec3 cDeep, cShallow, cFar, cGlow, cSkyRefl, cSandUnder, cFoam, cScatter;
varying vec4 vUv;
varying vec3 vWorld;
varying vec2 vSwellSlope;
varying float vSwellPhase;
${noiseGLSL}
${fogGLSL}
${shoreGLSL}
${swashGLSL}
${sunLanesGLSL}

// Slope of one travelling sine wave (deep-water dispersion).
vec2 waveSlope(vec2 p, vec2 dir, float len, float amp, float t){
  float k = 6.2831853 / len;
  float omega = sqrt(9.8 * k);
  return dir * (amp * cos(k * dot(dir, p) - omega * t));
}

void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  float t = uTime * uMotion;
  vec2 p = vWorld.xz;

  // Calm sea: swell plus a few directional waves and fine ripples.
  // Short waves fade with distance so the far water doesn't shimmer.
  float near = 1.0 - smoothstep(25.0, 260.0, dist);
  float mid = 1.0 - smoothstep(80.0, 600.0, dist);
  vec2 g = vSwellSlope;
  g += waveSlope(p, vec2(0.958, 0.287), 11.0, 0.05, t) * mid;
  g += waveSlope(p, vec2(-0.514, 0.857), 6.3, 0.045, t) * mid;
  g += waveSlope(p, vec2(0.196, -0.981), 3.4, 0.035, t) * near;
  g += waveSlope(p, vec2(0.914, -0.406), 1.9, 0.03, t) * near;
  vec2 r1 = vec2(vnoise(p * 1.3 - t * 0.25), vnoise(p * 1.3 + 9.0 + t * 0.2)) - 0.5;
  vec2 r2 = vec2(vnoise(p * 4.5 + t * 0.6), vnoise(p * 4.5 - 4.0 - t * 0.5)) - 0.5;
  g += r1 * 0.09 * near + r2 * 0.06 * near;
  // Capillary ripples right in front of the camera.
  float close = 1.0 - smoothstep(4.0, 16.0, dist);
  g += (vec2(vnoise(p * 11.0 + t * 1.1), vnoise(p * 11.0 - 3.0 - t * 0.9)) - 0.5) * 0.06 * close;
  g += (vec2(vnoise(p * 0.12 + t * 0.03), vnoise(p * 0.12 + 5.0)) - 0.5) * 0.04;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  float cosT = clamp(dot(-V, n), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * spow(1.0 - cosT, 5.0);

  #ifdef USE_REFLECTION
    vec2 ruv = vUv.xy / vUv.w + n.xz * 0.05 * (0.3 + 0.7 * near);
    vec3 refl = texture2D(tDiffuse, ruv).rgb;
  #else
    vec3 R0 = reflect(V, n);
    vec3 refl = mix(cSkyRefl, cGlow, spow(dot(R0, uSunDir), 10.0));
  #endif

  // Never draw water over land (the ground undulates around the sea level).
  float L = landDist(p);
  if (L > 0.15) discard;
  // Water depth above the seabed at this point.
  float depth = -0.04 - seabedY(p); // still-water depth (the moving swell would draw straight bands)

  // Water body by Beer-Lambert absorption: light travelling through more water loses red
  // first, then green, so the sea goes from see-through sand at the waterline, through
  // blue-violet, to deep indigo. The sea floor shelves gently, so the path length is
  // taken from distance offshore. Looking down (steep) sees less water than grazing views.
  float offshore = max(-L, 0.0);
  float path = offshore * 0.55 / max(cosT, 0.25);
  vec3 trans = exp(-vec3(0.55, 0.22, 0.1) * path);
  vec3 sandSeen = cSandUnder * (0.8 + 0.3 * vnoise(p * 3.0 + n.xz * 4.0));
  vec3 deepCol = mix(cDeep, cFar, smoothstep(120.0, 600.0, dist));
  vec3 body = sandSeen * trans + deepCol * (1.0 - trans) + cShallow * 0.25 * trans.b * (1.0 - trans.r);
  float clear = trans.g;
  float reflAmt = clamp(fresnel * 1.15 + 0.08, 0.0, 1.0) * (1.0 - clear * 0.5);
  vec3 col = mix(body, refl, reflAmt);

  // Light through the wave crests: when looking toward the low sun, the thin tops of the
  // swell glow (subsurface scattering, as in game ocean shaders).
  float crest = max(vWorld.y + 0.04, 0.0);
  float towardSun = spow(dot(V, uSunDir), 3.0);
  // Sun lanes: towers in the sea block the low sunlight on the water behind them.
  float sunLit = 1.0 - 0.85 * laneShadow(p);
  col *= mix(0.9, 1.0, sunLit);
  col += sunLit * cScatter * crest * 9.0 * towardSun * (1.0 - fresnel) * (1.0 - smoothstep(60.0, 300.0, dist));

  // Sun glitter: sharp highlights nearby, a broader streak in the distance.
  vec3 R = reflect(V, n);
  float sd = max(dot(R, uSunDir), 0.0);
  float shin = mix(2600.0, 260.0, smoothstep(6.0, 400.0, dist));
  col += sunLit * vec3(5.0, 4.6, 4.4) * spow(sd, shin) * mix(1.0, 0.45, smoothstep(6.0, 400.0, dist));
  col += sunLit * cGlow * spow(sd, 60.0) * 0.18;

  // Shore swash foam (shared with the sand shader so they meet seamlessly).
  vec4 sw = swash(p, landDist(p), t);
  col = mix(col, foamShadeAt(cFoam, V, vWorld.xz, sw.y), sw.y * 0.92);

  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

const SeaShader = {
  name: 'SeaShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: vertex,
  fragmentShader: fragment,
}

function linkUniforms(material) {
  Object.assign(material.uniforms, shared, {
    cDeep: { value: color('#1c2386') },
    cShallow: { value: color('#4a62d4') },
    cFar: { value: color(palette.seaFar) },
    cGlow: { value: color(palette.glow) },
    cSkyRefl: { value: color('#5a4f9e') },
    cSandUnder: { value: color('#5d5aa6') },
    cFoam: { value: color('#e4dcff') },
    cScatter: { value: color('#8f7cf0') },
  })
}

// Grid in the plane's local XY (world x, -z). Dense near the beach, coarse far out.
function seaGeometry(cols = 220, rows = 200) {
  const pos = []
  const index = []
  for (let j = 0; j <= rows; j++) {
    const t = j / rows
    const z = -5 - 1400 * Math.pow(t, 2.2)
    for (let i = 0; i <= cols; i++) {
      const s = (i / cols) * 2 - 1
      const x = Math.sign(s) * 1700 * Math.pow(Math.abs(s), 1.8)
      pos.push(x, -z, 0)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i
      const b = a + 1
      const c = a + cols + 1
      const d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

// reflectAll: grass and flowers appear in the reflection too (higher tiers).
export default function Sea({ reflection = 0, reflectAll = false }) {
  const { size, viewport } = useThree()
  const scale = reflection

  const mesh = useMemo(() => {
    const geometry = seaGeometry()
    let m
    if (scale > 0) {
      m = new Reflector(geometry, { textureWidth: 512, textureHeight: 256, shader: SeaShader, multisample: 0, clipBias: 0.002 })
      m.material.defines = { USE_REFLECTION: '' }
      // Skip grass and flowers while rendering the mirrored view.
      const render = m.onBeforeRender
      m.onBeforeRender = function (...args) {
        if (!reflectAll) hideInReflection.forEach((o) => (o.visible = false))
        render.apply(this, args)
        if (!reflectAll) hideInReflection.forEach((o) => (o.visible = true))
      }
    } else {
      m = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { ...SeaShader.uniforms, textureMatrix: { value: new THREE.Matrix4() } } }),
      )
    }
    linkUniforms(m.material)
    m.material.side = THREE.DoubleSide
    m.rotation.x = -Math.PI / 2
    m.position.set(0, SEA_LEVEL, 0)
    m.frustumCulled = false
    return m
  }, [scale, reflectAll])

  // Keep the reflection at a fraction of the screen resolution.
  useEffect(() => {
    if (!mesh.getRenderTarget) return
    const w = Math.max(256, Math.round(size.width * viewport.dpr * scale))
    const h = Math.max(128, Math.round(size.height * viewport.dpr * scale))
    mesh.getRenderTarget().setSize(w, h)
  }, [mesh, size.width, size.height, viewport.dpr, scale])

  useEffect(() => () => mesh.dispose?.(), [mesh])

  return <primitive object={mesh} />
}
