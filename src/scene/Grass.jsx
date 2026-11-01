import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from './glsl'
import { PIANO_POS, color, hideInReflection, palette, shared, shoreZ } from './world'

const SEGMENTS = 5
const CLUMP_CELL = 0.9 // metres between clump centres

// One tapered blade, 0..1 tall, centred on x = 0.
function bladeGeometry() {
  const positions = []
  const index = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    const w = 0.5 * Math.pow(1 - t, 0.85)
    if (i === SEGMENTS) positions.push(0, 1, 0)
    else positions.push(-w, t, 0, w, t, 0)
  }
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const last = (SEGMENTS - 1) * 2
  index.push(last, last + 1, last + 2)
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(index)
  return g
}

// Deterministic hash for clump cells.
const hash = (i, j, k) => {
  const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
  return v - Math.floor(v)
}

// Nearest clump centre to (x, z) and that clump's traits.
function nearestClump(x, z) {
  const ci = Math.floor(x / CLUMP_CELL)
  const cj = Math.floor(z / CLUMP_CELL)
  let best = null
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di
      const j = cj + dj
      const cx = (i + 0.15 + 0.7 * hash(i, j, 1)) * CLUMP_CELL
      const cz = (j + 0.15 + 0.7 * hash(i, j, 2)) * CLUMP_CELL
      const d = Math.hypot(x - cx, z - cz)
      if (!best || d < best.d) best = { d, cx, cz, i, j }
    }
  }
  best.height = 0.75 + 0.55 * hash(best.i, best.j, 3)
  best.tone = hash(best.i, best.j, 4)
  return best
}

