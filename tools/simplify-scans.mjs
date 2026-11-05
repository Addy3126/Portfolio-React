// Simplifies Poly Haven photo-scanned models (glTF, hundreds of thousands to millions of
// triangles) for the scene, keeping their UVs so their own scanned textures still fit, and
// packs each into a compact quantized binary plus three WebP maps.
//
//   node tools/simplify-scans.mjs <src dir> public/models name:triangles[:hiTriangles] ...
//
// One level per scan, <name>.bin, plus <name>_hi.bin if hiTriangles is given (the site no
// longer ships those or the 2K maps: at the distances the rocks are seen from they only
// added triangles per pixel; distant rocks get a lighter level from tools/lod-scans.mjs). Each vertex also carries ambient occlusion baked against the FULL scan
// (rays cast from the simplified surface into the original mesh), so crevices and the
// undersides of ledges stay dark even where the simplification flattened them.
//
// <src dir>/<name>/ holds the 1K glTF download (<name>_1k.gltf, <name>.bin and the diff,
// arm and nor_gl JPGs, either beside them or in textures/).
// Binary layout (little endian):
//   uint32 vertexCount, uint32 indexCount, float32[6] bbox min xyz / max xyz (metres),
//   uint16[3] positions (0..65535 across the bbox), int8[4] normal xyz + AO (0..127),
//   uint16[2] uvs (0..65535 over 0..1), uint16 or uint32 indices (uint32 if > 65535 verts).
// Maps, at 1K and 2K (<name>_2k_*): <name>_c.webp (albedo, partly desaturated, mean 0.5),
// <name>_orm.webp (R = AO, G = roughness), <name>_n.webp (OpenGL normal map).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeshoptSimplifier } from 'meshoptimizer'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

const [, , src, out, ...jobs] = process.argv
await MeshoptSimplifier.ready

