import * as THREE from 'three'
import { tier } from '../quality'
import { track } from '../textureReady'

// Photo-scanned models (CC0, Poly Haven), simplified and packed by tools/simplify-scans.mjs:
// quantized geometry in public/models/<name>.bin (with ambient occlusion baked per vertex
// from the full scan) plus their own scanned maps. They ship with the site and are cached by
// the browser like any other file. The ultra tier gets the denser level (<name>_hi.bin)
// where there is one, and 2K maps.
const ULTRA = tier === 'ultra'
const HI = new Set(['coastal_cliff_01', 'coastal_cliff_02', 'coastal_cliff_04', 'coast_rocks_01', 'coast_rocks_03', 'coast_rocks_05', 'coast_land_rocks_03'])
const MAPS_2K = new Set([...HI, 'boulder_01'])

const loader = new THREE.TextureLoader()
const textures = new Map()
function tex(file, srgb, repeat = false) {
  if (!textures.has(file)) {
    let done
    track(new Promise((r) => (done = r)))
    const t = loader.load(`./models/${file}`, done, undefined, done)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
    textures.set(file, t)
  }
  return textures.get(file)
}

async function loadGeometry(file) {
  const buf = await (await fetch(`./models/${file}.bin`)).arrayBuffer()
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
  const ao = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = lo[k] + (qp[i * 3 + k] / 65535) * (hi[k] - lo[k])
      nor[i * 3 + k] = qn[i * 4 + k] / 127
    }
    // Baked occlusion as a vertex colour (grey); a little lift keeps crevices from going
    // fully black under the twilight sky.
    const a = 0.12 + 0.88 * Math.max(0, qn[i * 4 + 3] / 127)
    ao[i * 3] = ao[i * 3 + 1] = ao[i * 3 + 2] = a
    uv[i * 2] = qu[i * 2] / 65535
    uv[i * 2 + 1] = qu[i * 2 + 1] / 65535
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(ao, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

// Rock look shared by both renderers' materials:
export const ROCK = {
  tint: '#cfc6d8', // light, only slightly lavender: the scan's own colour variation shows
  moss: '#59705f', // muted moss/lichen green, in keeping with the dusk palette
  wet: 0.42, // albedo multiplier in the wet band at the waterline
  wetTop: 0.55, // metres above the sea the wet band reaches
  detailScale: 7, // the scan's own albedo, re-sampled finer for close views
}

// The WebGL material: standard PBR with the scan's maps, plus moss on upward faces, a wet
// band at the waterline and a finer detail layer up close (shader additions below). The
// WebGPU path registers its own node-material version through setScanMaterialFactory.
function glMaterial(maps) {
  const m = new THREE.MeshStandardMaterial({
    color: ROCK.tint,
    map: maps.map,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: maps.orm, // G channel
    aoMap: maps.orm, // R channel
    aoMapIntensity: 0.9,
    roughness: 1,
    vertexColors: true, // baked occlusion
    envMapIntensity: 0.22, // the scans read glossy under the bright sky
  })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMoss = { value: new THREE.Color(ROCK.moss) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScanW;\nvarying vec3 vScanN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 scanWP = vec4(transformed, 1.0);
        vec3 scanN = objectNormal;
        #ifdef USE_INSTANCING
          scanWP = instanceMatrix * scanWP;
          scanN = mat3(instanceMatrix) * scanN;
        #endif
        vScanW = (modelMatrix * scanWP).xyz;
        vScanN = normalize(mat3(modelMatrix) * scanN);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uMoss;
        varying vec3 vScanW;
        varying vec3 vScanN;
        float scanHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float scanNoise(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(scanHash(i), scanHash(i + vec2(1, 0)), u.x), mix(scanHash(i + vec2(0, 1)), scanHash(i + vec2(1, 1)), u.x), u.y);
        }
        float scanWet = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float dist = length(vScanW - cameraPosition);
          // Finer detail up close: the scan's albedo again at a smaller scale.
          #ifdef USE_MAP
            float detail = texture2D(map, vMapUv * ${ROCK.detailScale.toFixed(1)}).g;
            diffuseColor.rgb *= mix(1.0, 0.6 + detail * 0.8, 1.0 - smoothstep(6.0, 30.0, dist));
          #endif
          // Moss and lichen gather on upward faces, in patches.
          float up = smoothstep(0.3, 0.75, normalize(vScanN).y);
          float patchy = scanNoise(vScanW.xz * 0.35) * 0.65 + scanNoise(vScanW.xz * 1.7) * 0.35;
          float moss = up * smoothstep(0.3, 0.55, patchy);
          diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.75 + 0.5 * scanNoise(vScanW.xz * 6.0)), moss * 0.8);
          // Wet, dark rock at the waterline (with a ragged top edge).
          float top = ${ROCK.wetTop.toFixed(2)} + (scanNoise(vScanW.xz * 0.8) - 0.5) * 0.35;
          scanWet = 1.0 - smoothstep(top - 0.25, top, vScanW.y);
          diffuseColor.rgb *= mix(1.0, ${ROCK.wet.toFixed(2)}, scanWet);
        }`,
      )
      // Dry rock stays matt (glossy texels glinted like flakes against the bright sky).
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(max(roughnessFactor, 0.7), 0.22, scanWet);')
  }
  return m
}

let factory = glMaterial
export function setScanMaterialFactory(fn) {
  factory = fn
}

const cache = new Map()
// { geometry, material } for a scan; loads once, shared by everything that uses it.
export function loadScan(name) {
  if (!cache.has(name)) {
    const file = ULTRA && HI.has(name) ? `${name}_hi` : name
    const res = ULTRA && MAPS_2K.has(name) ? `${name}_2k` : name
    const maps = { map: tex(`${res}_c.webp`, true, true), normal: tex(`${res}_n.webp`), orm: tex(`${res}_orm.webp`) }
    const p = loadGeometry(file).then((geometry) => ({ geometry, material: factory(maps) }))
    track(p)
    cache.set(name, p)
  }
  return cache.get(name)
}
