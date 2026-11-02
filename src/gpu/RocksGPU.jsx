import { useMemo } from 'react'
import * as THREE from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  length,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  varying,
  vec2,
  vec3,
} from 'three/tsl'
import { headlandDisplay, rockGroups } from '../scene/Rocks'
import { color } from '../scene/world'
import { surface, triplanar } from './textures'
import { applyFog, fbm3g, foamShadeAt, landDist, swash, u, vnoise, vnoise3 } from './tsl'

// Rocks and beach stones on the WebGPU path. Same look as the WebGL rocks, with the fine
// surface now from photo-scanned rock (normals, roughness, cavities) mapped triplanar,
// instead of layers of procedural noise: more real detail, and cheaper to shade.
const c = (hex) => vec3(...color(hex).toArray())

// Bend a normal by the gradient of a 3D noise field (medium-scale relief).
function noiseRelief(N, Q, e, amount, gyScale = 1) {
  const g0 = fbm3g(Q)
  const grad = vec3(fbm3g(Q.add(vec3(e, 0, 0))).sub(g0), fbm3g(Q.add(vec3(0, e, 0))).sub(g0).mul(gyScale), fbm3g(Q.add(vec3(0, 0, e))).sub(g0)).div(e)
  return normalize(N.sub(grad.sub(N.mul(dot(grad, N))).mul(amount)))
}

export function rockMaterialGPU() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: false })
  const vCurv = varying(attribute('aCurv', 'float'))
  const rockTex = surface('rock_face_03')
  const strata = surface('cliff_side')
  m.colorNode = Fn(() => {
    const W = positionWorld.toVar()
    const toP = W.sub(cameraPosition)
    const dist = length(toP).toVar()
    const V = toP.div(dist).toVar()
    const N0 = normalize(normalWorld.add(vec3(0, 1e-5, 0))).toVar()
    const h = W.y
    const detail = float(1.0).sub(smoothstep(40.0, 220.0, dist))

    // Medium relief (bulges, hollows, ledges that read at a distance), then the scanned
    // rock surface up close and layered strata on the big masses.
    const N1 = noiseRelief(N0, W.mul(0.22), 0.15, 0.32, 1.6)
    const fine = triplanar(rockTex, W, N1, 0.45, detail.mul(1.1))
    const big = triplanar(strata, W, fine.N, 0.07, 0.8)
    const N = big.N.toVar()

    // Base colour: cool grey stone with warm/cool variation and strata bands.
    const albedo = mix(c('#2f2c48'), c('#45415f'), smoothstep(0.3, 0.7, fbm3g(W.mul(0.06)))).toVar()
    albedo.assign(mix(albedo, c('#4a3a52'), smoothstep(0.55, 0.8, fbm3g(W.mul(0.13).add(7.0))).mul(0.5)))
    albedo.mulAssign(float(0.88).add(vnoise(vec2(h.mul(1.8), W.x.add(W.z).mul(0.04))).mul(0.24)))
    // Scanned luminance: mineral grain up close, strata colour further out.
    albedo.mulAssign(mix(float(1.0), fine.lum.mul(1.1).add(0.45), detail))
    albedo.mulAssign(big.lum.mul(0.6).add(0.7))
    // Thin dark joints.
    const j = abs(vnoise3(W.mul(vec3(0.35, 0.9, 0.35))).sub(0.5))
    albedo.mulAssign(float(1.0).sub(float(1.0).sub(smoothstep(0.0, 0.025, j)).mul(0.55).mul(float(1.0).sub(smoothstep(150.0, 400.0, dist)))))
    // Crevices darker, edges worn lighter.
    albedo.mulAssign(float(1.0).sub(smoothstep(0.05, 0.8, vCurv).mul(0.5)))
    albedo.assign(mix(albedo, albedo.mul(1.35).add(0.02), smoothstep(0.1, 0.8, vCurv.negate()).mul(0.6)))
    // Lichen on upward faces, frost on flat tops.
    const lichen = smoothstep(0.62, 0.72, fbm3g(W.mul(0.45).add(3.0))).mul(smoothstep(-0.1, 0.5, N.y))
    albedo.assign(mix(albedo, c('#5b6a82').mul(float(0.8).add(vnoise3(W.mul(5.0)).mul(0.4))), lichen.mul(0.7)))
    const up = smoothstep(0.6, 0.9, N.y).mul(smoothstep(0.4, 0.7, fbm3g(W.mul(0.3))))
    albedo.assign(mix(albedo, c('#9a93cc'), up.mul(0.5)))
    // Waterline: dark wet band with algae, a faint salt crust above.
    const inWater = float(1.0).sub(smoothstep(-0.3, 0.4, landDist(W.xz))).toVar()
    const wet = float(1.0).sub(smoothstep(0.05, 0.7, h)).mul(inWater)
    albedo.assign(mix(albedo, c('#141633'), wet.mul(0.9)))
    const salt = smoothstep(0.5, 0.8, h).mul(float(1.0).sub(smoothstep(0.9, 1.6, h))).mul(smoothstep(0.5, 0.7, vnoise(W.xz.mul(3.0).add(h))))
    albedo.assign(mix(albedo, c('#b9b2d6'), salt.mul(0.3)))

    // Lighting: sky ambient (with curvature and scanned cavity occlusion), wrapped low
    // sun, rim when backlit, a sheen that is sharper where the scan says smooth.
    const ao = float(1.0).sub(smoothstep(0.0, 0.9, vCurv).mul(0.45)).mul(mix(1.0, fine.ao, detail.mul(0.8)))
    const ambient = mix(c('#1a1d4a'), c('#7d74c4'), N.y.mul(0.5).add(0.5)).mul(ao)
    const wrap = max(dot(N, u.sunDir).add(0.25).div(1.25), 0.0)
    const rim = pow(max(float(1.0).sub(abs(dot(N, V.negate()))), 0.0), 3.0).mul(pow(max(dot(V, u.sunDir), 0.0), 3.0))
    const H = normalize(u.sunDir.sub(V))
    const sheen = pow(max(dot(N, H), 0.0), mix(60.0, 20.0, fine.rough)).mul(float(0.08).add(wet.mul(0.6)))
    const sunC = c('#f5c8d0')
    const col = albedo.mul(ambient.add(sunC.mul(wrap).mul(0.55))).add(sunC.mul(rim.mul(0.3).add(sheen))).toVar()

    // Foam lapping where the rock meets the water.
    const t = u.time.mul(u.motion)
    const line = float(-0.04).add(sin(t.mul(1.2).add(W.x.mul(0.7)).add(W.z.mul(0.5))).mul(0.035))
    const foam = float(1.0)
      .sub(smoothstep(0.0, 0.07, abs(h.sub(line))))
      .mul(smoothstep(0.4, 0.7, vnoise(W.xz.mul(6.0).add(t.mul(0.3)))))
      .mul(float(1.0).sub(smoothstep(0.6, 0.9, abs(N.y))))
    col.assign(mix(col, c('#e4dcff'), foam.mul(0.7).mul(inWater)))
    return applyFog(col, dist, V)
  })()
  return m
}

