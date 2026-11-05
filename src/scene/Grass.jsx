import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { debug } from '../quality'
import { bedFactor } from './beds'
import { fogGLSL, noiseGLSL, shadowGLSL, rippleGLSL } from './glsl'
import { BEACH_WIDTH, PIANO_POS, color, hideInReflection, landDist, mainDist, neverReflected, palette, shared } from './world'

// A tiled grass field in the spirit of Ghost of Tsushima's grass, adapted to WebGL2:
// - 2.5 m tiles, each frustum-culled on its own
// - two levels of detail per tile (15-20 verts close, 8 verts further), nothing beyond
//   (the ground shader paints a grass "carpet" there instead)
// - blades are quadratic Bezier curves with per-blade stiffness for the wind
// - short blades fold into two blades from one root (double density for free)
// - blades seen edge-on are turned and widened toward the camera (no thin flicker)
// - clumping, large colour patches, a few taller seed stalks

// Blade proportions: half the original height (the piano is true to scale, ~1 m tall, and
// the field read as waist-high), narrower blades, and twice the density to keep it full.
export const GRASS_HEIGHT = 0.5 * debug.grassScale
export const GRASS_WIDTH = 0.6 * debug.grassWidth
// Short blades fold into two from one root; the cut-off follows the height scale.
export const FOLD_BELOW = (0.33 * GRASS_HEIGHT).toFixed(4)

export const TILE = 2.5
const CLUMP_CELL = 0.9
// Blade tiles cover the main field; the far spit is painted as carpet by the ground.
export const FIELD = { x0: -24, x1: 46, z0: -66, z1: 11.8 }

// Deterministic hash and value noise for placement-time variation.
const hash = (i, j, k) => {
  const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
  return v - Math.floor(v)
}
function vnoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi, 9)
  const b = hash(xi + 1, yi, 9)
  const c = hash(xi, yi + 1, 9)
  const d = hash(xi + 1, yi + 1, 9)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x, y) {
  let v = 0
  let a = 0.5
  for (let i = 0; i < 5; i++) {
    v += a * vnoise(x, y)
    x = x * 2.03 + 17.1
    y = y * 2.03 + 9.2
    a *= 0.5
  }
  return v
}
function nearestClump(x, z) {
  const ci = Math.floor(x / CLUMP_CELL)
  const cj = Math.floor(z / CLUMP_CELL)
  let best = null
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di
      const j = cj + dj
      const cx = (i + 0.15 + 0.7 * hash(i, j, 1)) * CLUMP_CELL
      const cz = (j + 0.15 + 0.7 * hash(i, j, 2)) * CLUMP_CELL
      const d = Math.hypot(x - cx, z - cz)
      if (!best || d < best.d) best = { d, cx, cz, i, j }
    }
  best.height = 0.75 + 0.55 * hash(best.i, best.j, 3)
  best.tone = hash(best.i, best.j, 4)
  return best
}

// Where grass may grow.
const inField = (x, z) =>
  z <= FIELD.z1 && z >= FIELD.z0 && landDist(x, z) >= BEACH_WIDTH - 1.2 && (z < -16 || Math.abs(x) <= (11.5 - z) * 1.05 + 3) &&
  Math.hypot(x, z - 9) >= 1.4 && Math.hypot(x + 1.5, z - 10.8) >= 1.4 && Math.hypot(x - 31, z + 38) >= 3.5 // clear of the Contact camera

