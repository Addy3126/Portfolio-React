import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  float,
  faceDirection,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  sign,
  sin,
  smoothstep,
  varying,
  vec2,
  vec3,
} from 'three/tsl'
import { FIELD, TILE, bladeTemplate, buildTile, seeded } from '../scene/Grass'
import { color, palette, shared } from '../scene/world'
import { REFLECTION_HIDDEN } from './SeaGPU'
import { pianoShadow } from './shadow'
import { applyFog, spow, u, vnoise } from './tsl'

// The grass field on the WebGPU path: the same tiles, blades and shading as the WebGL
// grass (Bezier blades with wind, clumps, patches, edge-on widening, cursor parting,
// two LODs), with the shaders in TSL.
const c = (hex) => vec3(...color(hex).toArray())

// Contact darkening under the piano and bench (as the ground).
export const pianoContact = Fn(([xz]) => {
  const e = length(xz.sub(vec2(-1.45, 3.7)).div(vec2(1.45, 0.85)))
  const bench = length(xz.sub(vec2(-3.33, 3.7)).div(vec2(0.32, 0.55)))
  return float(1.0)
    .sub(float(1.0).sub(smoothstep(0.55, 1.35, e)).mul(0.45))
    .mul(float(1.0).sub(float(1.0).sub(smoothstep(0.6, 1.4, bench)).mul(0.3)))
})

