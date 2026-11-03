import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { flowerShadeGLSL, flowerUniforms, lilyGeometry, toInstanced } from './flower'
import { fogGLSL, noiseGLSL } from './glsl'
import { BEDS } from './beds'
import { PIANO_POS, color, hideInReflection, landDist, neverReflected, shared } from './world'

// Shared stem maths: wind-bent curve from the ground (t = 0) to the flower head (t = 1).
const stemGLSL = /* glsl */ `
attribute vec3 iBase;
attribute vec4 iParams; // yaw, stem height, head size, kind (0 lily, 1 bell)
attribute vec4 iLean;   // lean x, lean z, head nod, phase
uniform float uTime;
uniform float uMotion;
${noiseGLSL}
const vec2 WIND_DIR = vec2(0.862, -0.507);
vec3 windAt(float t){
  float time = uTime * uMotion;
  float gust = vnoise(iBase.xz * 0.07 + vec2(-time * 0.22, time * 0.03));
  float wave = sin(time * 1.05 - iBase.x * 0.32 + iBase.z * 0.18) * 0.5 + 0.5;
  float sway = sin(time * 1.7 + iLean.w * 6.2831) * 0.04;
  float bend = (0.06 + 0.35 * gust * gust + 0.1 * wave + sway) * t * t * iParams.y;
  return vec3(WIND_DIR.x * bend, -bend * bend * 0.4, WIND_DIR.y * bend);
}
vec3 stemPoint(float t){
  return iBase + vec3(iLean.x * t * t, t * iParams.y, iLean.y * t * t) + windAt(t);
}
`

const headVertex = /* glsl */ `
attribute float part;
${stemGLSL}
varying vec2 vUv;
varying float vPart;
varying float vKind;
varying float vGlow;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vPart = part;
  vKind = iParams.w;
  // Head faces along the top of the stem, nodding outward.
  vec3 top = stemPoint(1.0);
  vec3 below = stemPoint(0.9);
  vec3 up = normalize(top - below);
  vec2 nodDir = normalize(vec2(iLean.x, iLean.y) + vec2(1e-4));
  up = normalize(up + vec3(nodDir.x, 0.0, nodDir.y) * iLean.z);
  vec3 ref = vec3(cos(iParams.x), 0.0, sin(iParams.x));
  vec3 xb = normalize(ref - up * dot(ref, up));
  vec3 zb = cross(xb, up);
  mat3 R = mat3(xb, up, zb);
  vec3 w = top + R * (position * iParams.z);
  vNormalW = R * normal;
  vWorld = w;
  vGlow = 1.0 - smoothstep(5.0, 25.0, distance(w, cameraPosition));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`

const headFragment = /* glsl */ `
varying vec2 vUv;
varying float vPart;
varying float vKind;
varying float vGlow;
varying vec3 vNormalW;
varying vec3 vWorld;
${fogGLSL}
${flowerShadeGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  gl_FragColor = vec4(applyFog(shadeFlower(V, dist), dist, V), 1.0);
}
`

const stemVertex = /* glsl */ `
${stemGLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vT;
void main(){
  float t = position.y;
  vT = t;
  float r = (iParams.w > 0.5 ? 0.0035 : 0.006) * (1.0 - 0.35 * t);
  vec3 w = stemPoint(t) + vec3(position.x, 0.0, position.z) * r;
  vNormalW = normalize(vec3(position.x, 0.0, position.z));
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`