// Blade template: `parts` strips of `segments` segments. position = (side -0.5..0.5, t 0..1, part).
export function bladeTemplate(segments, parts) {
  const pos = []
  const index = []
  for (let p = 0; p < parts; p++) {
    const base = pos.length / 3
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      pos.push(-0.5, t, p, 0.5, t, p)
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  return { position: new THREE.Float32BufferAttribute(pos, 3), index: new THREE.Uint16BufferAttribute(index, 1) }
}

const vertex = /* glsl */ `
attribute vec3 iOffset;
attribute vec4 iParams; // yaw, height, width, random
attribute vec2 iClump;  // clump tone, distance from clump centre (0..1)
attribute vec3 iPatch;  // large-scale patches: frost, dark hollow, blue tint
attribute vec2 iExtra;  // stiffness, kind (0 blade, 1 seed stalk)
uniform float uTime;
uniform float uMotion;
uniform vec2 uCursor;
uniform float uGrassFar;
uniform float uGrassHi;
uniform float uCursorStrength;
varying float vT;
varying float vRand;
varying float vTone;
varying float vKind;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vPatch;
${noiseGLSL}
void main(){
  float side = position.x;
  float aT = position.y;
  float part = position.z;
  float yaw = iParams.x, hgt = iParams.y, wid = iParams.z, rnd = iParams.w;
  float stiff = iExtra.x, kind = iExtra.y;
  vec3 base = iOffset;
  // Smooth hand-overs, so no edge or pop shows (as in Ghost of Tsushima): blades shrink
  // away over the last metres before the field turns into the painted carpet, and the
  // extra folded blade of the close level fades out before tiles switch to the far level.
  float camD = length(iOffset.xz - cameraPosition.xz);
  float shrink = 1.0;
  #ifdef FADE_FAR
    shrink = 1.0 - smoothstep(uGrassFar - 8.0, uGrassFar - 2.0, camD);
  #endif
  // Level of detail per blade: the close level draws blades nearer than uGrassHi, the far
  // level the rest (zero-size blades are dropped before shading). Per blade rather than per
  // tile, so the far level can be drawn in large chunks (a few draw calls, not dozens).
  #ifdef LOD_HI
    shrink *= 1.0 - step(uGrassHi, camD);
  #else
    shrink *= step(uGrassHi, camD);
  #endif

  float t;
  #ifdef LOD_HI
    // Short blades fold into two blades from the same root; tall ones use both strips in a row.
    if (kind < 0.5 && hgt < ${FOLD_BELOW}) {
      t = aT;
      if (part > 0.5) {
        yaw += 2.4 + rnd * 1.2;
        base.xz += vec2(cos(yaw), sin(yaw)) * 0.035;
        hgt *= 0.85;
        shrink *= 1.0 - smoothstep(uGrassHi - 3.0, uGrassHi - 0.5, camD);
      }
    } else {
      t = (part + aT) * 0.5;
    }
  #else
    t = aT;
  #endif

  hgt *= shrink;
  wid *= shrink;
  float c = cos(yaw), s = sin(yaw);
  vec3 sideAxis = vec3(c, 0.0, s);
  vec2 fwd = vec2(-s, c);

  // Quadratic Bezier blade: root at the base, control point and tip leaning forward.
  float lean = (kind > 0.5 ? 0.12 : 0.25 + rnd * 0.5) * (1.3 - stiff * 0.6);
  vec3 p1 = vec3(fwd.x * hgt * sin(lean) * 0.25, hgt * 0.62, fwd.y * hgt * sin(lean) * 0.25);
  vec3 p2 = vec3(fwd.x * hgt * sin(lean), hgt * cos(lean), fwd.y * hgt * sin(lean));

  // Wind pushes the tip (and a little of the control point); stiff blades resist.
  float time = uTime * uMotion;
  float gust = vnoise(iOffset.xz * 0.07 + vec2(-time * 0.22, time * 0.03));
  float wave = sin(time * 1.05 - iOffset.x * 0.32 + iOffset.z * 0.18) * 0.5 + 0.5;
  float windAmt = (0.1 + 0.55 * gust * gust + 0.16 * wave) * (1.25 - stiff * 0.5);
  vec2 windDir = vec2(0.862, -0.507);
  p2.xz += windDir * windAmt * hgt;
  p1.xz += windDir * windAmt * hgt * 0.35;

  // Part around the cursor.
  vec2 away = iOffset.xz - uCursor;
  float dc = length(away);
  float partAmt = uCursorStrength * (1.0 - smoothstep(0.12, 0.9, dc));
  vec2 pushDir = away / max(dc, 1e-3);
  p2.xz += pushDir * partAmt * hgt * 1.15;
  p1.xz += pushDir * partAmt * hgt * 0.4;

  // Keep blade length: bending lowers the tip instead of stretching the blade.
  p2 = normalize(p2) * hgt;

  vec3 B = 2.0 * (1.0 - t) * t * p1 + t * t * p2;
  vec3 dB = 2.0 * (1.0 - t) * p1 + 2.0 * t * (p2 - p1);

  // Turn and widen blades seen edge-on, so they don't thin to flickering lines.
  vec2 vd = normalize(base.xz - cameraPosition.xz + vec2(1e-4));
  float edgeOn = abs(dot(sideAxis.xz, vd));
  vec2 perp = vec2(-vd.y, vd.x);
  perp *= sign(dot(sideAxis.xz, perp) + 1e-4);
  sideAxis.xz = normalize(mix(sideAxis.xz, perp, edgeOn * 0.35));

  float w = kind > 0.5
    ? wid * (0.4 + 1.1 * smoothstep(0.6, 0.82, t)) * pow(1.0 - t, 0.5)
    : wid * pow(1.0 - t, 0.85);
  w *= 1.0 + 0.8 * edgeOn * edgeOn;

  vec3 world = base + B + sideAxis * side * w;
  vec3 n = normalize(cross(sideAxis, normalize(dB + vec3(0.0, 1e-4, 0.0))));
  n = normalize(n + sideAxis * side * 1.6);

  vT = t;
  vRand = rnd;
  vTone = iClump.x;
  vKind = kind;
  vPatch = iPatch;
  vWorld = world;
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 cBase, cTip, cFrost, cSky, cGround, cSun, cBlue;
uniform vec3 uPianoPos, uPianoGlow;
${rippleGLSL}
uniform float uGlowPulse;
varying float vT;
varying float vRand;
varying float vTone;
varying float vKind;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vPatch;
float spow(float x, float e){ return pow(max(x, 0.0), e); }
${fogGLSL}
${shadowGLSL}
void main(){
  float t = clamp(vT, 0.0, 1.0);
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormal + vec3(0.0, 1e-5, 0.0)) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 L = uSunDir;

  // Albedo: base to tip, varied per clump and by large patches.
  vec3 albedo = mix(cBase, cTip, smoothstep(0.0, 0.85, t));
  albedo *= 0.7 + 0.45 * vTone + 0.2 * (vRand - 0.5);
  albedo = mix(albedo, albedo * cBlue * 1.6, smoothstep(0.45, 0.8, vPatch.z) * 0.5);
  albedo *= 1.0 - 0.35 * smoothstep(0.5, 0.85, vPatch.y);
  // Seed stalks: darker stems, pale frosted heads.
  float head = vKind * smoothstep(0.6, 0.72, t);
  albedo = mix(albedo * (1.0 - 0.35 * vKind), cFrost * 0.8, head);

  // Lighting: twilight sky, low sun wrapping around blades, light through blades.
  vec3 ambient = mix(cGround, cSky, N.y * 0.5 + 0.5);
  float wrap = max((dot(N, L) + 0.5) / 1.5, 0.0);
  float through = spow(dot(V, L), 3.0) * (0.35 + 0.65 * t);
  vec3 H = normalize(L - V);
  float spec = spow(dot(N, H), 12.0) * t;

  // Piano shadow and contact darkening.
  float sh = pianoShadow(vWorld);
  float contact = pianoContact(vWorld.xz);
  ambient *= mix(0.55, 1.0, sh) * contact;
  wrap *= sh;
  through *= mix(0.3, 1.0, sh);
  spec *= sh;

  vec3 col = albedo * (ambient + cSun * wrap * 0.45) + albedo * cSun * through * 1.4 + cSun * spec * 0.08;

  // Frost on the upper blade, heavier in frosty patches.
  float frost = smoothstep(0.3, 0.95, t) * (0.55 + 0.45 * smoothstep(0.35, 0.7, vPatch.x)) * (1.0 - vKind * 0.6);
  vec3 frostLit = cFrost * (0.5 + ambient * 0.7 + cSun * (wrap * 0.3 + through * 1.4));
  col = mix(col, frostLit, frost * 0.8);
  col *= mix(0.62, 1.0, sh);

  // Ambient occlusion: dark at the roots.
  col *= mix(0.22, 1.0, smoothstep(0.0, 0.55, t));

  // Far away, pull blades toward the field's average tone to stop shimmer.
  float calm = smoothstep(5.0, 16.0, dist);
  vec3 avg = mix(cTip, cFrost, 0.55) * (cSky * 0.9 + cSun * 0.15);
  col = mix(col, avg, calm * 0.45);

  // Blue spill from the piano.
  float pd = length(vWorld.xz - uPianoPos.xz);
  col += uPianoGlow * uGlowPulse * (0.2 + t) * 0.5 / (1.0 + pd * pd * 0.9);
  col += uPianoGlow * pianoRipple(pd, uTime) * (0.25 + t) * 0.7;

  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

function makeMaterial(hi, fadeFar = true) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    defines: { ...(hi ? { LOD_HI: '' } : {}), ...(fadeFar ? { FADE_FAR: '' } : {}) },
    uniforms: {
      ...shared,
      cBase: { value: color(palette.grassBase) },
      cTip: { value: color(palette.grassTip) },
      cFrost: { value: color(palette.frost) },
      cSky: { value: color('#9a92dc') },
      cGround: { value: color('#1a1d4a') },
      cSun: { value: color(palette.glow) },
      cBlue: { value: color('#6f8cff') },
    },
  })
}

// Denser close to the cameras and piano, sparser toward the shore.
const densityAt = (z, base) => base * (z < -12 ? 0.6 : 1 + 2.2 * THREE.MathUtils.smoothstep(z, -2, 6))

export function buildTile(tx, tz, base, rand) {
  const x0 = tx * TILE
  const z0 = tz * TILE
  const tries = Math.round(densityAt(z0 + TILE / 2, base) * TILE * TILE * 1.35)
  const offsets = []
  const params = []
  const clumps = []
  const patches = []
  const extras = []
  for (let n = 0; n < tries; n++) {
    const x = x0 + rand() * TILE
    const z = z0 + rand() * TILE
    if (!inField(x, z)) continue
    // Ragged edge where grass meets the beach: the line wanders, and grass thins out over
    // the last metre or so instead of stopping on a hard line.
    const ld = landDist(x, z)
    const edge = BEACH_WIDTH - 1.1 + vnoise(x * 0.35 + 5, z * 0.35 - 2) * 2.4
    if (ld < edge) continue
    const edgeFade = THREE.MathUtils.smoothstep(ld, edge, edge + 1.6)
    if (rand() > 0.12 + 0.88 * edgeFade) continue
    // The spit: grass thins out gradually from the field, then survives only in a few
    // natural clumps among the sand.
    const md = mainDist(x, z)
    const onSpit = md < 0
    if (onSpit) {
      const fromField = THREE.MathUtils.smoothstep(md, -10, 0)
      const patch = THREE.MathUtils.smoothstep(vnoise(x * 0.16 + 21, z * 0.16 - 13), 0.62, 0.8)
      if (rand() > Math.max(fromField, patch * 0.5)) continue
    }
    const clump = nearestClump(x, z)
    const rel = Math.min(1, clump.d / (CLUMP_CELL * 0.75))
    if (rand() < rel * rel * 0.65) continue // gaps between clumps

    const nearBench = Math.abs(x - (PIANO_POS.x - 0.8)) < 0.3 && Math.abs(z - PIANO_POS.z) < 0.55
    const seed = rand() < 0.012 && !nearBench
    const yaw =
      clump.d > 0.08 ? Math.atan2(-(x - clump.cx), z - clump.cz) + (rand() - 0.5) * 0.9 : rand() * Math.PI * 2
    let height = (0.24 + rand() * 0.36) * clump.height * (1.08 - 0.4 * rel) * (nearBench ? 0.4 : 1)
    // Main field: back rows slightly taller and wider so they still read from the landing
    // camera. The spit is seen up close from the Contact camera, so it keeps true sizes.
    let width = 0.03 + rand() * 0.028
    if (!onSpit) {
      height *= z < -4 ? 1.2 : 1
      width += Math.min(12, Math.max(0, -z)) * 0.004
    } else {
      height *= 0.7 // shorter, sparser beach grass
    }
    height *= 0.65 + 0.35 * edgeFade // shorter where it thins out at the edge
    const bed = bedFactor(x, z)
    if (bed > 0) {
      if (rand() < bed * 0.4) continue // thinner under the flowers
      height *= 1 - 0.6 * bed // and low, so the bed shows
    }
    if (seed) {
      height = 0.5 + rand() * 0.22
      width *= 0.55
    }
    offsets.push(x, 0, z)
    params.push(yaw, height * GRASS_HEIGHT, width * GRASS_WIDTH, rand())
    clumps.push(clump.tone, rel)
    patches.push(fbm(x * 0.09 + 3, z * 0.09 + 3), vnoise(x * 0.16 - 7, z * 0.16 - 7), vnoise(x * 0.05 + 11, z * 0.05 + 11))
    extras.push(0.3 + rand() * 0.7, seed ? 1 : 0)
  }
  const count = offsets.length / 3
  if (!count) return null
  return {
    count,
    center: new THREE.Vector3(x0 + TILE / 2, 0.4, z0 + TILE / 2),
    attrs: {
      iOffset: new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3),
      iParams: new THREE.InstancedBufferAttribute(new Float32Array(params), 4),
      iClump: new THREE.InstancedBufferAttribute(new Float32Array(clumps), 2),
      iPatch: new THREE.InstancedBufferAttribute(new Float32Array(patches), 3),
      iExtra: new THREE.InstancedBufferAttribute(new Float32Array(extras), 2),
    },
  }
}

// The whole field, built once per density, in two groupings of the same blades:
// - tiles (TILE metres square) for the close level, drawn only near the camera;
// - chunks of CHUNK x CHUNK tiles for the far level: a few dozen draw calls became a
//   handful (each draw has a fixed cost on the main thread, and the far level covers most
//   of the field). The shaders pick the level per blade by distance (uGrassHi), so the two
//   never overlap however the tiles and chunks line up.
// The spit's grass is kept apart (own chunks): it stays on at any distance and is the only
// grass the sea can reflect.
const CHUNK = 3
export function buildField(density) {
  const rand = seeded(1234)
  const tiles = []
  const groups = new Map()
  for (let tx = Math.floor(FIELD.x0 / TILE); tx < Math.ceil(FIELD.x1 / TILE); tx++)
    for (let tz = Math.floor(FIELD.z0 / TILE); tz < Math.ceil(FIELD.z1 / TILE); tz++) {
      const tile = buildTile(tx, tz, density, rand)
      if (!tile) continue
      const spit = tile.center.z < -12
      const box = [tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE]
      tiles.push({ ...tile, spit, box, sphere: boxSphere(box) })
      const key = `${Math.floor(tx / CHUNK)},${Math.floor(tz / CHUNK)},${spit}`
      if (!groups.has(key)) groups.set(key, { spit, parts: [], box: [Infinity, Infinity, -Infinity, -Infinity] })
      const g = groups.get(key)
      g.parts.push(tile)
      g.box = [Math.min(g.box[0], box[0]), Math.min(g.box[1], box[1]), Math.max(g.box[2], box[2]), Math.max(g.box[3], box[3])]
    }
  const chunks = [...groups.values()].map(({ spit, parts, box }) => {
    const attrs = {}
    for (const k of Object.keys(parts[0].attrs)) {
      const size = parts[0].attrs[k].itemSize
      const arr = new Float32Array(parts.reduce((n, t) => n + t.attrs[k].array.length, 0))
      let o = 0
      for (const t of parts) {
        arr.set(t.attrs[k].array, o)
        o += t.attrs[k].array.length
      }
      attrs[k] = new THREE.InstancedBufferAttribute(arr, size)
    }
    return { spit, attrs, count: parts.reduce((n, t) => n + t.count, 0), box, sphere: boxSphere(box) }
  })
  window.__grassBlades = tiles.reduce((n, t) => n + t.count, 0)
  return { tiles, chunks }
}
function boxSphere([x0, z0, x1, z1]) {
  return new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, 0.4, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0) / 2 + 1.2)
}
// Horizontal distance from (x, z) to the nearest and farthest points of a box [x0, z0, x1, z1].
export const nearest = (b, x, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3]))
export const farthest = (b, x, z) => Math.hypot(Math.max(x - b[0], b[2] - x), Math.max(z - b[1], b[3] - z))
// Which meshes draw this frame: close-level tiles that reach within hiDist, far-level chunks
// that reach past hiDist and within loDist (spit chunks always).
export function updateField(field, cam, hiDist, loDist) {
  for (const t of field.tiles) t.hi.visible = hiDist > 0 && nearest(t.box, cam.x, cam.z) < hiDist
  for (const c of field.chunks) c.lo.visible = c.spit || (nearest(c.box, cam.x, cam.z) < loDist && farthest(c.box, cam.x, cam.z) >= hiDist)
}

export function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// density: blades per m^2 at the back of the field (more near the camera);
// hiDist / loDist: distance (m) up to which detailed / simple blades are drawn.
export default function Grass({ density = 140, hiDist = 10, loDist = 28 }) {
  // Spit tiles stay on at any distance (sparse, no carpet under them), so they don't fade.
  const materials = useMemo(() => ({ hi: makeMaterial(true), lo: makeMaterial(false), loSpit: makeMaterial(false, false) }), [])
  const templates = useMemo(() => ({ hi: bladeTemplate(4, 2), lo: bladeTemplate(3, 1) }), [])

  const field = useMemo(() => {
    const f = buildField(density)
    const make = (part, tpl, mat) => {
      const g = new THREE.InstancedBufferGeometry()
      g.setAttribute('position', tpl.position)
      g.setIndex(tpl.index)
      for (const [k, a] of Object.entries(part.attrs)) g.setAttribute(k, a)
      g.instanceCount = part.count
      g.boundingSphere = part.sphere
      const m = new THREE.Mesh(g, mat)
      m.visible = false
      return m
    }
    for (const t of f.tiles) t.hi = make(t, templates.hi, materials.hi)
    for (const c of f.chunks) c.lo = make(c, templates.lo, c.spit ? materials.loSpit : materials.lo)
    return f
  }, [density, templates, materials])

  useEffect(
    () => () => [...field.tiles.map((t) => t.hi), ...field.chunks.map((c) => c.lo)].forEach((m) => m.geometry.dispose()),
    [field],
  )

  // Let the ground paint a grass carpet where blades stop.
  useEffect(() => {
    shared.uGrassFar.value = loDist
    shared.uGrassHi.value = hiDist
  }, [loDist, hiDist])

  useFrame(({ camera }) => updateField(field, camera.position, hiDist, loDist))

  const group = useRef()
  const field_ = useRef()
  useEffect(() => {
    const g = group.current
    const f = field_.current
    hideInReflection.add(g)
    neverReflected.add(f)
    return () => {
      hideInReflection.delete(g)
      neverReflected.delete(f)
    }
  }, [])

  // Field grass in its own group (left out of the sea reflection, see world.neverReflected).
  return (
    <group ref={group}>
      <group ref={field_}>
        {field.tiles.filter((t) => !t.spit).map((t, i) => <primitive key={`t${i}`} object={t.hi} />)}
        {field.chunks.filter((c) => !c.spit).map((c, i) => <primitive key={`c${i}`} object={c.lo} />)}
      </group>
      {field.tiles.filter((t) => t.spit).map((t, i) => <primitive key={`st${i}`} object={t.hi} />)}
      {field.chunks.filter((c) => c.spit).map((c, i) => <primitive key={`sc${i}`} object={c.lo} />)}
    </group>
  )
}
