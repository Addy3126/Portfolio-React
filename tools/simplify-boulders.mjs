// Simplifies Poly Haven scanned boulders (glTF, ~100k triangles) to a few thousand
// triangles for the scene, keeping their UVs, and writes a compact binary per model:
//   header (uint32): vertexCount, indexCount; then float32 positions (xyz, centred and
//   scaled to a 1 m radius, base at y = 0), float32 normals, float32 uvs, uint16 indices.
//   node tools/simplify-boulders.mjs <dir with <name>/<name>_1k.gltf + .bin> public/models <names...>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeshoptSimplifier } from 'meshoptimizer'

const [, , src, out, ...names] = process.argv
const TARGET = 4200 // triangles
await MeshoptSimplifier.ready

for (const name of names) {
  const gltf = JSON.parse(readFileSync(join(src, name, `${name}_1k.gltf`), 'utf8'))
  const bin = readFileSync(join(src, name, `${name}.bin`))
  const prim = gltf.meshes[0].primitives[0]
  const read = (i, Type, comps) => {
    const acc = gltf.accessors[i]
    const view = gltf.bufferViews[acc.bufferView]
    const off = (view.byteOffset || 0) + (acc.byteOffset || 0)
    return new Type(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + acc.count * comps * Type.BYTES_PER_ELEMENT))
  }
  const pos = read(prim.attributes.POSITION, Float32Array, 3)
  const nor = read(prim.attributes.NORMAL, Float32Array, 3)
  const uv = read(prim.attributes.TEXCOORD_0, Float32Array, 2)
  const idxAcc = gltf.accessors[prim.indices]
  const IdxType = idxAcc.componentType === 5125 ? Uint32Array : Uint16Array
  const idx = new Uint32Array(read(prim.indices, IdxType, 1))

  // Simplify with UVs and normals as attributes, so seams and shading survive.
  const n = pos.length / 3
  const attrs = new Float32Array(n * 5)
  for (let i = 0; i < n; i++) attrs.set([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], uv[i * 2] * 4, uv[i * 2 + 1] * 4], i * 5)
  let [simple, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, TARGET * 3, 0.02, ['LockBorder'])
  if (simple.length > TARGET * 3 * 1.5) {
    // Many UV islands lock too much border: simplify through the seams instead (vertices
    // are welded by position for the error metric, UV seams can then drift slightly).
    ;[simple, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.2, 0.2, 0.2, 0.3, 0.3], null, TARGET * 3, 0.03, [])
  }
  if (simple.length > TARGET * 3 * 1.5) {
    // Still stuck (the scan is split into many small pieces): sloppy simplification, which
    // ignores topology; vertices keep their own UVs and normals.
    ;[simple, err] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, TARGET * 3, 0.02)
  }
  // Compact: keep only used vertices.
  const remap = new Int32Array(n).fill(-1)
  const used = []
  for (const v of simple) if (remap[v] < 0) (remap[v] = used.length), used.push(v)
  const m = used.length
  const P = new Float32Array(m * 3)
  const N = new Float32Array(m * 3)
  const U = new Float32Array(m * 2)
  used.forEach((v, i) => {
    P.set(pos.subarray(v * 3, v * 3 + 3), i * 3)
    N.set(nor.subarray(v * 3, v * 3 + 3), i * 3)
    U.set(uv.subarray(v * 2, v * 2 + 2), i * 2)
  })
  // Centre on x/z, base at y = 0, largest horizontal radius 1.
  let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m; i++) {
    x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3])
    y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1])
    z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2])
  }
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const r = Math.max(x1 - x0, z1 - z0) / 2
  for (let i = 0; i < m; i++) {
    P[i * 3] = (P[i * 3] - cx) / r
    P[i * 3 + 1] = (P[i * 3 + 1] - y0) / r
    P[i * 3 + 2] = (P[i * 3 + 2] - cz) / r
  }
  const I = new Uint16Array(simple.length)
  simple.forEach((v, i) => (I[i] = remap[v]))
  const head = new Uint32Array([m, I.length])
  const buf = Buffer.concat([Buffer.from(head.buffer), Buffer.from(P.buffer), Buffer.from(N.buffer), Buffer.from(U.buffer), Buffer.from(I.buffer)])
  writeFileSync(join(out, `${name}.bin`), buf)
  console.log(name, `${idx.length / 3} -> ${I.length / 3} triangles, error ${err.toFixed(4)}, height/radius ${((y1 - y0) / r).toFixed(2)}, ${(buf.length / 1024).toFixed(0)} KB`)
}
