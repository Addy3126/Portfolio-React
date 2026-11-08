import { useMemo } from 'react'
import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  abs,
  attribute,
  cameraPosition,
  cos,
  cross,
  distance,
  dot,
  exp,
  float,
  floor,
  fract,
  faceDirection,
  length,
  max,
  mix,
  mod,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  varying,
  vec2,
  vec3,
} from 'three/tsl'
import { scatter, seeded, stemGeometry } from '../scene/FieldFlowers'
import { BOX_MIN, BOX_SIZE } from '../scene/Petals'
import { lilyGeometry, toInstanced } from '../scene/flower'
import { color } from '../scene/world'
import { lookNew } from '../quality'
import { NEVER_REFLECTED, REFLECTION_HIDDEN } from './SeaGPU'
import { applyFog, hash12, spow, u, viewNormal, vnoise } from './tsl'

// Planted lilies and bells, and the floating flowers, on the WebGPU path. Same geometry,
// placement and shading as the WebGL versions (scene/flower.js, FieldFlowers, Petals).
const c = (hex) => vec3(...color(hex).toArray())
const C = {
  petal: c('#120f3c'),
  silver: c('#c9c6ea'),
  sheen: c('#7f6cf0'),
  vein: c('#dfe6ff'),
  bell: c('#5f8dff'),
  sky: c('#8e86d6'),
  ground: c('#1a1d4a'),
  sun: c('#f5c8d0'),
  stem: c('#1c1a3a'),
}

// Shading shared by floating and planted flowers (part: 0 tepal, 1 filament, 2 anther,
// 3 pistil; kind: 0 dark lily, 1 glowing bell; glow 0..1 by distance).
function shadeFlower(V, fuv, part, kind, glowIn, N) {
  // Shared values are made variables up front: a node first built inside one branch is
  // only computed in that branch, and reads as zero in the others.
  const L = u.sunDir
  const across = abs(fuv.x.sub(0.5)).mul(2.0).toVar()
  const along = fuv.y.toVar()
  const glow = float(0.35).add(glowIn.mul(0.65)).toVar()
  const ambient = mix(C.ground, C.sky, N.y.mul(0.5).add(0.5)).toVar()
  const H = normalize(L.sub(V)).toVar()
  const out = vec3(0).toVar()

  If(part.greaterThan(2.5), () => {
    out.assign(C.stem.mul(ambient).mul(1.5).add(C.vein.mul(smoothstep(0.8, 1.0, along)).mul(1.8).mul(glow)))
  })
    .ElseIf(part.greaterThan(1.5), () => {
      out.assign(mix(C.vein, vec3(1.0), 0.35).mul(2.2).mul(glow).add(ambient.mul(0.2)))
    })
    .ElseIf(part.greaterThan(0.5), () => {
      out.assign(C.stem.mul(ambient).mul(1.4).add(C.vein.mul(smoothstep(0.7, 1.0, along)).mul(0.6).mul(glow)))
    })
    .ElseIf(kind.greaterThan(0.5), () => {
      // Small glowing blue bell: soft, self-lit, brighter toward the centre.
      const col = C.bell.mul(float(0.9).add(float(1.0).sub(along).mul(0.8))).mul(float(1.0).sub(across.mul(0.3)))
      out.assign(col.add(C.bell.mul(ambient).mul(0.4)).add(vec3(1.0).mul(spow(dot(N, H), 40.0)).mul(0.25)))
    })
    .Else(() => {
      const wrap = max(dot(N, L).add(0.4).div(1.4), 0.0)
      const rim = spow(float(1.0).sub(abs(dot(N, V.negate()))), 3.0)
      const through = spow(dot(V, L), 4.0)
      // Silver at the heart and along the midline, dark indigo at edges and tips.
      const s0 = float(1.0).sub(smoothstep(0.15, 0.7, along)).mul(float(1.0).sub(smoothstep(0.35, 0.95, across)))
      const silver = max(s0, exp(across.mul(across).mul(-30.0)).mul(float(1.0).sub(smoothstep(0.3, 0.9, along))).mul(0.6))
      const albedo = mix(C.petal.mul(float(1.1).sub(across.mul(0.35))), C.silver, silver.mul(0.85)).toVar()
      // Freckles near the throat.
      const g = vec2(across.mul(7.0), along.mul(16.0))
      const r = hash12(floor(g))
      const d = length(fract(g).sub(0.5).sub(r.sub(0.5).mul(0.3)))
      const freckle = step(0.7, r)
        .mul(float(1.0).sub(smoothstep(0.07, 0.16, d)))
        .mul(step(0.08, along))
        .mul(float(1.0).sub(step(0.42, along)))
        .mul(float(1.0).sub(step(0.75, across)))
      albedo.mulAssign(float(1.0).sub(freckle.mul(0.55)))
      const col = albedo.mul(ambient.mul(0.65).add(C.sun.mul(wrap).mul(0.45))).toVar()
      col.addAssign(C.sun.mul(spow(dot(N, H), 90.0)).mul(1.1))
      col.addAssign(C.sky.mul(spow(dot(reflect(V, N), vec3(0, 1, 0)), 10.0)).mul(0.18))
      col.addAssign(C.sheen.mul(rim).mul(0.4))
      col.addAssign(C.sheen.mul(through).mul(across.mul(0.75).add(0.25)).mul(0.5))
      // Glowing silver midrib, faint diagonal side veins, bright heart.
      const vein = exp(across.mul(across).mul(-90.0)).mul(float(1.0).sub(smoothstep(0.6, 0.98, along)))
      const sideV = exp(pow(fract(across.mul(2.5).sub(along.mul(1.2))).sub(0.5), 2.0).mul(-140.0))
        .mul(0.16)
        .mul(float(1.0).sub(along))
        .mul(float(1.0).sub(across))
      const heart = float(1.0).sub(smoothstep(0.0, 0.2, along))
      col.addAssign(C.vein.mul(vein.mul(1.5).add(sideV).add(heart.mul(1.1))).mul(glow))
      out.assign(col)
    })
  return out
}