for (const job of jobs) {
  const [name, t, th] = job.split(':')
  const target = Number(t)
  const hiTarget = th ? Number(th) : 0
  const dir = join(src, name)
  const gltf = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.gltf'))), 'utf8'))
  const bin = readFileSync(join(dir, gltf.buffers[0].uri))
  const prim = gltf.meshes[0].primitives[0]
  const read = (i, Type, comps) => {
    const acc = gltf.accessors[i]
    const view = gltf.bufferViews[acc.bufferView]
    const off = bin.byteOffset + (view.byteOffset || 0) + (acc.byteOffset || 0)
    return new Type(bin.buffer.slice(off, off + acc.count * comps * Type.BYTES_PER_ELEMENT))
  }
  const pos = read(prim.attributes.POSITION, Float32Array, 3)
  const nor = read(prim.attributes.NORMAL, Float32Array, 3)
  const uv = read(prim.attributes.TEXCOORD_0, Float32Array, 2)
  const idxAcc = gltf.accessors[prim.indices]
  const idx = new Uint32Array(read(prim.indices, idxAcc.componentType === 5125 ? Uint32Array : Uint16Array, 1))

  // Ambient occlusion at a vertex of the original mesh, from rays into the full scan.
  const full = new THREE.BufferGeometry()
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  full.setIndex(new THREE.BufferAttribute(idx, 1))
  const bvh = new MeshBVH(full)
  const diag = Math.hypot(...[0, 1, 2].map((k) => gltf.accessors[prim.attributes.POSITION].max[k] - gltf.accessors[prim.attributes.POSITION].min[k]))
  const reach = Math.max(0.05, Math.min(3, diag * 0.06)) // metres a ray looks for an occluder
  const RAYS = 24
  const dirs = Array.from({ length: RAYS }, (_, i) => {
    // Cosine-weighted hemisphere (around +z), Fibonacci spiral.
    const r = Math.sqrt((i + 0.5) / RAYS)
    const a = i * 2.39996323
    return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - r * r)]
  })
  const ray = new THREE.Ray()
  const nrm = new THREE.Vector3()
  const t1 = new THREE.Vector3()
  const t2 = new THREE.Vector3()
  const aoCache = new Map()
  const bakeAO = (v) => {
    if (aoCache.has(v)) return aoCache.get(v)
    nrm.set(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]).normalize()
    t1.set(Math.abs(nrm.x) > 0.9 ? 0 : 1, Math.abs(nrm.x) > 0.9 ? 1 : 0, 0).cross(nrm).normalize()
    t2.crossVectors(nrm, t1)
    let open = 0
    for (const [x, y, z] of dirs) {
      ray.origin.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).addScaledVector(nrm, reach * 0.01)
      ray.direction.set(0, 0, 0).addScaledVector(t1, x).addScaledVector(t2, y).addScaledVector(nrm, z).normalize()
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, reach)
      open += hit ? Math.min(1, hit.distance / reach) * 0.6 : 1
    }
    const ao = open / RAYS
    aoCache.set(v, ao)
    return ao
  }

  const lod = (tris, suffix) => {
    // Simplify, keeping UVs and normals; scans split into many UV islands can lock too much
    // border, so fall back to free borders, then to sloppy simplification.
    const n = pos.length / 3
    const attrs = new Float32Array(n * 5)
    for (let i = 0; i < n; i++) attrs.set([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], uv[i * 2] * 4, uv[i * 2 + 1] * 4], i * 5)
    const goal = tris * 3
    let [simple] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, goal, 0.02, ['LockBorder'])
    let how = 'attributes'
    if (simple.length > goal * 1.5) {
      ;[simple] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.2, 0.2, 0.2, 0.3, 0.3], null, goal, 0.05, [])
      how = 'free borders'
    }
    if (simple.length > goal * 1.5) {
      ;[simple] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, goal, 0.05)
      how = 'sloppy'
    }

    // Compact to the used vertices, then quantize.
    const remap = new Int32Array(n).fill(-1)
    const used = []
    for (const v of simple) if (remap[v] < 0) (remap[v] = used.length), used.push(v)
    const m = used.length
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (const v of used) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], pos[v * 3 + k])), (hi[k] = Math.max(hi[k], pos[v * 3 + k]))
    const P = new Uint16Array(m * 3)
    const N = new Int8Array(m * 4)
    const U = new Uint16Array(m * 2)
    const q = (x, a, b) => Math.round(((x - a) / Math.max(b - a, 1e-9)) * 65535)
    used.forEach((v, i) => {
      for (let k = 0; k < 3; k++) P[i * 3 + k] = q(pos[v * 3 + k], lo[k], hi[k])
      const l = Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) || 1
      for (let k = 0; k < 3; k++) N[i * 4 + k] = Math.round((nor[v * 3 + k] / l) * 127)
      N[i * 4 + 3] = Math.round(bakeAO(v) * 127)
      U[i * 2] = q(Math.min(1, Math.max(0, uv[v * 2])), 0, 1)
      U[i * 2 + 1] = q(Math.min(1, Math.max(0, uv[v * 2 + 1])), 0, 1)
    })
    const I = m > 65535 ? new Uint32Array(simple.length) : new Uint16Array(simple.length)
    simple.forEach((v, i) => (I[i] = remap[v]))
    const head = Buffer.alloc(8 + 24)
    head.writeUInt32LE(m, 0)
    head.writeUInt32LE(I.length, 4)
    ;[...lo, ...hi].forEach((x, k) => head.writeFloatLE(x, 8 + k * 4))
    const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)])
    const buf = Buffer.concat([head, pad(Buffer.from(P.buffer)), Buffer.from(N.buffer), Buffer.from(U.buffer), Buffer.from(I.buffer)])
    writeFileSync(join(out, `${name}${suffix}.bin`), buf)
    console.log(`${name}${suffix}: ${idx.length / 3} -> ${I.length / 3} triangles (${how}), ${(buf.length / 1024).toFixed(0)} KB`)

  }
  lod(target, '')
  if (hiTarget) lod(hiTarget, '_hi')

  // Maps.
  for (const res of ['1k', '2k']) {
    const tex = (kind) => [join(dir, 'textures', `${name}_${kind}_${res}.jpg`), join(dir, `${name}_${kind}_${res}.jpg`), join(dir, res, `${name}_${kind}_${res}.jpg`)].find((f) => existsSync(f))
    if (!tex('diff')) continue
    execFileSync('python3', ['-I', new URL('pack-scan-maps.py', import.meta.url).pathname, tex('diff'), tex('arm') ?? '-', tex('nor_gl'), join(out, res === '1k' ? name : `${name}_2k`)])
  }
}
