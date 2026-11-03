import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { tier } from '../quality'
import { seeded } from './ruins/noise3'
import { SUN_DIR, landDist, shared, shoreZ, spitHalfWidth, spitPoint } from './world'

// Spray flicked up where the swash breaks on the beach, shared by both renderers (a plain
// three.js material, which the WebGPU renderer converts itself; a few hundred instances
// animated on the CPU). Motes, pollen and birds were tried here and taken out: too busy.
const LOW = tier === 'low' || tier === 'minimal'
const COUNTS = { spray: LOW ? 90 : 260 }

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

export default function Life() {
  const parts = useMemo(() => {
    const rand = seeded(9157)
    window.__sprayAt = new URLSearchParams(window.location.search).get('sprayat')
    const tex = glowTexture()

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

    return { spray, sprayState, respawn, waterline, tex, get burst() { return burst }, set burst(v) { burst = v }, get burstLeft() { return burstLeft }, set burstLeft(v) { burstLeft = v } }
  }, [])

  useEffect(
    () => () => {
      parts.spray.geometry.dispose()
      parts.tex.dispose()
    },
    [parts],
  )

  useFrame(({ camera }, dt) => {
    const step = Math.min(dt, 0.1) * shared.uMotion.value
    const cq = camera.quaternion

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

  })

  return (
    <group>
      <primitive object={parts.spray} />
    </group>
  )
}
