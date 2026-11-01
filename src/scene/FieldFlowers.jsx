import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { flowerShadeGLSL, flowerUniforms, lilyGeometry, toInstanced } from './flower'
import { fogGLSL, noiseGLSL } from './glsl'
import { PIANO_POS, color, hideInReflection, shared } from './world'

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
function stemGeometry(sides = 4, rings = 6) {
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

function scatter(rand) {
  const items = []
  const addClusters = (clusters, perMin, perMax, kind) => {
    for (let c = 0; c < clusters; c++) {
      let cx
      let cz
      for (let tries = 0; tries < 30; tries++) {
        const ang = rand() * Math.PI * 2
        const rad = 1.4 + Math.pow(rand(), 0.8) * 3.6
        cx = PIANO_CENTRE.x + Math.cos(ang) * rad * 1.15
        cz = PIANO_CENTRE.y + Math.sin(ang) * rad * 0.85
        if (!blocked(cx, cz)) break
      }
      const n = perMin + Math.floor(rand() * (perMax - perMin + 1))
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * (kind ? 0.9 : 0.7)
        const z = cz + (rand() - 0.5) * (kind ? 0.9 : 0.7)
        if (blocked(x, z)) continue
        const leanAng = rand() * Math.PI * 2
        const lean = (kind ? 0.06 : 0.08) * rand()
        items.push({
          base: [x, 0, z],
          params: [
            rand() * Math.PI * 2,
            kind ? 0.22 + rand() * 0.26 : 0.48 + rand() * 0.3,
            kind ? 0.05 + rand() * 0.025 : 0.11 + rand() * 0.06,
            kind,
          ],
          lean: [Math.cos(leanAng) * lean, Math.sin(leanAng) * lean, kind ? 0.5 + rand() * 0.5 : 0.15 + rand() * 0.45, rand()],
        })
      }
    }
  }
  addClusters(16, 2, 5, 0) // dark lilies
  addClusters(20, 4, 8, 1) // small glowing bells
  return items
}

function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export default function FieldFlowers() {
  const { heads, stems } = useMemo(() => {
    const items = scatter(seeded(20261101))
    const base = new Float32Array(items.length * 3)
    const params = new Float32Array(items.length * 4)
    const lean = new Float32Array(items.length * 4)
    items.forEach((it, i) => {
      base.set(it.base, i * 3)
      params.set(it.params, i * 4)
      lean.set(it.lean, i * 4)
    })
    const attrs = {
      iBase: new THREE.InstancedBufferAttribute(base, 3),
      iParams: new THREE.InstancedBufferAttribute(params, 4),
      iLean: new THREE.InstancedBufferAttribute(lean, 4),
    }
    const heads = toInstanced(lilyGeometry())
    const stems = stemGeometry()
    for (const g of [heads, stems]) {
      for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a)
      g.instanceCount = items.length
    }
    return { heads, stems }
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
  useEffect(() => {
    const g = group.current
    hideInReflection.add(g)
    return () => hideInReflection.delete(g)
  }, [])

  return (
    <group ref={group}>
      <mesh geometry={stems} material={materials.stem} frustumCulled={false} />
      <mesh geometry={heads} material={materials.head} frustumCulled={false} />
    </group>
  )
}