function makeMaterial(hi) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false })
  const P = attribute('position', 'vec3')
  const iOffset = attribute('iOffset', 'vec3')
  const iParams = attribute('iParams', 'vec4')
  const iClump = attribute('iClump', 'vec2')
  const iPatch = attribute('iPatch', 'vec3')
  const iExtra = attribute('iExtra', 'vec2')

  const side = P.x
  const aT = P.y
  const part = P.z
  const rnd = iParams.w
  const wid = iParams.z
  const stiff = iExtra.x
  const kind = iExtra.y

  let yaw = iParams.x
  let hgt = iParams.y
  let base = iOffset
  let t = aT
  if (hi) {
    // Short blades fold into two blades from the same root; tall ones use both strips in a row.
    const fold = kind.lessThan(0.5).and(iParams.y.lessThan(0.33))
    const second = fold.and(part.greaterThan(0.5))
    yaw = second.select(iParams.x.add(2.4).add(rnd.mul(1.2)), iParams.x)
    base = iOffset.add(vec3(cos(yaw), 0, sin(yaw)).mul(second.select(0.035, 0.0)))
    hgt = second.select(iParams.y.mul(0.85), iParams.y)
    t = fold.select(aT, part.add(aT).mul(0.5))
  }

  const cy = cos(yaw)
  const sy = sin(yaw)
  const fwd = vec2(sy.negate(), cy)

  // Quadratic Bezier blade: root at the base, control point and tip leaning forward.
  const lean = kind.greaterThan(0.5).select(float(0.12), rnd.mul(0.5).add(0.25)).mul(float(1.3).sub(stiff.mul(0.6)))
  const p1a = vec3(fwd.x.mul(hgt).mul(sin(lean)).mul(0.25), hgt.mul(0.62), fwd.y.mul(hgt).mul(sin(lean)).mul(0.25))
  const p2a = vec3(fwd.x.mul(hgt).mul(sin(lean)), hgt.mul(cos(lean)), fwd.y.mul(hgt).mul(sin(lean)))

  // Wind pushes the tip (and a little of the control point); stiff blades resist.
  const time = u.time.mul(u.motion)
  const gust = vnoise(iOffset.xz.mul(0.07).add(vec2(time.mul(-0.22), time.mul(0.03))))
  const wave = sin(time.mul(1.05).sub(iOffset.x.mul(0.32)).add(iOffset.z.mul(0.18))).mul(0.5).add(0.5)
  const windAmt = float(0.1).add(gust.mul(gust).mul(0.55)).add(wave.mul(0.16)).mul(float(1.25).sub(stiff.mul(0.5)))
  const windDir = vec3(0.862, 0, -0.507)

  // Part around the cursor.
  const away = iOffset.xz.sub(u.cursor)
  const dc = length(away)
  const partAmt = u.cursorStrength.mul(float(1.0).sub(smoothstep(0.12, 0.9, dc)))
  const push = vec3(away.x, 0, away.y).div(max(dc, 1e-3))
  const p2 = p2a.add(windDir.mul(windAmt.mul(hgt))).add(push.mul(partAmt.mul(hgt).mul(1.15)))
  const p1 = p1a.add(windDir.mul(windAmt.mul(hgt).mul(0.35))).add(push.mul(partAmt.mul(hgt).mul(0.4)))

  // Keep blade length: bending lowers the tip instead of stretching the blade.
  const p2n = normalize(p2).mul(hgt)
  const omt = float(1.0).sub(t)
  const B = p1.mul(omt.mul(t).mul(2.0)).add(p2n.mul(t.mul(t)))
  const dB = p1.mul(omt.mul(2.0)).add(p2n.sub(p1).mul(t.mul(2.0)))

  // Turn and widen blades seen edge-on, so they don't thin to flickering lines.
  const vd = normalize(base.xz.sub(cameraPosition.xz).add(vec2(1e-4)))
  const axis0 = vec2(cy, sy)
  const edgeOn = abs(dot(axis0, vd))
  const perp0 = vec2(vd.y.negate(), vd.x)
  const perp = perp0.mul(sign(dot(axis0, perp0).add(1e-4)))
  const axis2 = normalize(mix(axis0, perp, edgeOn.mul(0.35)))
  const sideAxis = vec3(axis2.x, 0, axis2.y)

  const w = kind
    .greaterThan(0.5)
    .select(wid.mul(float(0.4).add(smoothstep(0.6, 0.82, t).mul(1.1))).mul(pow(max(omt, 0.0), 0.5)), wid.mul(pow(max(omt, 0.0), 0.85)))
    .mul(float(1.0).add(edgeOn.mul(edgeOn).mul(0.8)))

  m.positionNode = base.add(B).add(sideAxis.mul(side).mul(w))
  const n0 = normalize(cross(sideAxis, normalize(dB.add(vec3(0, 1e-4, 0)))))
  const vNormal = varying(normalize(n0.add(sideAxis.mul(side).mul(1.6))))
  const vT = varying(t)
  const vRand = varying(rnd)
  const vTone = varying(iClump.x)
  const vKind = varying(kind)
  const vPatch = varying(iPatch)

  const cBase = c(palette.grassBase)
  const cTip = c(palette.grassTip)
  const cFrost = c(palette.frost)
  const cSky = c('#9a92dc')
  const cGround = c('#1a1d4a')
  const cSun = c(palette.glow)
  const cBlue = c('#6f8cff')

  m.colorNode = Fn(() => {
    const tt = clamp(vT, 0.0, 1.0)
    const W = positionWorld
    const toP = W.sub(cameraPosition)
    const dist = length(toP)
    const V = toP.div(dist)
    const N = normalize(vNormal.add(vec3(0, 1e-5, 0))).mul(faceDirection)
    const L = u.sunDir

    // Albedo: base to tip, varied per clump and by large patches.
    const albedo = mix(cBase, cTip, smoothstep(0.0, 0.85, tt)).toVar()
    albedo.mulAssign(float(0.7).add(vTone.mul(0.45)).add(vRand.sub(0.5).mul(0.2)))
    albedo.assign(mix(albedo, albedo.mul(cBlue).mul(1.6), smoothstep(0.45, 0.8, vPatch.z).mul(0.5)))
    albedo.mulAssign(float(1.0).sub(smoothstep(0.5, 0.85, vPatch.y).mul(0.35)))
    // Seed stalks: darker stems, pale frosted heads.
    const head = vKind.mul(smoothstep(0.6, 0.72, tt))
    albedo.assign(mix(albedo.mul(float(1.0).sub(vKind.mul(0.35))), cFrost.mul(0.8), head))

    // Lighting: twilight sky, low sun wrapping around blades, light through blades.
    const sh = pianoShadow(W).toVar()
    const contact = pianoContact(W.xz)
    const ambient = mix(cGround, cSky, N.y.mul(0.5).add(0.5)).mul(mix(0.55, 1.0, sh)).mul(contact)
    const wrap = max(dot(N, L).add(0.5).div(1.5), 0.0).mul(sh)
    const through = spow(dot(V, L), 3.0).mul(tt.mul(0.65).add(0.35)).mul(mix(0.3, 1.0, sh))
    const H = normalize(L.sub(V))
    const spec = spow(dot(N, H), 12.0).mul(tt).mul(sh)

    const col = albedo
      .mul(ambient.add(cSun.mul(wrap).mul(0.45)))
      .add(albedo.mul(cSun).mul(through).mul(1.4))
      .add(cSun.mul(spec).mul(0.08))
      .toVar()

    // Frost on the upper blade, heavier in frosty patches.
    const frost = smoothstep(0.3, 0.95, tt)
      .mul(float(0.55).add(smoothstep(0.35, 0.7, vPatch.x).mul(0.45)))
      .mul(float(1.0).sub(vKind.mul(0.6)))
    const frostLit = cFrost.mul(float(0.5).add(ambient.mul(0.7)).add(cSun.mul(wrap.mul(0.3).add(through.mul(1.4)))))
    col.assign(mix(col, frostLit, frost.mul(0.8)))
    col.mulAssign(mix(0.62, 1.0, sh))

    // Ambient occlusion: dark at the roots.
    col.mulAssign(mix(0.22, 1.0, smoothstep(0.0, 0.55, tt)))

    // Far away, pull blades toward the field's average tone to stop shimmer.
    const calm = smoothstep(5.0, 16.0, dist)
    const avg = mix(cTip, cFrost, 0.55).mul(cSky.mul(0.9).add(cSun.mul(0.15)))
    col.assign(mix(col, avg, calm.mul(0.45)))

    // Blue spill from the piano.
    const pd = length(W.xz.sub(u.pianoPos.xz))
    col.addAssign(u.pianoGlow.mul(u.glowPulse).mul(tt.add(0.2)).mul(0.5).div(pd.mul(pd).mul(0.9).add(1.0)))
    return applyFog(col, dist, V)
  })()
  return m
}

