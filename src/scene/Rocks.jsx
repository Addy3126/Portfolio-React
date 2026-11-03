import { useMemo } from 'react'
import * as THREE from 'three'
import { seeded } from './ruins/noise3'
import { rockMaterial } from './ruins/rocks'
import { cobbleGeometry, pebbleGeometry, stoneMaterial } from './ruins/stones'
import { BEACH_LAYER } from './BeachShadow'
import { bankX, shoreZ, spitHalfWidth, spitPoint } from './world'

function placements() {
  const rand = seeded(4242)
  const list = [] // [x, y, z, sx, sy, sz, rotY, variant]

  // Beach stones (variants 5-6 = pebble shapes, 7-8 = cobbles): rest on the sand, partly
  // sunk in. [x, y, z, sx, sy, sz, rotY, variant]
  const stone = (x, z, size) => {
    const peb = size < 0.16
    const v = peb ? 5 + Math.floor(rand() * 2) : 7 + Math.floor(rand() * 2)
    const sy = size * (peb ? 1 : 0.85 + rand() * 0.3)
    list.push([x, -0.03 + sy * (peb ? 0.14 : 0.2), z, size * (1.1 + rand() * 0.5), sy, size * (0.8 + rand() * 0.4), rand() * 6.28, v])
  }
  // Pebbles and small stones over the spit, a little denser toward its end.
  for (let i = 0; i < 220; i++) {
    const t = Math.pow(rand(), 0.7)
    const [cx, cz] = spitPoint(t)
    const side = rand() < 0.5 ? -1 : 1
    const off = spitHalfWidth(t) * rand() * 1.05
    stone(cx + side * off * 0.9, cz + side * off * 0.3, 0.035 + rand() * rand() * (0.14 + t * 0.14))
  }
  {
    const [ex, ez] = spitPoint(1)
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2
      const r = rand() * 4
      stone(ex + Math.cos(a) * r, ez + Math.sin(a) * r, 0.05 + rand() * rand() * 0.4)
    }
  }
  // Along the main beach (mostly in the swash zone) and the channel bank.
  for (let i = 0; i < 70; i++) {
    const x = -20 + rand() * 32
    const z = shoreZ(x) - 0.8 + rand() * 2.0
    stone(x, z, 0.04 + rand() * rand() * 0.55)
  }
  for (let i = 0; i < 16; i++) {
    const z = -14 + rand() * 24
    stone(bankX(z) - 0.6 + rand() * 1.4, z, 0.05 + rand() * rand() * 0.45)
  }
  return list
}

// Instanced beach stones by variant (shared with the WebGPU path, which passes its own
// materials). Each mesh gets an iInfo attribute: per-instance seed and scale.
export function rockGroups(mat, stoneMat) {
  const variants = [
    // Variants 0-4 were code-generated rocks, now replaced by scans (ScannedRocks.jsx);
    // the indices are kept for the stone placements below.
    null,
    null,
    null,
    null,
    null,
  ]
  variants.push(pebbleGeometry(11), pebbleGeometry(12), cobbleGeometry(13), cobbleGeometry(14))
  const byVariant = variants.map(() => [])
  for (const p of placements()) byVariant[p[7]].push(p)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  return byVariant
    .map((list, v) => {
      if (!list.length) return null
      const mesh = new THREE.InstancedMesh(variants[v], v >= 5 ? stoneMat : mat, list.length)
      const info = new Float32Array(list.length * 4)
      list.forEach(([x, y, z, sx, sy, sz, ry], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry)
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
        mesh.setMatrixAt(i, m4)
        const seed = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
        info.set([seed - Math.floor(seed), sx, sy, sz], i * 4)
      })
      mesh.geometry.setAttribute('iInfo', new THREE.InstancedBufferAttribute(info, 4))
      mesh.computeBoundingSphere()
      mesh.layers.enable(BEACH_LAYER) // casts into the baked beach shadows
      return mesh
    })
    .filter(Boolean)
}

export default function Rocks() {
  const groups = useMemo(() => rockGroups(rockMaterial(), stoneMaterial()), [])

  return (
    <group>
      {groups.map((m, i) => (
        <primitive key={`r${i}`} object={m} />
      ))}
    </group>
  )
}
