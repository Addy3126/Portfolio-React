import * as THREE from 'three/webgpu'
import { abs, dot, max, normalize, pow, texture, vec3 } from 'three/tsl'
import { tier } from '../quality'

// Photo-scanned surface sets (CC0, Poly Haven), packed by tools into two textures each:
//   <name>_s : R = albedo luminance (mean 0.5), G = roughness, B = ambient occlusion
//   <name>_n : RG = tangent-space normal (OpenGL), B = height
// The scene keeps its own palette: luminance modulates the colour, it doesn't replace it.
// 2K when the device starts on the ultra tier, 1K otherwise.
const RES = tier === 'ultra' ? '2k' : '1k'
const loader = new THREE.TextureLoader()
const cache = new Map()

function load(file) {
  const t = loader.load(`./textures/${file}`)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 8
  return t
}

export function surface(name) {
  if (!cache.has(name)) cache.set(name, { s: load(`${name}_s_${RES}.webp`), n: load(`${name}_n_${RES}.webp`) })
  return cache.get(name)
}

// Triplanar sampling of a surface set at world position P (metres * scale) with world
// normal N. Returns { N: detail-mapped normal, lum, rough, ao, height }.
// Normals use the UDN blend (Golus, "Normal Mapping for a Triplanar Shader").
export function triplanar(set, P, N, scale, strength = 1) {
  const p = P.mul(scale)
  const w0 = pow(abs(N), vec3(4.0))
  const w = w0.div(max(dot(w0, vec3(1.0)), 1e-4))
  const sX = texture(set.s, p.zy)
  const sY = texture(set.s, p.xz)
  const sZ = texture(set.s, p.xy)
  const s = sX.rgb.mul(w.x).add(sY.rgb.mul(w.y)).add(sZ.rgb.mul(w.z))
  const nX = texture(set.n, p.zy)
  const nY = texture(set.n, p.xz)
  const nZ = texture(set.n, p.xy)
  const tX = nX.xy.mul(2.0).sub(1.0).mul(strength)
  const tY = nY.xy.mul(2.0).sub(1.0).mul(strength)
  const tZ = nZ.xy.mul(2.0).sub(1.0).mul(strength)
  const nx = vec3(0.0, tX.y, tX.x)
  const ny = vec3(tY.x, 0.0, tY.y)
  const nz = vec3(tZ.x, tZ.y, 0.0)
  const Nd = normalize(N.add(nx.mul(w.x)).add(ny.mul(w.y)).add(nz.mul(w.z)))
  const height = nX.b.mul(w.x).add(nY.b.mul(w.y)).add(nZ.b.mul(w.z))
  return { N: Nd, lum: s.r, rough: s.g, ao: s.b, height }
}
