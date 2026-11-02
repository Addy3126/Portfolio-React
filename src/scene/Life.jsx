import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { tier } from '../quality'
import { seeded } from './ruins/noise3'
import { PIANO_CENTRE, SUN_DIR, landDist, shared, shoreZ, spitHalfWidth, spitPoint } from './world'

// Small signs of life, shared by both renderers (plain three.js materials, which the WebGPU
// renderer converts itself; a few hundred instances animated on the CPU):
// - glowing motes hovering round the piano
// - pollen drifting downwind over the field
// - spray flicked up where the swash breaks on the beach
// - a few birds wheeling far out over the sea
const LOW = tier === 'low' || tier === 'minimal'
const COUNTS = { motes: LOW ? 40 : 110, pollen: LOW ? 120 : 420, spray: LOW ? 90 : 260, birds: 9 }

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function sprites(count, tex, color) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true })
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count)
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  return mesh
}

const m4 = new THREE.Matrix4()
const pos = new THREE.Vector3()
const scl = new THREE.Vector3()
const q = new THREE.Quaternion()
const WIND = new THREE.Vector3(0.862, 0, -0.507)

export default function Life() {
  const parts = useMemo(() => {
    const rand = seeded(9157)
    window.__sprayAt = new URLSearchParams(window.location.search).get('sprayat')
    const tex = glowTexture()

    const motes = sprites(COUNTS.motes, tex, new THREE.Color(0.55, 0.75, 1.6))
    const moteSeeds = Array.from({ length: COUNTS.motes }, () => ({
      r: 0.6 + rand() * 2.6,
      a: rand() * Math.PI * 2,
      y: 0.15 + rand() * 1.5,
      sp: 0.08 + rand() * 0.18,
      ph: rand() * 100,
      size: 0.025 + rand() * 0.04,
    }))

    const pollen = sprites(COUNTS.pollen, tex, new THREE.Color(1.0, 0.86, 0.9))
    // Pollen lives in a box over the field in front of the cameras and wraps around it.
    const P0 = new THREE.Vector3(-14, 0.08, -16)
    const PS = new THREE.Vector3(34, 2.6, 26)
    const pollenSeeds = Array.from({ length: COUNTS.pollen }, () => ({
      p: new THREE.Vector3(rand(), Math.pow(rand(), 1.6), rand()),
      sp: 0.25 + rand() * 0.5,
      ph: rand() * 100,
      size: 0.006 + rand() * 0.008,
    }))

    // Spray: short ballistic arcs from points on the waterline, in bursts.
    const spray = sprites(COUNTS.spray, tex, new THREE.Color(0.85, 0.82, 1.1))
    const waterline = () => {
      if (window.__sprayAt) return new THREE.Vector3(...window.__sprayAt.split(',').map(Number)) // debug: ?sprayat=x,y,z
      if (rand() < 0.7) {
        const x = -18 + rand() * 30
        return new THREE.Vector3(x, 0.02, shoreZ(x) - 0.4)
      }
      const t = rand() * 0.95
      const [cx, cz] = spitPoint(t)
      const side = rand() < 0.5 ? -1 : 1
      const w = spitHalfWidth(t)
      let x = cx + side * w
      let z = cz
      // Walk outward to the actual waterline.
      for (let i = 0; i < 12 && landDist(x, z) > -0.3; i++) x += side * 0.5
      return new THREE.Vector3(x, 0.02, z)
    }
    const sprayState = Array.from({ length: COUNTS.spray }, () => ({ alive: false, wait: rand() * 2, t: 0, life: 1, o: new THREE.Vector3(), v: new THREE.Vector3(), size: 0.02 }))
    const respawn = (s, burstAt) => {
      s.o.copy(burstAt).add(new THREE.Vector3((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6))
      s.v.set((rand() - 0.5) * 0.5, 0.7 + rand() * 1.1, (rand() - 0.5) * 0.5).addScaledVector(SUN_DIR, -0.3)
      s.life = 0.7 + rand() * 0.7
      s.size = 0.035 + rand() * 0.05
      s.t = 0
    }
    let burst = waterline()
    let burstLeft = 0

    // Birds: a body and two wings per bird, wings flapping about the body axis.
    const wingGeo = new THREE.BufferGeometry()
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.18, 1, 0.05, -0.05], 3))
    wingGeo.computeVertexNormals()
    const birdMat = new THREE.MeshBasicMaterial({ color: '#1b1736', side: THREE.DoubleSide })
    const wingsL = new THREE.InstancedMesh(wingGeo, birdMat, COUNTS.birds)
    const wingsR = new THREE.InstancedMesh(wingGeo, birdMat, COUNTS.birds)
    for (const w of [wingsL, wingsR]) {
      w.frustumCulled = false
      w.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }
    const birds = Array.from({ length: COUNTS.birds }, (_, i) => ({
      off: new THREE.Vector3((rand() - 0.5) * 22, (rand() - 0.5) * 5, (rand() - 0.5) * 14),
      ph: rand() * 10,
      flap: 5 + rand() * 2,
      span: 1.0 + rand() * 0.35,
      i,
    }))

    return { motes, moteSeeds, pollen, pollenSeeds, P0, PS, spray, sprayState, respawn, waterline, wingsL, wingsR, birds, birdMat, tex, get burst() { return burst }, set burst(v) { burst = v }, get burstLeft() { return burstLeft }, set burstLeft(v) { burstLeft = v } }
  }, [])

  useEffect(
    () => () => {
      for (const m of [parts.motes, parts.pollen, parts.spray, parts.wingsL, parts.wingsR]) m.geometry.dispose()
      parts.tex.dispose()
    },
    [parts],
  )

  useFrame(({ camera, clock }, dt) => {
    const t = clock.elapsedTime * shared.uMotion.value
    const step = Math.min(dt, 0.1) * shared.uMotion.value
    const cq = camera.quaternion

    // Motes: slow orbits round the piano, bobbing, softly pulsing in size.
    parts.moteSeeds.forEach((s, i) => {
      const a = s.a + t * s.sp
      pos.set(PIANO_CENTRE.x + Math.cos(a) * s.r * 1.3, s.y + Math.sin(t * 0.7 + s.ph) * 0.18, PIANO_CENTRE.z + Math.sin(a) * s.r)
      const k = s.size * (0.75 + 0.25 * Math.sin(t * 2.3 + s.ph)) * shared.uGlowPulse.value
      m4.compose(pos, cq, scl.set(k, k, k))
      parts.motes.setMatrixAt(i, m4)
    })
    parts.motes.instanceMatrix.needsUpdate = true

    // Pollen: drifts downwind, wobbling, wrapping round its box.
    const { P0, PS } = parts
    parts.pollenSeeds.forEach((s, i) => {
      const p = s.p
      const fx = (p.x + (WIND.x * t * s.sp * 0.6) / PS.x) % 1
      const fz = (((p.z + (WIND.z * t * s.sp * 0.6) / PS.z) % 1) + 1) % 1
      pos.set(P0.x + fx * PS.x + Math.sin(t * 0.9 + s.ph) * 0.3, P0.y + p.y * PS.y + Math.sin(t * 0.6 + s.ph * 2) * 0.15, P0.z + fz * PS.z + Math.cos(t * 0.8 + s.ph) * 0.3)
      m4.compose(pos, cq, scl.set(s.size, s.size, s.size))
      parts.pollen.setMatrixAt(i, m4)
    })
    parts.pollen.instanceMatrix.needsUpdate = true

    // Spray: bursts of droplets at one spot on the waterline, then the next spot.
    for (let i = 0; i < parts.sprayState.length; i++) {
      const s = parts.sprayState[i]
      if (!s.alive) {
        s.wait -= step
        if (s.wait <= 0 && parts.burstLeft > 0) {
          parts.respawn(s, parts.burst)
          parts.burstLeft--
          s.alive = true
        } else {
          m4.makeScale(0, 0, 0)
          parts.spray.setMatrixAt(i, m4)
          continue
        }
      }
      s.t += step
      if (s.t >= s.life) {
        s.alive = false
        s.wait = 0.05 + (i % 9) * 0.04
        m4.makeScale(0, 0, 0)
        parts.spray.setMatrixAt(i, m4)
        continue
      }
      pos.copy(s.o).addScaledVector(s.v, s.t)
      pos.y -= 4.9 * s.t * s.t * 0.6
      const k = s.size * Math.sin((s.t / s.life) * Math.PI)
      m4.compose(pos, cq, scl.set(k, k, k))
      parts.spray.setMatrixAt(i, m4)
    }
    if (parts.burstLeft <= 0 && Math.random() < step * 2.5) {
      parts.burst = parts.waterline()
      parts.burstLeft = 30 + Math.floor(Math.random() * 30)
    }
    parts.spray.instanceMatrix.needsUpdate = true

    // Birds: a loose flock wheeling far out over the sea, flapping with short glides.
    const cx = 22 + Math.cos(t * 0.04) * 55
    const cz = -105 + Math.sin(t * 0.04) * 22
    const heading = Math.atan2(Math.cos(t * 0.04) * 22, -Math.sin(t * 0.04) * 55)
    for (const b of parts.birds) {
      pos.set(cx + b.off.x + Math.sin(t * 0.2 + b.ph) * 3, 20 + b.off.y + Math.sin(t * 0.35 + b.ph) * 1.5, cz + b.off.z)
      const glide = Math.sin(t * 0.25 + b.ph) > 0.55
      const flap = glide ? 0.12 : Math.sin(t * b.flap + b.ph) * 0.55
      for (const [mesh, side] of [
        [parts.wingsL, -1],
        [parts.wingsR, 1],
      ]) {
        q.setFromEuler(new THREE.Euler(0, heading, side * flap, 'YXZ'))
        m4.compose(pos, q, scl.set(side * b.span * 2.4, 2.4, 2.4))
        mesh.setMatrixAt(b.i, m4)
      }
    }
    parts.wingsL.instanceMatrix.needsUpdate = true
    parts.wingsR.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <primitive object={parts.motes} />
      <primitive object={parts.pollen} />
      <primitive object={parts.spray} />
      <primitive object={parts.wingsL} />
      <primitive object={parts.wingsR} />
    </group>
  )
}
