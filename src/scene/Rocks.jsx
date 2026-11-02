import { useMemo } from 'react'
import * as THREE from 'three'
import { TOWERS } from './ruins/layout'
import { seeded } from './ruins/noise3'
import { rockGeometry, rockMaterial } from './ruins/rocks'
import { cobbleGeometry, pebbleGeometry, stoneMaterial } from './ruins/stones'
import { plateauTopAt } from './Plateau'
import { cullHidden } from './visibility'
import { bankX, shoreZ, spitHalfWidth, spitPoint } from './world'

// The headland: two large rock masses (shared with Ruins, which builds on top of them).
export const HEADLAND = [
  { seed: 1, position: [225, -6, -250], scale: [80, 30, 50], rotY: 0.3 },
  { seed: 2, position: [175, -8, -230], scale: [40, 22, 30], rotY: -0.6 },
]
let headlandCache = null
export function headlandMeshes() {
  if (!headlandCache) {
    const mat = rockMaterial()
    headlandCache = HEADLAND.map((h) => {
      const m = new THREE.Mesh(rockGeometry(h.seed, { detail: 5, flatTop: 0.7, terrace: 0.3, rough: 0.9, cliff: 0.4, faceted: false, fine: 0.12 }), mat)
      m.position.set(...h.position)
      m.scale.set(...h.scale)
      m.rotation.y = h.rotY
      m.updateMatrixWorld(true)
      return m
    })
  }
  return headlandCache
}

// Ground height on the headland at (x, z), or null if (x, z) isn't over it.
const ray = new THREE.Raycaster()
export function headlandTopAt(x, z) {
  ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0))
  const hit = ray.intersectObjects(headlandMeshes(), false)[0]
  return hit ? hit.point.y : null
}

// Sea stacks, placed clear of the sun and the project towers as seen from the field.
const STACKS = [
  [-40, -185, 6, 14, 6],
  [-85, -240, 9, 16, 8],
  [-150, -215, 5, 9, 5],
  [-25, -330, 10, 20, 9],
  [185, -215, 6, 10, 6],
  [205, -170, 4, 7, 4],
  [-60, -150, 3, 5, 3],
]

function placements() {
  const rand = seeded(4242)
  const list = [] // [x, y, z, sx, sy, sz, rotY, variant]
  for (const [x, z, sx, sy, sz] of STACKS) if (plateauTopAt(x, z) === null) list.push([x, -0.5, z, sx, sy, sz, rand() * 6.28, Math.floor(rand() * 3)])

  // Fallen boulders around the headland's foot.
  for (const h of HEADLAND) {
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2
      const s = 2 + rand() * 5
      list.push([h.position[0] + Math.cos(a) * h.scale[0] * 1.02, -0.4, h.position[2] + Math.sin(a) * h.scale[2] * 1.02, s * 1.3, s * (0.6 + rand() * 0.5), s, rand() * 6.28, 3 + Math.floor(rand() * 2)])
    }
  }

  // Rubble and fallen blocks around each tower base.
  for (const t of TOWERS) {
    const top = plateauTopAt(t.x, t.z)
    const n = 3 + Math.floor(rand() * 4)
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.max(t.w, t.d) * (0.55 + rand() * 0.5)
      const s = 0.8 + rand() * 2.2
      list.push([t.x + Math.cos(a) * r, top === null ? -0.3 : top - 0.2, t.z + Math.sin(a) * r, s * 1.3, s * (0.6 + rand() * 0.6), s, rand() * 6.28, 3 + Math.floor(rand() * 2)])
    }
  }

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

export default function Rocks() {
  const { headland, groups } = useMemo(() => {
    const variants = [
      rockGeometry(3, { detail: 4, flatTop: 0.7, terrace: 0.6, cliff: 0.75 }), // tall, layered stacks
      rockGeometry(4, { detail: 4, flatTop: 0.6, terrace: 0.55, cliff: 0.7 }),
      rockGeometry(5, { detail: 4, flatTop: 0.65, terrace: 0.5, cliff: 0.65 }),
      rockGeometry(6, { detail: 2, flatTop: 0.4, terrace: 0.2, rough: 1.3, cliff: 0.2 }), // boulders
      rockGeometry(7, { detail: 2, flatTop: 0.35, terrace: 0.15, rough: 1.4, cliff: 0.15 }),
    ]
    variants.push(pebbleGeometry(11), pebbleGeometry(12), cobbleGeometry(13), cobbleGeometry(14))
    const mat = rockMaterial()
    const stoneMat = stoneMaterial()
    const byVariant = variants.map(() => [])
    for (const p of placements()) byVariant[p[7]].push(p)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const groups = byVariant
      .map((list, v) => {
        if (!list.length) return null
        const mesh = new THREE.InstancedMesh(variants[v], v >= 5 ? stoneMat : mat, list.length)
        list.forEach(([x, y, z, sx, sy, sz, ry], i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry)
          m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
          mesh.setMatrixAt(i, m4)
        })
        mesh.computeBoundingSphere()
        return mesh
      })
      .filter(Boolean)
    // Display copies of the headland without faces no camera can see (the full meshes are
    // kept for raycasting building heights).
    const headland = headlandMeshes().map((src) => {
      const m = new THREE.Mesh(cullHidden(src.geometry, src.matrixWorld), src.material)
      m.position.copy(src.position)
      m.rotation.copy(src.rotation)
      m.scale.copy(src.scale)
      return m
    })
    return { headland, groups }
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
