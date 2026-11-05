import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Merges the static meshes under `roots` into one mesh per material (and vertex layout), so
// a model built from dozens of small parts draws in a handful of calls: every draw call has
// a fixed cost on the main thread, whatever its size. The originals are hidden (kept in
// place, so nothing that looks them up breaks). Skipped: instanced meshes, multi-material
// meshes, and anything under an object for which skip(object) is true (moving parts).
// Geometry is baked into each root's parent space, so the merged meshes go beside the roots.
export function mergeStatic(roots, skip = () => false) {
  const buckets = new Map()
  for (const root of roots) {
    root.updateMatrixWorld(true)
    const rootInv = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : null
    const visit = (o) => {
      if (skip(o) || !o.visible) return
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !o.morphTargetInfluences) {
        const g = o.geometry
        const attrs = Object.keys(g.attributes).sort()
        const key = `${o.material.uuid}|${attrs.join(',')}|${g.index ? 'i' : 'n'}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`
        if (!buckets.has(key)) buckets.set(key, { material: o.material, meshes: [], matrices: [], cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder })
        const mat = o.matrixWorld.clone()
        if (rootInv) mat.premultiply(rootInv)
        buckets.get(key).meshes.push(o)
        buckets.get(key).matrices.push(mat)
      }
      for (const c of o.children) visit(c)
    }
    visit(root)
  }
  const merged = []
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue
    const geos = b.meshes.map((o, i) => {
      const g = o.geometry.clone()
      // Drop morph data and groups; bake the transform.
      g.morphAttributes = {}
      g.clearGroups()
      g.applyMatrix4(b.matrices[i])
      return g
    })
    const geo = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!geo) continue
    const mesh = new THREE.Mesh(geo, b.material)
    mesh.castShadow = b.cast
    mesh.receiveShadow = b.receive
    mesh.renderOrder = b.order
    merged.push(mesh)
    for (const o of b.meshes) o.visible = false
  }
  return merged
}
