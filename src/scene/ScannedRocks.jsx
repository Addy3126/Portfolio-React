import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { BEACH_LAYER } from './BeachShadow'
import { TOWERS } from './ruins/layout'
import { seeded } from './ruins/noise3'
import { loadScan } from './scans'
import { shoreZ, spitPoint } from './world'

// All the large rocks are photo-scanned models (Poly Haven's coastal "Smuggler's Cove" set
// and boulder_01), simplified by tools/simplify-scans.mjs. Shared by both renderers.
//
// Placement entries: [scan, x, z, horizontal scale, vertical scale, rotation Y, base y]
// (scale 1 = the scan's real size; base y = where the scan's lowest point sits).

// The headland under the right-hand ruins: sea cliffs set side by side, raised a little so
// they stand out of the water as a solid mass the old buildings sit on. The scans are open
// shells (cliff face and top only), so they must face the cameras (rotation as given).
export const HEADLAND_SCANS = [
  ['coastal_cliff_04', 215, -252, 1.05, 1.9, 0.25, -4],
  ['coastal_cliff_01', 236, -278, 1.0, 2.3, 0.35, -4],
  ['coastal_cliff_02', 170, -233, 1.0, 1.6, -0.5, -4],
]

function placements() {
  const rand = seeded(4242)
  const list = []
  // Fallen rocks along the foot of the cliffs.
  for (const [, x, z] of HEADLAND_SCANS) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.55 + rand() * Math.PI * 0.9 // the seaward (camera) side
      const r = 18 + rand() * 22
      const big = rand() < 0.4
      list.push([big ? 'coast_land_rocks_03' : 'coast_rocks_05', x + Math.cos(a) * r, z + Math.sin(a) * r * 0.5, big ? 0.9 + rand() * 0.6 : 0.8 + rand() * 0.8, big ? 1.2 + rand() * 0.8 : 1 + rand() * 0.8, rand() * 6.28, -1.2])
    }
  }
  // Rubble round each tower base in the sea.
  for (const t of TOWERS) {
    const n = 2 + Math.floor(rand() * 3)
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.max(t.w, t.d) * (0.6 + rand() * 0.45)
      list.push(['coast_rocks_05', t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, 0.35 + rand() * 0.5, 0.6 + rand() * 0.6, rand() * 6.28, -0.6])
    }
  }
  // The spit's rocky end: a low shelf of shore rock running into the sea.
  const [ex, ez] = spitPoint(1)
  list.push(['coast_rocks_03', ex + 1.5, ez - 5, 0.32, 0.55, 0.7, -0.9])
  // Boulders where the cameras come close: along the beach and out on the spit.
  const [s1x, s1z] = spitPoint(0.62)
  const [s2x, s2z] = spitPoint(0.86)
  for (const [x, z, s, ry] of [
    [-9.5, shoreZ(-9.5) - 0.6, 1.3, 0.4],
    [9.2, shoreZ(9.2) - 0.9, 1.1, 2.1],
    [-15.5, shoreZ(-15.5) - 1.6, 1.8, 4.0],
    [s1x + 5.5, s1z + 1.0, 1.4, 1.1],
    [s2x - 4.5, s2z - 0.5, 1.15, 5.2],
    [s2x + 3.2, s2z - 2.4, 1.6, 3.3],
  ])
    list.push(['boulder_01', x, z, s, s * (0.75 + (ry % 1) * 0.3), ry, -0.25 * s])
  return list
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
// Matrix for a placement, given the scan's bounding box (its lowest point lands on base y,
// its footprint centre on x, z).
function placeMatrix(box, [, x, z, sh, sv, ry, baseY]) {
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const local = new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz)
  q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry)
  return m4.compose(new THREE.Vector3(x, baseY, z), q, new THREE.Vector3(sh, sv, sh)).multiply(local)
}

// The headland meshes, for Ruins to raycast the ground height of the buildings on top.
let headlandPromise = null
export function headlandMeshes() {
  headlandPromise ??= Promise.all(
    HEADLAND_SCANS.map(async (p) => {
      const { geometry, material } = await loadScan(p[0])
      const mesh = new THREE.Mesh(geometry, material)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(placeMatrix(geometry.boundingBox, p))
      mesh.matrixWorld.copy(mesh.matrix)
      return mesh
    }),
  )
  return headlandPromise
}
const ray = new THREE.Raycaster()
export async function headlandTopFn() {
  const meshes = await headlandMeshes()
  return (x, z) => {
    ray.set(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, -1, 0))
    const hit = ray.intersectObjects(meshes, false)[0]
    return hit ? hit.point.y : null
  }
}

export default function ScannedRocks() {
  const [objects, setObjects] = useState(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const headland = await headlandMeshes()
      const list = placements()
      const names = [...new Set(list.map((p) => p[0]))]
      const groups = await Promise.all(
        names.map(async (name) => {
          const { geometry, material } = await loadScan(name)
          const items = list.filter((p) => p[0] === name)
          const mesh = new THREE.InstancedMesh(geometry, material, items.length)
          items.forEach((p, i) => mesh.setMatrixAt(i, placeMatrix(geometry.boundingBox, p)))
          mesh.computeBoundingSphere()
          mesh.layers.enable(BEACH_LAYER) // casts into the baked beach shadows
          return mesh
        }),
      )
      if (live) setObjects([...headland, ...groups])
    })()
    return () => {
      live = false
    }
  }, [])
  if (!objects) return null
  return (
    <group>
      {objects.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </group>
  )
}