// Rotate v by the basis (xb, up, zb) (columns of a rotation matrix).
const basis = (xb, up, zb, v) => xb.mul(v.x).add(up.mul(v.y)).add(zb.mul(v.z))

// rim: the floating flowers' backlit edge (new look), so against the bright sky they read
// as dark flowers rimmed with light rather than specks of dust.
function finishFlower(m, worldNode, normalNode, kindNode, rim = false) {
  m.positionNode = worldNode
  const vN = varying(normalNode)
  m.normalNode = viewNormal(normalize(vN).mul(faceDirection))
  const vUv = varying(attribute('uv', 'vec2'))
  const vPart = varying(attribute('part', 'float'))
  const vKind = varying(kindNode)
  m.colorNode = Fn(() => {
    const toP = positionWorld.sub(cameraPosition)
    const dist = length(toP)
    const V = toP.div(dist)
    const glow = float(1.0).sub(smoothstep(5.0, 25.0, dist))
    const N = normalize(vN.add(vec3(0, 1e-5, 0))).mul(faceDirection).toVar()
    const col = shadeFlower(V, vUv, vPart, vKind, glow, N).toVar()
    if (rim) {
      const edge = pow(float(1.0).sub(abs(dot(N, V))), 3.0).mul(pow(dot(V, u.sunDir).mul(0.5).add(0.5), 2.5))
      col.addAssign(C.sun.mul(edge).mul(0.9))
    }
    return applyFog(col, dist, V)
  })()
}

// --- Planted flowers ---
const WIND = vec3(0.862, 0, -0.507)
function stemPoint(t) {
  const iBase = attribute('iBase', 'vec3')
  const iParams = attribute('iParams', 'vec4')
  const iLean = attribute('iLean', 'vec4')
  const time = u.time.mul(u.motion)
  const gust = vnoise(iBase.xz.mul(0.07).add(vec2(time.mul(-0.22), time.mul(0.03))))
  const wave = sin(time.mul(1.05).sub(iBase.x.mul(0.32)).add(iBase.z.mul(0.18))).mul(0.5).add(0.5)
  const sway = sin(time.mul(1.7).add(iLean.w.mul(6.2831))).mul(0.04)
  const bend = float(0.06).add(gust.mul(gust).mul(0.35)).add(wave.mul(0.1)).add(sway).mul(t).mul(t).mul(iParams.y)
  const wind = vec3(WIND.x.mul(bend), bend.mul(bend).mul(-0.4), WIND.z.mul(bend))
  return iBase.add(vec3(iLean.x.mul(t).mul(t), t.mul(iParams.y), iLean.y.mul(t).mul(t))).add(wind)
}

function headMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false })
  const iParams = attribute('iParams', 'vec4')
  const iLean = attribute('iLean', 'vec4')
  const top = stemPoint(float(1.0))
  const below = stemPoint(float(0.9))
  const nod = normalize(iLean.xy.add(vec2(1e-4)))
  const up = normalize(normalize(top.sub(below)).add(vec3(nod.x, 0, nod.y).mul(iLean.z)))
  const ref = vec3(cos(iParams.x), 0, sin(iParams.x))
  const xb = normalize(ref.sub(up.mul(dot(ref, up))))
  const zb = cross(xb, up)
  const P = attribute('position', 'vec3')
  const Nrm = attribute('normal', 'vec3')
  finishFlower(m, top.add(basis(xb, up, zb, P.mul(iParams.z))), basis(xb, up, zb, Nrm), iParams.w)
  return m
}

function stemMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: false })
  const P = attribute('position', 'vec3')
  const iParams = attribute('iParams', 'vec4')
  const t = P.y
  const r = iParams.w.greaterThan(0.5).select(0.0035, 0.006).mul(float(1.0).sub(t.mul(0.35)))
  m.positionNode = stemPoint(t).add(vec3(P.x, 0, P.z).mul(r))
  const vN = varying(normalize(vec3(P.x, 0, P.z)))
  m.normalNode = viewNormal(normalize(vN))
  const vT = varying(t)
  m.colorNode = Fn(() => {
    const toP = positionWorld.sub(cameraPosition)
    const dist = length(toP)
    const V = toP.div(dist)
    const col = c('#2a2f66').mul(mix(C.ground, C.sky, normalize(vN).y.mul(0.5).add(0.5))).mul(vT.mul(0.65).add(0.35)).mul(2.0)
    return applyFog(col, dist, V)
  })()
  return m
}

export function FieldFlowersGPU() {
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
      // Off the spit, the mirrored view can't see them (see NEVER_REFLECTED).
      return { heads, stems, layer: sphere.center.z > -12 ? NEVER_REFLECTED : REFLECTION_HIDDEN }
    })
  }, [])
  const materials = useMemo(() => ({ head: headMaterial(), stem: stemMaterial() }), [])

  return (
    <group>
      {groups.map((g, i) => (
        <group key={i}>
          <mesh geometry={g.stems} material={materials.stem} layers={g.layer} />
          <mesh geometry={g.heads} material={materials.head} layers={g.layer} />
        </group>
      ))}
    </group>
  )
}

// --- Floating flowers: drift toward the sun in a wrapping box, tumbling slowly ---
function petalMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false })
  const iSeed = attribute('iSeed', 'vec4')
  const iSeed2 = attribute('iSeed2', 'vec4')
  const boxMin = vec3(...BOX_MIN)
  const boxSize = vec3(...BOX_SIZE)
  const t = u.time.mul(u.motion)
  const speed = iSeed.w.mul(0.9).add(0.5)
  const flow = normalize(vec3(u.sunDir.x.add(0.45), 0, u.sunDir.z))
  const p0 = boxMin.add(iSeed.xyz.mul(boxSize)).add(flow.mul(t.mul(speed).mul(1.4)))
  const pxz = boxMin.xz.add(mod(p0.xz.sub(boxMin.xz), boxSize.xz))
  const ph = iSeed2.x.mul(6.2831)
  const p = vec3(
    pxz.x.add(sin(t.mul(0.35).mul(speed).add(ph).add(pxz.y.mul(0.08))).mul(1.6)),
    p0.y.add(sin(t.mul(0.5).mul(speed).add(ph.mul(1.3))).mul(0.9)).add(sin(t.mul(0.17).add(pxz.x.mul(0.05))).mul(0.6)),
    pxz.y.add(cos(t.mul(0.3).mul(speed).add(ph)).mul(1.2)),
  )
  const camDist = distance(p, cameraPosition)
  // (Slightly larger in the new look, where there are fewer of them.)
  const size = iSeed2.y.mul(0.085).add(0.085).mul(camDist.div(6.0).clamp(0.4, 1.0)).mul(lookNew ? 1.15 : 1.0)
  const axis = normalize(vec3(iSeed2.z.sub(0.5), 0.6, iSeed2.w.sub(0.5)))
  const ang = t.mul(iSeed2.z.mul(0.45).add(0.2)).add(ph)
  // Rodrigues rotation about `axis`.
  const rot = (v) => v.mul(cos(ang)).add(cross(axis, v).mul(sin(ang))).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(cos(ang))))
  const P = attribute('position', 'vec3')
  finishFlower(m, p.add(rot(P.mul(size))), rot(attribute('normal', 'vec3')), float(0.0), lookNew)
  return m
}

export function PetalsGPU({ count }) {
  const geometry = useMemo(() => {
    const g = toInstanced(lilyGeometry({ detail: 'low' }))
    const a = new Float32Array(count * 4)
    const b = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i++) {
      a[i] = Math.random()
      b[i] = Math.random()
    }
    for (let i = 0; i < count; i++) a[i * 4 + 1] = Math.pow(a[i * 4 + 1], 1.8)
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(a, 4))
    g.setAttribute('iSeed2', new THREE.InstancedBufferAttribute(b, 4))
    g.instanceCount = count
    return g
  }, [count])
  const material = useMemo(petalMaterial, [])
  return <mesh geometry={geometry} material={material} frustumCulled={false} layers={REFLECTION_HIDDEN} />
}
