import { useMemo } from 'react'
import * as THREE from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  dot,
  float,
  floor,
  length,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import Ruins, { DIM, WARM } from '../scene/Ruins'
import { color } from '../scene/world'
import { rockMaterialsGPU } from './RocksGPU'
import { surface } from './textures'
import { applyFog, fbm3g, u, vnoise } from './tsl'

// Ruined buildings and the rock plateau on the WebGPU path. Walls now carry photo-scanned
// masonry (concrete, mixed brick, rustic stone, with patches of damaged plaster), mapped
// along each face; the weathering (streaks, rising damp, algae, salt bloom, frost) is the
// same as on the WebGL buildings.
const c = (hex) => vec3(...color(hex).toArray())

const PALETTES = {
  concrete: { wall: '#3a3652', wall2: '#2e2b45', mortar: '#4a4664', trim: '#46425f', tex: 'concrete_wall_008', size: 3.0 },
  brick: { wall: '#4a2f40', wall2: '#3a2536', mortar: '#6a6080', trim: '#5a5270', tex: 'mixed_brick_wall', size: 2.0 },
  stone: { wall: '#4a4660', wall2: '#3c3852', mortar: '#2a273d', trim: '#575270', tex: 'rustic_stone_wall', size: 2.6 },
}

function buildingMaterialGPU(style) {
  const p = PALETTES[style]
  const m = new THREE.MeshBasicNodeMaterial({ fog: false })
  const wallTex = surface(p.tex)
  const plaster = surface('damaged_plaster')
  const kind = attribute('aKind', 'float')
  m.colorNode = Fn(() => {
    const W = positionWorld.toVar()
    const toP = W.sub(cameraPosition)
    const dist = length(toP).toVar()
    const V = toP.div(dist).toVar()
    const N0 = normalize(normalWorld.add(vec3(0, 1e-5, 0))).toVar()
    const k = floor(kind.add(0.5)).toVar()
    const y = W.y
    // Face frame: coordinate along the face, its tangent, and the up direction.
    const xFace = abs(N0.x).greaterThan(abs(N0.z))
    const uu = xFace.select(W.z, W.x).toVar()
    const T = xFace.select(vec3(0, 0, 1), vec3(1, 0, 0))
    const flat = abs(N0.y).greaterThan(0.7)
    const uv = flat.select(W.xz, vec2(uu, y)).div(p.size).toVar()
    const detail = float(1.0).sub(smoothstep(50.0, 140.0, dist)).toVar()

    // Scanned masonry, and damaged plaster in patches on concrete.
    const s = texture(wallTex.s, uv)
    const n = texture(wallTex.n, uv)
    const plasterMask = style === 'concrete' ? smoothstep(0.55, 0.7, fbm3g(W.mul(0.18))) : float(0.0)
    const sp = texture(plaster.s, uv.mul(1.3))
    const np = texture(plaster.n, uv.mul(1.3))
    const lum = mix(s.r, sp.r, plasterMask)
    const tn = mix(n.xy, np.xy, plasterMask).mul(2.0).sub(1.0).mul(detail)
    const B = flat.select(vec3(0, 0, 1), vec3(0, 1, 0))
    const Tf = flat.select(vec3(1, 0, 0), T)
    const masonry = k.lessThan(0.5).or(abs(k.sub(2.0)).lessThan(0.5)).or(abs(k.sub(6.0)).lessThan(0.5)).or(abs(k.sub(1.0)).lessThan(0.5))
    const N = masonry.select(normalize(N0.add(Tf.mul(tn.x)).add(B.mul(tn.y))), N0).toVar()
    const ao = mix(float(1.0), mix(s.b, sp.b, plasterMask), detail)

    // Base colour by part (wall, slab, column, dark core, rebar, vine, trim).
    const wall = mix(c(p.wall), c(p.wall2), vnoise(vec2(uu.mul(0.35), y.mul(0.25)))).mul(lum.mul(1.1).add(0.45))
    const albedo = wall.toVar()
    albedo.assign(abs(k.sub(2.0)).lessThan(0.5).select(albedo.mul(0.9), albedo))
    albedo.assign(abs(k.sub(1.0)).lessThan(0.5).select(c('#2f2c46').mul(lum.mul(0.8).add(0.6)), albedo))
    albedo.assign(abs(k.sub(3.0)).lessThan(0.5).select(c('#07060e'), albedo))
    albedo.assign(abs(k.sub(4.0)).lessThan(0.5).select(c('#3a2420'), albedo))
    albedo.assign(abs(k.sub(5.0)).lessThan(0.5).select(c('#2c4352').mul(float(0.7).add(vnoise(W.xy.mul(3.0).add(W.z)).mul(0.6))), albedo))
    albedo.assign(abs(k.sub(6.0)).lessThan(0.5).select(c(p.trim).mul(lum.mul(0.8).add(0.6)), albedo))

    // Weathering on masonry: rain streaks, grime low down, rising damp with algae and salt
    // bloom, a salt crust, frost on ledges.
    const weathered = k.lessThan(2.5).or(abs(k.sub(6.0)).lessThan(0.5))
    const vertical = float(1.0).sub(smoothstep(0.2, 0.5, abs(N0.y)))
    const streak = smoothstep(0.62, 0.9, vnoise(vec2(uu.mul(5.0), y.mul(0.22)))).mul(vertical)
    const wAlb = albedo.mul(float(1.0).sub(streak.mul(0.28))).mul(mix(0.72, 1.0, smoothstep(0.0, 5.0, y))).toVar()
    wAlb.assign(mix(wAlb, c('#141633'), float(1.0).sub(smoothstep(0.1, 0.7, y))))
    const dampTop = float(1.6).add(vnoise(vec2(uu.mul(0.35), 1.0)).mul(1.4)).add(vnoise(vec2(uu.mul(2.0), 3.0)).mul(0.4))
    const damp = float(1.0).sub(smoothstep(dampTop.sub(0.5), dampTop, y))
    wAlb.mulAssign(float(1.0).sub(damp.mul(0.32).mul(vertical)))
    wAlb.assign(mix(wAlb, c('#1f3a44'), float(1.0).sub(smoothstep(0.4, 1.4, y)).mul(smoothstep(0.35, 0.65, vnoise(vec2(uu.mul(1.6), y.mul(2.0))))).mul(0.55).mul(vertical)))
    const bloom = float(1.0).sub(smoothstep(0.0, 0.25, abs(y.sub(dampTop).add(0.15)))).mul(smoothstep(0.45, 0.75, vnoise(vec2(uu.mul(4.0), y.mul(6.0)))))
    wAlb.assign(mix(wAlb, c('#b9b2d6'), bloom.mul(0.4).mul(vertical)))
    const up = smoothstep(0.6, 0.9, N.y).mul(smoothstep(0.4, 0.65, vnoise(W.xz.mul(1.3))))
    wAlb.assign(mix(wAlb, c('#8f88c4'), up.mul(0.6)))
    albedo.assign(weathered.select(wAlb, albedo))

    // Lighting.
    const ambient = mix(c('#1a1d4a'), c('#7d74c4'), N.y.mul(0.5).add(0.5)).mul(ao)
    const wrap = max(dot(N, u.sunDir).add(0.3).div(1.3), 0.0)
    const rim = pow(max(float(1.0).sub(abs(dot(N, V.negate()))), 0.0), 3.0).mul(pow(max(dot(V, u.sunDir), 0.0), 3.0))
    const sunC = c('#f5c8d0')
    const lit = albedo.mul(ambient.add(sunC.mul(wrap).mul(0.45))).add(sunC.mul(rim).mul(0.3))
    const col = abs(k.sub(3.0)).lessThan(0.5).select(albedo.mul(ambient).mul(0.35), lit)
    return applyFog(col, dist, V)
  })()
  return m
}

let mats = null
function materials() {
  if (!mats) mats = { concrete: buildingMaterialGPU('concrete'), brick: buildingMaterialGPU('brick'), stone: buildingMaterialGPU('stone') }
  return mats
}

// Project tower windows: dim until hovered, bright when selected (Building animates
// userData.color).
function windowMaterialGPU() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: false })
  const col = DIM.clone()
  const uc = uniform(col)
  m.userData.color = col
  const share = uniform(0)
  m.userData.share = share
  const warm = attribute('aWarm', 'float')
  m.colorNode = Fn(() => {
    const toP = positionWorld.sub(cameraPosition)
    const dist = length(toP)
    // New look: some windows lit warm, more on visited towers (as scene/Ruins.jsx).
    return applyFog(max(uc, vec3(WARM.r, WARM.g, WARM.b).mul(step(warm, share))), dist, toP.div(dist))
  })()
  return m
}

export function RuinsGPU(props) {
  return <Ruins {...props} mats={materials()} makeWindow={windowMaterialGPU} />
}
