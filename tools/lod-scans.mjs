// Distance levels of detail for the scanned rocks: reads a packed scan (<name>.bin, the
// layout written by tools/simplify-scans.mjs), simplifies it to a fraction of its triangles
// and writes <name>_lo.bin in the same layout (baked occlusion carried over per vertex).
// Used where the rocks are only ever seen from far away (the headland rubble, the rubble
// round the sea towers), where the full scan would put several triangles in every pixel.
//
//   node tools/lod-scans.mjs public/models name:triangles ...
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeshoptSimplifier } from 'meshoptimizer'

const [, , dir, ...jobs] = process.argv
await MeshoptSimplifier.ready

function read(file) {
  const buf = readFileSync(file)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const head = new DataView(ab)
  const nv = head.getUint32(0, true)
  const ni = head.getUint32(4, true)
  const bbox = new Float32Array(ab, 8, 6).slice()
  let o = 32
  const qp = new Uint16Array(ab, o, nv * 3)
  o += nv * 6
  o += (4 - (o % 4)) % 4
  const qn = new Int8Array(ab, o, nv * 4)
  o += nv * 4
  const qu = new Uint16Array(ab, o, nv * 2)
  o += nv * 4
  const index = nv > 65535 ? new Uint32Array(ab, o, ni) : new Uint16Array(ab, o, ni)
  return { nv, ni, bbox, qp, qn, qu, index }
}

function write(file, { bbox, qp, qn, qu, index }) {
  const nv = qp.length / 3
  const ni = index.length
  const wide = nv > 65535
  let size = 32 + nv * 6
  size += (4 - (size % 4)) % 4
  const offN = size
  size += nv * 4
  const offU = size
  size += nv * 4
  const offI = size
  size += ni * (wide ? 4 : 2)
  const ab = new ArrayBuffer(size)
  const dv = new DataView(ab)
  dv.setUint32(0, nv, true)
  dv.setUint32(4, ni, true)
  new Float32Array(ab, 8, 6).set(bbox)
  new Uint16Array(ab, 32, nv * 3).set(qp)
  new Int8Array(ab, offN, nv * 4).set(qn)
  new Uint16Array(ab, offU, nv * 2).set(qu)
  ;(wide ? new Uint32Array(ab, offI, ni) : new Uint16Array(ab, offI, ni)).set(index)
  writeFileSync(file, new Uint8Array(ab))
}

for (const job of jobs) {
  const [name, t] = job.split(':')
  const src = read(join(dir, `${name}.bin`))
  const { nv, bbox } = src
  // Real-unit positions (for the error metric), normals and uvs as attributes.
  const pos = new Float32Array(nv * 3)
  const attrs = new Float32Array(nv * 5)
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = bbox[k] + (src.qp[i * 3 + k] / 65535) * (bbox[k + 3] - bbox[k])
      attrs[i * 5 + k] = src.qn[i * 4 + k] / 127
    }
    attrs[i * 5 + 3] = src.qu[i * 2] / 65535
    attrs[i * 5 + 4] = src.qu[i * 2 + 1] / 65535
  }
  const idx = new Uint32Array(src.index)
  const goal = Math.floor(Number(t) * 3)
  let [simple] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.3, 0.3, 0.3, 0.5, 0.5], null, goal, 0.05, ['LockBorder'])
  if (simple.length > goal * 1.3) [simple] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.2, 0.2, 0.2, 0.3, 0.3], null, goal, 0.1, [])
  if (simple.length > goal * 1.3) [simple] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, goal, 0.1)
  // Keep only the vertices still used.
  const remap = new Int32Array(nv).fill(-1)
  const used = []
  for (const v of simple) if (remap[v] < 0) (remap[v] = used.length), used.push(v)
  const out = {
    bbox,
    qp: new Uint16Array(used.length * 3),
    qn: new Int8Array(used.length * 4),
    qu: new Uint16Array(used.length * 2),
    index: Uint32Array.from(simple, (v) => remap[v]),
  }
  used.forEach((v, i) => {
    out.qp.set(src.qp.subarray(v * 3, v * 3 + 3), i * 3)
    out.qn.set(src.qn.subarray(v * 4, v * 4 + 4), i * 4)
    out.qu.set(src.qu.subarray(v * 2, v * 2 + 2), i * 2)
  })
  write(join(dir, `${name}_lo.bin`), out)
  console.log(`${name}: ${src.ni / 3} -> ${simple.length / 3} triangles, ${used.length} vertices`)
}