const stemFragment = /* glsl */ `
uniform vec3 cStem, cSkyF, cGroundF;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vT;
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormalW);
  vec3 col = cStem * mix(cGroundF, cSkyF, N.y * 0.5 + 0.5) * (0.35 + 0.65 * vT) * 2.0;
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

// Thin open cylinder, y from 0 to 1, unit radius.
export function stemGeometry(sides = 4, rings = 6) {
  const pos = []
  const index = []
  for (let i = 0; i <= rings; i++) {
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2
      pos.push(Math.cos(a), i / rings, Math.sin(a))
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s
      const b = i * sides + ((s + 1) % sides)
      index.push(a, a + sides, b, b, a + sides, b + sides)
    }
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(index)
  return g
}

// Piano footprint (plus bench) to keep clear, in world x/z.
const PIANO_CENTRE = new THREE.Vector2(PIANO_POS.x + 1.1, PIANO_POS.z)
const blocked = (x, z) =>
  (x > PIANO_POS.x - 1.05 && x < PIANO_POS.x + 2.45 && z > PIANO_POS.z - 0.95 && z < PIANO_POS.z + 0.95) ||
  Math.hypot(x, z - 9) < 1.8 ||
  Math.hypot(x + 1.5, z - 10.8) < 1.8 ||
  z > 7.2

// Lily stems are 40% shorter than they were (the grass was halved), and there are twice as
// many lilies, except in the farthest bed out on the spit, which keeps its old look.
const LILY_STEM = 0.6
const LILY_COUNT = 2
const FAR_BED = 2

// Natural scatter: candidates come from sample(); each is kept with the probability given by
// density(x, z) (0..1) and only if no flower already stands closer than a spacing that
// shrinks where the density is high. Gives drifts and gaps instead of even sprinkling or
// tight balls, and no two flowers on top of each other.
function naturalScatter(rand, count, sample, density, spacing) {
  const out = []
  const cell = spacing
  const grid = new Map()
  const key = (i, j) => i * 73856093 + j * 19349663
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const [x, z] = sample()
    const d = density(x, z)
    if (d <= 0 || rand() > d) continue
    const minD = spacing * (1.5 - 0.8 * d)
    const ci = Math.floor(x / cell)
    const cj = Math.floor(z / cell)
    let ok = true
    const reach = Math.ceil(minD / cell)
    for (let di = -reach; di <= reach && ok; di++)
      for (let dj = -reach; dj <= reach && ok; dj++)
        for (const [px, pz] of grid.get(key(ci + di, cj + dj)) || []) if (Math.hypot(px - x, pz - z) < minD) ok = false
    if (!ok) continue
    const k = key(ci, cj)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push([x, z])
    out.push([x, z, d])
  }
  return out
}

// Smooth patchiness for drifts (value noise on a coarse grid).
function patchNoise(x, z, seed) {
  const h = (i, j) => {
    const v = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453
    return v - Math.floor(v)
  }
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const fx = x - xi
  const fz = z - zi
  const u = fx * fx * (3 - 2 * fx)
  const v = fz * fz * (3 - 2 * fz)
  return h(xi, zi) * (1 - u) * (1 - v) + h(xi + 1, zi) * u * (1 - v) + h(xi, zi + 1) * (1 - u) * v + h(xi + 1, zi + 1) * u * v
}

function flower(rand, x, z, kind, stemScale, group) {
  const leanAng = rand() * Math.PI * 2
  const lean = (kind ? 0.06 : 0.08) * rand()
  return {
    group,
    base: [x, 0, z],
    params: [
      rand() * Math.PI * 2,
      (kind ? 0.22 + rand() * 0.26 : 0.48 + rand() * 0.3) * stemScale,
      kind ? 0.05 + rand() * 0.025 : 0.11 + rand() * 0.06,
      kind,
    ],
    lean: [Math.cos(leanAng) * lean, Math.sin(leanAng) * lean, kind ? 0.5 + rand() * 0.5 : 0.15 + rand() * 0.45, rand()],
  }
}

export function scatter(rand) {
  const items = []

  // Round the piano: drifts in a loose ring (thicker toward the back and sides, thinning
  // toward the cameras), shaped by patch noise so some stretches are dense and others bare.
  const around = (kind, count, spacing, seed) =>
    naturalScatter(
      rand,
      count,
      () => {
        const ang = rand() * Math.PI * 2
        const rad = 1.2 + Math.sqrt(rand()) * 4.6
        return [PIANO_CENTRE.x + Math.cos(ang) * rad * 1.15, PIANO_CENTRE.y + Math.sin(ang) * rad * 0.85]
      },
      (x, z) => {
        if (blocked(x, z) || landDist(x, z) < 1.5) return 0
        const r = Math.hypot((x - PIANO_CENTRE.x) / 1.15, (z - PIANO_CENTRE.y) / 0.85)
        const ring = Math.min(1, (r - 1.1) / 0.8) * (1 - Math.max(0, (r - 4.4) / 1.4))
        const drift = Math.max(0, (patchNoise(x * 0.9, z * 0.9, seed) - 0.35) / 0.45)
        return Math.max(0, ring) * Math.min(1, drift)
      },
      spacing,
    )
  for (const [x, z] of around(0, 56 * LILY_COUNT, 0.16, 3)) items.push(flower(rand, x, z, 0, LILY_STEM, -1))
  for (const [x, z] of around(1, 120, 0.12, 7)) items.push(flower(rand, x, z, 1, 0.75, -1))

  // Lily beds: irregular patches with a wobbly outline, densest in the middle, with drifts
  // and gaps inside, taller toward the middle like a real planting. `short` is for flowers
  // growing out of sand (shorter stems).
  BEDS.forEach(([cx, cz, rx, rz, lilies, bells, short], group) => {
    const far = group === FAR_BED
    const sample = () => {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * 1.5
      return [cx + Math.cos(a) * r * rx, cz + Math.sin(a) * r * rz]
    }
    const rel = (x, z) => {
      const a = Math.atan2((z - cz) / rz, (x - cx) / rx)
      const edge = 0.85 + 0.22 * Math.sin(a * 3 + cx) + 0.1 * Math.sin(a * 7 + cz)
      return Math.hypot((x - cx) / rx, (z - cz) / rz) / edge
    }
    const density = (x, z) => {
      if (blocked(x, z) || landDist(x, z) < 1.2 || Math.hypot(x - 31, z + 38) < 1.6) return 0
      const r = rel(x, z)
      if (r > 1.45) return 0
      // Dense core, a soft rim, then a few stragglers seeded beyond the edge.
      const core = r < 1 ? 1 - 0.75 * Math.pow(r, 2.0) : 0.25 * (1 - (r - 1) / 0.45)
      return core * (0.4 + 0.6 * patchNoise(x * 1.3, z * 1.3, group + 11))
    }
    const add = (kind, count, stem, spacing) => {
      for (const [x, z] of naturalScatter(rand, count, sample, density, spacing)) {
        // Taller toward the middle, with plenty of variation so the tops don't form a lid.
        const h = (short ? 0.65 : 1) * (1.1 - 0.4 * Math.min(1, rel(x, z))) * (0.7 + rand() * 0.6)
        items.push(flower(rand, x, z, kind, h * stem, group))
      }
    }
    add(0, far ? lilies : lilies * LILY_COUNT, far ? 1 : LILY_STEM, far ? 0.15 : 0.095)
    add(1, bells, far ? 1 : 0.75, 0.1)
  })
  return items
}

export function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export default function FieldFlowers() {
  // One mesh pair per group (the scatter round the piano, then each bed), each with its own
  // bounds so off-screen beds are skipped. Beds use a mid-detail lily (they hold most of
  // the flowers); the few round the piano keep full detail.
  const groups = useMemo(() => {
    const items = scatter(seeded(20261101))
    const full = lilyGeometry()
    const mid = lilyGeometry({ detail: 'mid' })
    const ids = [...new Set(items.map((it) => it.group ?? -1))]
    return ids.map((id) => {
      const list = items.filter((it) => (it.group ?? -1) === id)
      const base = new Float32Array(list.length * 3)
      const params = new Float32Array(list.length * 4)
      const lean = new Float32Array(list.length * 4)
      const box = new THREE.Box3()
      list.forEach((it, i) => {
        base.set(it.base, i * 3)
        params.set(it.params, i * 4)
        lean.set(it.lean, i * 4)
        box.expandByPoint(new THREE.Vector3(...it.base))
      })
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      sphere.radius += 1.2
      sphere.center.y += 0.4
      const attrs = {
        iBase: new THREE.InstancedBufferAttribute(base, 3),
        iParams: new THREE.InstancedBufferAttribute(params, 4),
        iLean: new THREE.InstancedBufferAttribute(lean, 4),
      }
      const heads = toInstanced(id === -1 ? full : mid)
      const stems = stemGeometry()
      for (const g of [heads, stems]) {
        for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a)
        g.instanceCount = list.length
        g.boundingSphere = sphere
      }
      // Off the spit, the mirrored view can't see them (see world.neverReflected).
      return { heads, stems, field: sphere.center.z > -12 }
    })
  }, [])

  const materials = useMemo(() => {
    const f = flowerUniforms(color)
    return {
      head: new THREE.ShaderMaterial({
        vertexShader: headVertex,
        fragmentShader: headFragment,
        side: THREE.DoubleSide,
        uniforms: { ...shared, ...f },
      }),
      stem: new THREE.ShaderMaterial({
        vertexShader: stemVertex,
        fragmentShader: stemFragment,
        uniforms: { ...shared, cSkyF: f.cSkyF, cGroundF: f.cGroundF, cStem: { value: color('#2a2f66') } },
      }),
    }
  }, [])

  const group = useRef()
  const field = useRef()
  useEffect(() => {
    const g = group.current
    const f = field.current
    hideInReflection.add(g)
    neverReflected.add(f)
    return () => {
      hideInReflection.delete(g)
      neverReflected.delete(f)
    }
  }, [])

  const bed = (g, i) => (
    <group key={i}>
      <mesh geometry={g.stems} material={materials.stem} />
      <mesh geometry={g.heads} material={materials.head} />
    </group>
  )
  return (
    <group ref={group}>
      <group ref={field}>{groups.filter((g) => g.field).map(bed)}</group>
      {groups.filter((g) => !g.field).map(bed)}
    </group>
  )
}