export default function GrassGPU({ density = 140, hiDist = 10, loDist = 28 }) {
  const materials = useMemo(() => ({ hi: makeMaterial(true), lo: makeMaterial(false) }), [])
  const templates = useMemo(() => ({ hi: bladeTemplate(4, 2), lo: bladeTemplate(3, 1) }), [])

  const tiles = useMemo(() => {
    const rand = seeded(1234)
    const list = []
    for (let tx = Math.floor(FIELD.x0 / TILE); tx < Math.ceil(FIELD.x1 / TILE); tx++)
      for (let tz = Math.floor(FIELD.z0 / TILE); tz < Math.ceil(FIELD.z1 / TILE); tz++) {
        const tile = buildTile(tx, tz, density, rand)
        if (!tile) continue
        const sphere = new THREE.Sphere(tile.center, TILE * 0.75 + 1.2)
        const make = (tpl, mat) => {
          const g = new THREE.InstancedBufferGeometry()
          g.setAttribute('position', tpl.position)
          g.setIndex(tpl.index)
          for (const [k, a] of Object.entries(tile.attrs)) g.setAttribute(k, a)
          g.instanceCount = tile.count
          g.boundingSphere = sphere
          const m = new THREE.Mesh(g, mat)
          m.visible = false
          m.layers.set(REFLECTION_HIDDEN)
          return m
        }
        list.push({ center: tile.center, spit: tile.center.z < -12, hi: make(templates.hi, materials.hi), lo: make(templates.lo, materials.lo) })
      }
    return list
  }, [density, templates, materials])

  useEffect(
    () => () =>
      tiles.forEach((t) => {
        t.hi.geometry.dispose()
        t.lo.geometry.dispose()
      }),
    [tiles],
  )

  // Let the ground paint a grass carpet where blades stop.
  useEffect(() => {
    shared.uGrassFar.value = loDist
  }, [loDist])

  useFrame(({ camera }) => {
    for (const t of tiles) {
      const d = Math.hypot(t.center.x - camera.position.x, t.center.z - camera.position.z)
      t.hi.visible = d < hiDist
      t.lo.visible = d >= hiDist && (d < loDist || t.spit)
    }
  })

  const group = useRef()
  return (
    <group ref={group}>
      {tiles.map((t, i) => (
        <group key={i}>
          <primitive object={t.hi} />
          <primitive object={t.lo} />
        </group>
      ))}
    </group>
  )
}
