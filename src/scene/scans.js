import * as THREE from 'three'
import { track } from '../textureReady'

// Photo-scanned models (CC0, Poly Haven), simplified and packed by tools/simplify-scans.mjs:
// quantized geometry in public/models/<name>.bin plus their own scanned maps. Each is drawn
// with a standard material (so both renderers handle it the same way), its grey albedo
// tinted to the twilight palette. They ship with the site and are cached by the browser
// like any other file.
const loader = new THREE.TextureLoader()
const textures = new Map()
function tex(file, srgb) {
  if (!textures.has(file)) {
    let done
    track(new Promise((r) => (done = r)))
    const t = loader.load(`./models/${file}`, done, undefined, done)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    textures.set(file, t)
  }
  return textures.get(file)
}

async function loadGeometry(name) {
  const buf = await (await fetch(`./models/${name}.bin`)).arrayBuffer()
  const head = new DataView(buf)
  const nv = head.getUint32(0, true)
  const ni = head.getUint32(4, true)
  const lo = [0, 1, 2].map((k) => head.getFloat32(8 + k * 4, true))
  const hi = [0, 1, 2].map((k) => head.getFloat32(20 + k * 4, true))
  let o = 32
  const qp = new Uint16Array(buf, o, nv * 3)
  o += nv * 6
  o += (4 - (o % 4)) % 4
  const qn = new Int8Array(buf, o, nv * 4)
  o += nv * 4
  const qu = new Uint16Array(buf, o, nv * 2)
  o += nv * 4
  const index = nv > 65535 ? new Uint32Array(buf, o, ni) : new Uint16Array(buf, o, ni)

  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const uv = new Float32Array(nv * 2)
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = lo[k] + (qp[i * 3 + k] / 65535) * (hi[k] - lo[k])
      nor[i * 3 + k] = qn[i * 4 + k] / 127
    }
    uv[i * 2] = qu[i * 2] / 65535
    uv[i * 2 + 1] = qu[i * 2 + 1] / 65535
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function scanMaterial(name, { color = '#9c94c6', normalScale = 1.6 } = {}) {
  const orm = tex(`${name}_orm.webp`)
  return new THREE.MeshStandardMaterial({
    color,
    map: tex(`${name}_c.webp`, true),
    normalMap: tex(`${name}_n.webp`),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: orm, // G channel
    aoMap: orm, // R channel
    aoMapIntensity: 0.9,
    roughness: 1,
    // The scans read glossy under the bright sky; keep sky reflections low.
    envMapIntensity: 0.22,
  })
}

const cache = new Map()
// { geometry, material } for a scan; loads once, shared by everything that uses it.
export function loadScan(name, opts) {
  if (!cache.has(name)) {
    const p = loadGeometry(name).then((geometry) => ({ geometry, material: scanMaterial(name, opts) }))
    track(p)
    cache.set(name, p)
  }
  return cache.get(name)
}
