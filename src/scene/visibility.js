import * as THREE from 'three'
import { SHOTS } from './CameraRig'

// Every place a camera can be: each stop, points along each flight between stops (with
// the same upward arc the camera rig uses), portrait variants, and the mirror images of
// all of them below the water (the sea reflection renders the scene from there).
const SEA_Y = -0.04
const cameraSamples = (() => {
  const pts = []
  for (const portrait of [false, true]) {
    const shot = (i) => (portrait && SHOTS[i].portrait ? SHOTS[i].portrait : SHOTS[i])
    for (let i = 0; i < SHOTS.length - 1; i++) {
      const a = shot(i).pos
      const b = shot(i + 1).pos
      const d = a.distanceTo(b)
      for (let k = 0; k <= 14; k++) {
        const t = k / 14
        const p = a.clone().lerp(b, t)
        p.y += Math.sin(t * Math.PI) * d * 0.06
        pts.push(p)
      }
    }
  }
  const mirrored = pts.map((p) => new THREE.Vector3(p.x, 2 * SEA_Y - p.y, p.z))
  return [...pts, ...mirrored]
})()

const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()
const n = new THREE.Vector3()
const ctr = new THREE.Vector3()
const toCam = new THREE.Vector3()

function triangleVisible(matrix, pa, pb, pc, minY) {
  a.copy(pa).applyMatrix4(matrix)
  b.copy(pb).applyMatrix4(matrix)
  c.copy(pc).applyMatrix4(matrix)
  // Under the (opaque) sea: never seen.
  if (a.y < minY && b.y < minY && c.y < minY) return false
  n.subVectors(c, b).cross(toCam.subVectors(a, b))
  const len = n.length()
  if (len < 1e-10) return false
  n.multiplyScalar(1 / len)
  ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3)
  // Front-facing from at least one camera sample (small tolerance for parallax sway).
  for (const cam of cameraSamples) {
    toCam.subVectors(cam, ctr)
    if (n.dot(toCam) > -0.03 * toCam.length()) return true
  }
  return false
}

// Returns a copy of `geometry` without triangles that no camera can ever see: faces
// pointing away from every camera position, and faces entirely under the sea.
// `matrix` maps the geometry into world space. Works on indexed and non-indexed geometry.
export function cullHidden(geometry, matrix = new THREE.Matrix4(), { minY = -0.2 } = {}) {
  const pos = geometry.attributes.position
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  if (geometry.index) {
    const idx = geometry.index.array
    const keep = []
    for (let i = 0; i < idx.length; i += 3) {
      va.fromBufferAttribute(pos, idx[i])
      vb.fromBufferAttribute(pos, idx[i + 1])
      vc.fromBufferAttribute(pos, idx[i + 2])
      if (triangleVisible(matrix, va, vb, vc, minY)) keep.push(idx[i], idx[i + 1], idx[i + 2])
    }
    const out = geometry.clone()
    out.setIndex(keep)
    out.computeBoundingSphere()
    return out
  }
  const keepTri = []
  for (let i = 0; i < pos.count; i += 3) {
    va.fromBufferAttribute(pos, i)
    vb.fromBufferAttribute(pos, i + 1)
    vc.fromBufferAttribute(pos, i + 2)
    if (triangleVisible(matrix, va, vb, vc, minY)) keepTri.push(i)
  }
  const out = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const size = attr.itemSize
    const arr = new attr.array.constructor(keepTri.length * 3 * size)
    keepTri.forEach((i, k) => arr.set(attr.array.subarray(i * size, (i + 3) * size), k * 3 * size))
    out.setAttribute(name, new THREE.BufferAttribute(arr, size))
  }
  out.computeBoundingSphere()
  return out
}
