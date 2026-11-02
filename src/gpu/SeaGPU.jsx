import { useEffect, useMemo } from 'react'
import * as THREE from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  reflector,
  smoothstep,
  varying,
  vec2,
  vec3,
} from 'three/tsl'
import { color, palette } from '../scene/world'
import { applyFog, foamShadeAt, landDist, seabedY, spow, swash, u, viewNormal, vnoise } from './tsl'

// Sea, as the WebGL sea: swell in the vertex stage, short waves and ripples as normals,
// Beer-Lambert water colour over the sloping seabed, crest scattering toward the sun, sun
// glitter, the shared shore foam, and a distorted planar reflection.
const SEA_LEVEL = -0.04
const c = (hex) => vec3(...color(hex).toArray())
// The live sea mesh and its non-reflective material, swapped in while the piano captures
// its surroundings (a reflection pass nested inside a cube capture breaks the reflector).
export const seaSwap = { mesh: null, plain: null }
export const REFLECTION_HIDDEN = 2 // layer for objects the reflection skips (grass, flowers)

// One travelling sine wave (deep-water dispersion): returns (height, d/dx, d/dz) * amp.
function wave(p, dir, len, amp, t) {
  const k = (Math.PI * 2) / len
  const ph = dot(vec2(...dir), p).mul(k).sub(t.mul(Math.sqrt(9.8 * k)))
  return { h: ph.sin().mul(amp), slope: vec2(...dir).mul(ph.cos().mul(amp * k)) }
}
const swellFn = Fn(([p, t]) => {
  const a = wave(p, [0.15, 0.989], 18, 0.05, t)
  const b = wave(p, [-0.45, 0.893], 27, 0.035, t)
  const c2 = wave(p, [0.6, 0.8], 11, 0.018, t)
  return vec3(a.h.add(b.h).add(c2.h), a.slope.add(b.slope).add(c2.slope))
})
const waveSlope = (p, dir, len, amp, t) => {
  const k = (Math.PI * 2) / len
  return vec2(...dir).mul(cos(dot(vec2(...dir), p).mul(k).sub(t.mul(Math.sqrt(9.8 * k)))).mul(amp))
}

