import * as THREE from 'three'
import { tier } from '../quality'
import { track } from '../textureReady'

// Photo-scanned surface sets for the WebGL scene: the same textures the WebGPU scene uses
// (see gpu/textures.js and tools/pack-textures.py):
//   <name>_s : R = albedo luminance (mean 0.5), G = roughness, B = ambient occlusion
//   <name>_n : RG = tangent-space normal (OpenGL), B = height
const RES = tier === 'ultra' ? '2k' : tier === 'low' || tier === 'minimal' ? '512' : '1k'
const loader = new THREE.TextureLoader()
const cache = new Map()

function load(file) {
  let done
  track(new Promise((r) => (done = r)))
  const t = loader.load(`./textures/${file}`, done, undefined, done)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 8
  return t
}

// Uniform pair { s, n } for one set.
export function surfaceUniforms(name, prefix) {
  if (!cache.has(name)) cache.set(name, { s: load(`${name}_s_${RES}.webp`), n: load(`${name}_n_${RES}.webp`) })
  const set = cache.get(name)
  return { [`${prefix}S`]: { value: set.s }, [`${prefix}N`]: { value: set.n } }
}

// Triplanar sampling (UDN normal blend, as gpu/textures.js). Returns the detail-mapped
// normal; writes luminance, roughness and AO to `info`.
export const triplanarGLSL = /* glsl */ `
vec3 triplanar(sampler2D tS, sampler2D tN, vec3 P, vec3 N, float scale, float strength, out vec3 info){
  vec3 p = P * scale;
  vec3 w = pow(abs(N), vec3(4.0));
  w /= max(dot(w, vec3(1.0)), 1e-4);
  info = texture2D(tS, p.zy).rgb * w.x + texture2D(tS, p.xz).rgb * w.y + texture2D(tS, p.xy).rgb * w.z;
  vec2 tX = (texture2D(tN, p.zy).xy * 2.0 - 1.0) * strength;
  vec2 tY = (texture2D(tN, p.xz).xy * 2.0 - 1.0) * strength;
  vec2 tZ = (texture2D(tN, p.xy).xy * 2.0 - 1.0) * strength;
  return normalize(N + vec3(0.0, tX.y, tX.x) * w.x + vec3(tY.x, 0.0, tY.y) * w.y + vec3(tZ.x, tZ.y, 0.0) * w.z);
}
`
