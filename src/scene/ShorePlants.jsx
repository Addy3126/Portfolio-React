import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { tier } from '../quality'
import { BEACH_LAYER } from './BeachShadow'
import { seeded } from './ruins/noise3'
import { PIANO_POS, bankX, landDist, mainDist, shoreZ } from './world'

// Plants on the strip where the beach meets the field: stiff tufts of dune grass and
// cushions of sea thrift with pink pompom flowers on wiry stems, in loose clusters, so
// the sand doesn't simply stop at a line of lawn. Shared by both renderers (standard
// materials); they also cast into the baked beach shadows.
const LOW = tier === 'low' || tier === 'minimal'
const CLUSTERS = LOW ? 26 : 48

// One tuft: thin tapered blades arching outward from a common root, vertex-coloured dark
// at the base to pale at the tip. Height 1 (scaled per instance).
function tuftGeometry(rand, blades = 26, segs = 4) {
  const pos = []
  const col = []
  const idx = []
  const base = new THREE.Color('#2e3856')
  const tip = new THREE.Color('#c3c9e4')
  for (let b = 0; b < blades; b++) {
    const yaw = rand() * Math.PI * 2
    const lean = 0.1 + rand() * 0.75
    const h = 0.65 + rand() * 0.35
    const w = 0.02 + rand() * 0.012
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw))
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
    const start = pos.length / 3
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const c = new THREE.Vector3().addScaledVector(dir, Math.sin(lean) * t * t * h * 0.6 + 0.01).setY(t * h * Math.cos(lean * t))
      const half = w * (1 - t * 0.92)
      for (const s of [-1, 1]) {
        const p = c.clone().addScaledVector(side, s * half)
        pos.push(p.x, p.y, p.z)
        const k = base.clone().lerp(tip, Math.pow(t, 0.8))
        col.push(k.r, k.g, k.b)
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = start + i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// Is (x, z) on the beach-to-field strip, and clear of the piano and camera spots?
function onStrip(x, z) {
  const ld = landDist(x, z)
  if (ld < 2.0 || ld > 4.8) return false
  if (mainDist(x, z) < -1.5) return false // the spit is bare sand and pebbles
  if (Math.abs(x - PIANO_POS.x) < 4 && Math.abs(z - PIANO_POS.z) < 3) return false
  if (Math.hypot(x, z - 9) < 2.5 || Math.hypot(x + 1.5, z - 10.8) < 2.5) return false
  return true
}

function strip(rand) {
  // Candidate points along the beach and the channel bank.
  if (rand() < 0.78) {
    const x = -21 + rand() * 38
    return [x, shoreZ(x) + 2.0 + rand() * 2.8]
  }
  const z = -12 + rand() * 22
  return [bankX(z) + 2.0 + rand() * 2.8, z]
}

export default function ShorePlants() {
  const meshes = useMemo(() => {
    const rand = seeded(5150)
    const tuft = tuftGeometry(rand)
    const cushion = tuftGeometry(rand, 40, 2)
    const stem = new THREE.CylinderGeometry(0.0022, 0.003, 1, 4, 1, true).translate(0, 0.5, 0)
    const head = new THREE.IcosahedronGeometry(0.03, 1)

    const tufts = []
    const cushions = []
    const stems = []
    const heads = []
    let made = 0
    for (let tries = 0; made < CLUSTERS && tries < CLUSTERS * 40; tries++) {
      const [cx, cz] = strip(rand)
      if (!onStrip(cx, cz)) continue
      made++
      const thrift = rand() < 0.4
      const n = thrift ? 2 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 6)
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * 1.2
        const z = cz + (rand() - 0.5) * 0.9
        if (!onStrip(x, z)) continue
        if (!thrift) {
          const s = 0.38 + rand() * 0.3
          tufts.push([x, z, rand() * 6.28, s * (0.8 + rand() * 0.4), s])
        } else {
          const s = 0.1 + rand() * 0.06
          cushions.push([x, z, rand() * 6.28, s * 1.6, s])
          const k = 5 + Math.floor(rand() * 6)
          for (let j = 0; j < k; j++) {
            const a = rand() * Math.PI * 2
            const r = rand() * 0.07
            const h = 0.13 + rand() * 0.12
            const lx = x + Math.cos(a) * r
            const lz = z + Math.sin(a) * r
            const tilt = (rand() - 0.5) * 0.4
            stems.push([lx, lz, a, tilt, h])
            heads.push([lx + Math.sin(tilt) * h * Math.cos(a), lz + Math.sin(tilt) * h * Math.sin(a), h * Math.cos(tilt), 0.8 + rand() * 0.5])
          }
        }
      }
    }

    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const inst = (geo, mat, list, fill) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
      mesh.count = list.length
      list.forEach((it, i) => {
        fill(it)
        mesh.setMatrixAt(i, m4)
      })
      mesh.computeBoundingSphere()
      mesh.layers.enable(BEACH_LAYER)
      return mesh
    }
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })
    const thriftLeaf = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#7c9a8e', roughness: 0.9, side: THREE.DoubleSide })
    const stemMat = new THREE.MeshStandardMaterial({ color: '#4d5868', roughness: 0.8 })
    const headMat = new THREE.MeshStandardMaterial({ color: '#d9a2c8', emissive: '#2c1230', roughness: 0.7 })
    return [
      inst(tuft, leafMat, tufts, ([x, z, ry, sy, sxz]) => m4.compose(new THREE.Vector3(x, -0.02, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sxz, sy, sxz))),
      inst(cushion, thriftLeaf, cushions, ([x, z, ry, sxz, sy]) => m4.compose(new THREE.Vector3(x, -0.01, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sxz, sy, sxz))),
      inst(stem, stemMat, stems, ([x, z, a, tilt, h]) => m4.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(e.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)), new THREE.Vector3(1, h, 1))),
      inst(head, headMat, heads, ([x, z, y, s]) => m4.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(s, s * 0.9, s))),
    ]
  }, [])

  useEffect(
    () => () =>
      meshes.forEach((m) => {
        m.geometry.dispose()
        m.material.dispose()
      }),
    [meshes],
  )

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}