function seaGeometry(cols = 220, rows = 200) {
  const pos = []
  const index = []
  for (let j = 0; j <= rows; j++) {
    const z = -5 - 1400 * Math.pow(j / rows, 2.2)
    for (let i = 0; i <= cols; i++) {
      const s = (i / cols) * 2 - 1
      pos.push(Math.sign(s) * 1700 * Math.pow(Math.abs(s), 1.8), 0, z)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i
      const c3 = a + cols + 1
      index.push(a, c3, a + 1, a + 1, c3, c3 + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

// The sea material; refl is the planar reflection node, or null for the sky-colour
// reflection used when reflections are off (and during the piano's cube capture).
function seaMaterial(refl) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false })
  const t = u.time.mul(u.motion)

  // Vertex: swell, smaller in the shallows so the waterline creeps rather than jumps.
  const p0 = positionLocal.xz
  const depth0 = float(SEA_LEVEL).sub(seabedY(p0))
  const damp = mix(0.25, 1.0, smoothstep(0.0, 0.5, depth0))
  const s = swellFn(p0, t).mul(damp)
  m.positionNode = positionLocal.add(vec3(0, s.x, 0))
  const swellSlope = varying(s.yz)
  m.normalNode = viewNormal(vec3(0, 1, 0))

  m.colorNode = Fn(() => {
    const W = positionWorld
    const toP = W.sub(cameraPosition)
    const dist = length(toP)
    const V = toP.div(dist)
    const p = W.xz

    const L = landDist(p)
    // Never draw water over land (the ground undulates around the sea level).
    If(L.greaterThan(0.15), () => Discard())

    const near = float(1.0).sub(smoothstep(25.0, 260.0, dist))
    const midF = float(1.0).sub(smoothstep(80.0, 600.0, dist))
    const g = swellSlope.toVar()
    g.addAssign(waveSlope(p, [0.958, 0.287], 11, 0.05, t).mul(midF))
    g.addAssign(waveSlope(p, [-0.514, 0.857], 6.3, 0.045, t).mul(midF))
    g.addAssign(waveSlope(p, [0.196, -0.981], 3.4, 0.035, t).mul(near))
    g.addAssign(waveSlope(p, [0.914, -0.406], 1.9, 0.03, t).mul(near))
    const r1 = vec2(vnoise(p.mul(1.3).sub(t.mul(0.25))), vnoise(p.mul(1.3).add(9.0).add(t.mul(0.2)))).sub(0.5)
    const r2 = vec2(vnoise(p.mul(4.5).add(t.mul(0.6))), vnoise(p.mul(4.5).sub(4.0).sub(t.mul(0.5)))).sub(0.5)
    g.addAssign(r1.mul(0.09).mul(near).add(r2.mul(0.06).mul(near)))
    const close = float(1.0).sub(smoothstep(4.0, 16.0, dist))
    g.addAssign(vec2(vnoise(p.mul(11.0).add(t.mul(1.1))), vnoise(p.mul(11.0).sub(3.0).sub(t.mul(0.9)))).sub(0.5).mul(0.06).mul(close))
    g.addAssign(vec2(vnoise(p.mul(0.12).add(t.mul(0.03))), vnoise(p.mul(0.12).add(5.0))).sub(0.5).mul(0.04))
    const n = normalize(vec3(g.x.negate(), 1.0, g.y.negate()))

    const cosT = clamp(dot(V.negate(), n), 0.0, 1.0)
    const fresnel = float(0.02).add(spow(float(1.0).sub(cosT), 5.0).mul(0.98))

    let reflCol
    if (refl) {
      refl.uvNode = refl.uvNode.add(n.xz.mul(0.05).mul(near.mul(0.7).add(0.3)))
      reflCol = refl.rgb
    } else {
      reflCol = mix(c('#5a4f9e'), c(palette.glow), spow(dot(reflect(V, n), u.sunDir), 10.0))
    }

    // Water body by Beer-Lambert absorption over the shelving seabed.
    const offshore = max(L.negate(), 0.0)
    const path = offshore.mul(0.55).div(max(cosT, 0.25))
    const trans = exp(vec3(0.55, 0.22, 0.1).negate().mul(path))
    const sandSeen = c('#5d5aa6').mul(float(0.8).add(vnoise(p.mul(3.0).add(n.xz.mul(4.0))).mul(0.3)))
    const deepCol = mix(c('#1c2386'), c(palette.seaFar), smoothstep(120.0, 600.0, dist))
    const body = sandSeen
      .mul(trans)
      .add(deepCol.mul(vec3(1.0).sub(trans)))
      .add(c('#4a62d4').mul(0.25).mul(trans.b).mul(float(1.0).sub(trans.r)))
    const reflAmt = clamp(fresnel.mul(1.15).add(0.08), 0.0, 1.0).mul(float(1.0).sub(trans.g.mul(0.5)))
    const col = mix(body, reflCol, reflAmt).toVar()

    // Light through the wave crests when looking toward the low sun.
    const crest = max(W.y.add(0.04), 0.0)
    const towardSun = spow(dot(V, u.sunDir), 3.0)
    col.addAssign(c('#8f7cf0').mul(crest.mul(9.0)).mul(towardSun).mul(float(1.0).sub(fresnel)).mul(float(1.0).sub(smoothstep(60.0, 300.0, dist))))

    // Sun glitter: sharp highlights nearby, a broader streak in the distance.
    const sd = max(dot(reflect(V, n), u.sunDir), 0.0)
    const farF = smoothstep(6.0, 400.0, dist)
    col.addAssign(vec3(5.0, 4.6, 4.4).mul(spow(sd, mix(2600.0, 260.0, farF))).mul(mix(1.0, 0.45, farF)))
    col.addAssign(c(palette.glow).mul(spow(sd, 60.0)).mul(0.18))

    // Shore swash foam (shared with the ground so they meet seamlessly).
    const sw = swash(p, L, t)
    col.assign(mix(col, foamShadeAt(c('#e4dcff'), V, p, sw.y), sw.y.mul(0.92)))
    return applyFog(col, dist, V)
  })()
  return m
}

// reflectAll: grass and flowers appear in the reflection too (higher tiers).
export default function SeaGPU({ reflection = 0, reflectAll = false }) {
  const { mesh, refl } = useMemo(() => {
    const refl = reflection > 0 ? reflector({ resolutionScale: reflection, bounces: false }) : null

    const m = seaMaterial(refl)
    const plain = refl ? seaMaterial(null) : m
    const mesh = new THREE.Mesh(seaGeometry(), m)
    mesh.position.y = SEA_LEVEL
    mesh.frustumCulled = false
    if (refl) {
      // The reflector's plane: facing up at sea level.
      refl.target.rotation.x = -Math.PI / 2
      mesh.add(refl.target)
      // Skip grass and flowers in the mirrored view: they sit on a layer the reflection
      // camera (a clone of the main camera, made on first use) has switched off.
      const base = refl.reflector ?? refl._reflectorBaseNode
      const get = base.getVirtualCamera.bind(base)
      base.getVirtualCamera = (cam) => {
        const v = get(cam)
        if (reflectAll) v.layers.enable(REFLECTION_HIDDEN)
        else v.layers.disable(REFLECTION_HIDDEN)
        return v
      }
    }
    seaSwap.mesh = mesh
    seaSwap.plain = plain
    return { mesh, refl }
  }, [reflection, reflectAll])

  useEffect(() => () => mesh.material.dispose(), [mesh])
  return <primitive object={mesh} />
}