// An octave of feature size s (metres) stays visible until it shrinks below ~1.5 px.
const vis = (s, dist) => float(1.0).sub(smoothstep(0.6, 1.0, dist.div(s * 420.0)))

export function stoneMaterialGPU() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: false })
  const info = attribute('iInfo', 'vec4')
  const vSeed = varying(info.x)
  const vObj = varying(attribute('position', 'vec3').mul(info.yzw)) // stone space, in metres
  const vLocalY = varying(attribute('position', 'vec3').y)
  const tex = surface('rock_face_03')
  m.colorNode = Fn(() => {
    const W = positionWorld.toVar()
    const toP = W.sub(cameraPosition)
    const dist = length(toP).toVar()
    const V = toP.div(dist).toVar()
    const N0 = normalize(normalWorld.add(vec3(0, 1e-5, 0))).toVar()
    const P = vObj.add(vSeed.mul(31.0)).toVar() // per-stone offset so patterns differ

    // Rock type per stone: granite, basalt, quartzite, sandstone.
    const k = vSeed
    const isG = k.lessThan(0.34)
    const isB = k.greaterThanEqual(0.34).and(k.lessThan(0.62))
    const isQ = k.greaterThanEqual(0.62).and(k.lessThan(0.82))
    const base = isG.select(c('#8a7f8e'), isB.select(c('#2a2934'), isQ.select(c('#c4bfd0'), c('#8e7476')))).mul(float(0.62).add(fract(vSeed.mul(7.31)).mul(0.8)))
    const grain = isG.select(1.0, isB.select(0.35, isQ.select(0.25, 0.5)))
    const veins = isG.select(0.15, isB.select(0.35, isQ.select(0.6, 0.0)))
    const bands = isG.or(isB).or(isQ).select(0.0, 1.0)

    // Scanned surface in the stone's own space (sticks to the stone), fading with distance.
    const vG = vis(0.008, dist)
    const s = triplanar(tex, P, N0, 3.5, vis(0.01, dist).mul(1.3))
    const N = s.N.toVar()
    const albedo = base.mul(fbm3g(P.mul(14.0)).mul(0.6).add(0.7)).toVar()
    albedo.mulAssign(mix(float(1.0), s.lum.mul(1.2).add(0.4), vis(0.01, dist)))
    // Crystals for granite: light feldspar and dark mica.
    const g1 = vnoise3(P.mul(130.0))
    const speck = smoothstep(0.62, 0.8, g1).mul(vG)
    const darkSpeck = float(1.0).sub(smoothstep(0.18, 0.32, g1)).mul(vG)
    albedo.assign(mix(albedo, albedo.mul(1.8).add(0.05), speck.mul(0.75).mul(grain)))
    albedo.mulAssign(float(1.0).sub(darkSpeck.mul(0.6).mul(grain)))
    // Quartz veins and sandstone bands.
    const vn = abs(vnoise3(P.mul(vec3(18.0, 30.0, 18.0)).add(5.0)).sub(0.5))
    albedo.assign(mix(albedo, c('#c4bfd0').mul(1.6), float(1.0).sub(smoothstep(0.0, 0.045, vn)).mul(veins).mul(vis(0.01, dist)).mul(0.85)))
    const bandv = sin(vObj.y.mul(90.0).add(vnoise3(P.mul(20.0)).mul(4.0))).mul(0.5).add(0.5)
    albedo.mulAssign(float(1.0).sub(bands.mul(0.3).mul(bandv).mul(vis(0.012, dist))))
    // Pits (from the scan's cavities) read darker.
    albedo.mulAssign(mix(float(1.0), s.ao.mul(0.7).add(0.3), vis(0.006, dist)))

    // Wetness from the swash (and anything standing in the sea).
    const L = landDist(W.xz)
    const t = u.time.mul(u.motion)
    const sw = swash(W.xz, L, t).toVar()
    const wet0 = clamp(max(max(sw.z, sw.x), float(1.0).sub(smoothstep(-0.4, 0.1, L))), 0.0, 1.0)
    const dryTop = smoothstep(0.0, 0.7, vLocalY.add(vnoise3(P.mul(25.0)).sub(0.5).mul(0.5)))
    const wet = wet0.mul(mix(1.0, 0.35, dryTop.mul(float(1.0).sub(sw.x)))).toVar()
    const lum = dot(albedo, vec3(0.299, 0.587, 0.114))
    albedo.assign(mix(albedo, mix(vec3(lum), albedo, 1.2).mul(0.62), wet))
    // Dry stones: sand dusting around the base.
    const dust = float(1.0).sub(smoothstep(-0.45, -0.1, vLocalY)).mul(float(1.0).sub(wet)).mul(float(0.55).add(vnoise3(P.mul(90.0)).mul(0.45).mul(vG)))
    albedo.assign(mix(albedo, c('#a49ad0'), dust.mul(0.65)))

    // Lighting: sky ambient, wrapped low sun, a specular that tightens when wet and breaks
    // up where the scan is rough, plus a wet reflection of the sky.
    const ao = mix(0.45, 1.0, smoothstep(-0.6, 0.3, vLocalY))
    const ambient = mix(c('#232458'), c('#8f86d0'), N.y.mul(0.5).add(0.5)).mul(ao)
    const wrap = max(dot(N, u.sunDir).add(0.2).div(1.2), 0.0)
    const H = normalize(u.sunDir.sub(V))
    const film = smoothstep(0.35, 0.65, float(1.0).sub(s.rough).add(vnoise3(P.mul(60.0)).sub(0.5).mul(0.4)))
    const spec = pow(max(dot(N, H), 0.0), mix(14.0, 90.0, wet)).mul(mix(0.08, 1.4, wet)).mul(mix(0.25, 1.0, film))
    const fres = float(0.04).add(pow(float(1.0).sub(clamp(dot(N, V.negate()), 0.0, 1.0)), 5.0).mul(0.96))
    const skyR = mix(c('#5a4f9e'), u.fogGlow, pow(max(dot(reflect(V, N), u.sunDir), 0.0), 6.0))
    const reflAmt = wet.mul(fres.mul(0.55).add(0.08)).mul(mix(0.55, 1.0, film))
    const sunC = c('#f5c8d0')
    const col = albedo
      .mul(ambient.add(sunC.mul(wrap).mul(0.7)))
      .mul(float(1.0).sub(reflAmt.mul(0.5)))
      .add(sunC.mul(spec))
      .add(skyR.mul(reflAmt))
      .toVar()
    // Foam lapping round stones the swash reaches.
    col.assign(mix(col, foamShadeAt(c('#e4dcff'), V, W.xz, sw.y), sw.y.mul(0.85).mul(float(1.0).sub(smoothstep(0.0, 0.25, vLocalY.add(0.3))))))
    return applyFog(col, dist, V)
  })()
  return m
}

let shared = null
export function rockMaterialsGPU() {
  if (!shared) shared = { rock: rockMaterialGPU(), stone: stoneMaterialGPU() }
  return shared
}

export default function RocksGPU() {
  const { headland, groups } = useMemo(() => {
    const { rock, stone } = rockMaterialsGPU()
    return { groups: rockGroups(rock, stone), headland: headlandDisplay(rock) }
  }, [])
  return (
    <group>
      {headland.map((m, i) => (
        <primitive key={`h${i}`} object={m} />
      ))}
      {groups.map((m, i) => (
        <primitive key={`r${i}`} object={m} />
      ))}
    </group>
  )
}