const vertex = /* glsl */ `
attribute vec3 iOffset;
attribute vec4 iParams; // yaw, height, width, random
attribute vec2 iClump;  // clump tone, distance from clump centre (0..1)
uniform float uTime;
uniform float uMotion;
varying float vT;
varying float vRand;
varying float vTone;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vPatch;
${noiseGLSL}
void main(){
  float t = position.y;
  vT = t;
  vRand = iParams.w;
  vTone = iClump.x;
  float yaw = iParams.x, hgt = iParams.y, wid = iParams.z;

  // Blade curve: droop grows with height.
  float droop = (0.2 + vRand * 0.35) * hgt;
  vec3 p = vec3(position.x * wid, t * hgt, droop * t * t);
  // Normal of the curved blade, rounded across its width.
  vec3 tangent = normalize(vec3(0.0, hgt, 2.0 * droop * t));
  vec3 n = normalize(vec3(0.0, -tangent.z, tangent.y));
  n = normalize(n + vec3(position.x * 1.6, 0.0, 0.0));

  float c = cos(yaw), s = sin(yaw);
  mat2 rot = mat2(c, s, -s, c);
  p.xz = rot * p.xz;
  n.xz = rot * n.xz;
  vec3 w = iOffset + p;

  // Wind: slow gusts rolling across the field from the left.
  float time = uTime * uMotion;
  float gust = vnoise(iOffset.xz * 0.07 + vec2(-time * 0.22, time * 0.03));
  float wave = sin(time * 1.05 - iOffset.x * 0.32 + iOffset.z * 0.18) * 0.5 + 0.5;
  float bend = (0.1 + 0.55 * gust * gust + 0.16 * wave) * t * t * hgt;
  vec2 windDir = vec2(0.862, -0.507);
  w.xz += windDir * bend;
  w.y -= bend * bend * 0.5;
  n.xz -= windDir * bend * 0.6;

  // Large-scale patches: x = frost, y = dark hollow, z = blue tint.
  vec2 pp = iOffset.xz;
  vPatch = vec3(fbm(pp * 0.09 + 3.0), vnoise(pp * 0.16 - 7.0), vnoise(pp * 0.05 + 11.0));

  vWorld = w;
  vNormal = normalize(n);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 cBase, cTip, cFrost, cSky, cGround, cSun, cBlue;
uniform vec3 uPianoPos, uPianoGlow;
uniform float uGlowPulse;
varying float vT;
varying float vRand;
varying float vTone;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vPatch;
float spow(float x, float e){ return pow(max(x, 0.0), e); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
${fogGLSL}
void main(){
  float t = clamp(vT, 0.0, 1.0);
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 L = uSunDir;

  // Albedo: base to tip, varied per clump and by large patches.
  vec3 albedo = mix(cBase, cTip, smoothstep(0.0, 0.85, t));
  albedo *= 0.7 + 0.45 * vTone + 0.2 * (vRand - 0.5);
  albedo = mix(albedo, albedo * cBlue * 1.6, smoothstep(0.45, 0.8, vPatch.z) * 0.5);
  albedo *= 1.0 - 0.35 * smoothstep(0.5, 0.85, vPatch.y);

  // Lighting: twilight sky, low sun wrapping around blades, light through blades.
  vec3 ambient = mix(cGround, cSky, N.y * 0.5 + 0.5);
  float wrap = max((dot(N, L) + 0.5) / 1.5, 0.0);
  float through = spow(dot(V, L), 3.0) * (0.35 + 0.65 * t);
  vec3 H = normalize(L - V);
  float spec = spow(dot(N, H), 48.0) * t;

  vec3 col = albedo * (ambient + cSun * wrap * 0.45) + albedo * cSun * through * 1.4 + cSun * spec * 0.25;

  // Frost on the upper blade, heavier in frosty patches.
  float frost = smoothstep(0.3, 0.95, t) * (0.55 + 0.45 * smoothstep(0.35, 0.7, vPatch.x));
  vec3 frostLit = cFrost * (0.5 + ambient * 0.7 + cSun * (wrap * 0.3 + through * 1.4));
  col = mix(col, frostLit, frost * 0.8);

  // Ambient occlusion: dark at the roots.
  col *= mix(0.22, 1.0, smoothstep(0.0, 0.55, t));

  // Frost glints that twinkle as the camera moves.
  vec2 cell = floor(vWorld.xz * 45.0 + vWorld.y * 45.0);
  float g = fract(hash12(cell) * 41.3 + dot(cameraPosition, vec3(0.83, 0.61, 0.47)) * 0.7 + uTime * uMotion * 0.06);
  float glint = smoothstep(0.993, 1.0, g) * frost * (1.0 - smoothstep(6.0, 16.0, dist));
  col += vec3(3.0, 2.9, 3.4) * glint;

  // Blue spill from the piano.
  float pd = length(vWorld.xz - uPianoPos.xz);
  col += uPianoGlow * uGlowPulse * (0.2 + t) * 0.5 / (1.0 + pd * pd * 0.9);

  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Grass({ count }) {
  const geometry = useMemo(() => {
    const g = bladeGeometry()
    const offsets = new Float32Array(count * 3)
    const params = new Float32Array(count * 4)
    const clumps = new Float32Array(count * 2)
    let n = 0
    let guard = 0
    while (n < count && guard++ < count * 30) {
      // Denser near the camera: sample depth with a bias toward the front.
      const u = Math.random()
      const z = 11.8 - 20.8 * Math.pow(u, 0.85)
      const halfWidth = (11.5 - z) * 1.05 + 3
      const x = (Math.random() * 2 - 1) * halfWidth
      if (z < shoreZ(x) + 0.25) continue
      // Leave a clearing around the landing cameras so no blade fills the lens.
      if (Math.hypot(x, z - 9) < 1.4 || Math.hypot(x + 1.5, z - 10.8) < 1.4) continue

      // Blades crowd toward clump centres, leaving thin gaps between clumps.
      const clump = nearestClump(x, z)
      const rel = Math.min(1, clump.d / (CLUMP_CELL * 0.75))
      if (Math.random() < rel * rel * 0.65) continue

      // Keep blades out of the piano bench's footprint.
      const dx = x - (PIANO_POS.x - 0.8)
      const dz = z - PIANO_POS.z
      const nearBench = Math.abs(dx) < 0.3 && Math.abs(dz) < 0.55

      // Lean away from the clump centre, so each clump fans out.
      const awayX = x - clump.cx
      const awayZ = z - clump.cz
      const yaw =
        clump.d > 0.08 ? Math.atan2(-awayX, awayZ) + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2

      const height =
        (0.34 + Math.random() * 0.26) * clump.height * (1.08 - 0.4 * rel) * (nearBench ? 0.4 : 1) * (z < -4 ? 1.2 : 1)
      const width = 0.03 + Math.random() * 0.028 + Math.max(0, -z) * 0.004

      offsets.set([x, 0, z], n * 3)
      params.set([yaw, height, width, Math.random()], n * 4)
      clumps.set([clump.tone, rel], n * 2)
      n++
    }
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    g.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 4))
    g.setAttribute('iClump', new THREE.InstancedBufferAttribute(clumps, 2))
    g.instanceCount = n
    return g
  }, [count])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: THREE.DoubleSide,
        uniforms: {
          ...shared,
          cBase: { value: color(palette.grassBase) },
          cTip: { value: color(palette.grassTip) },
          cFrost: { value: color(palette.frost) },
          cSky: { value: color('#9a92dc') },
          cGround: { value: color('#1a1d4a') },
          cSun: { value: color(palette.glow) },
          cBlue: { value: color('#6f8cff') },
        },
      }),
    [],
  )

  const mesh = useRef()
  useEffect(() => {
    const m = mesh.current
    hideInReflection.add(m)
    return () => hideInReflection.delete(m)
  }, [])

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />
}
