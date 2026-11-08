import * as THREE from 'three'
import { reducedMotion } from '../quality'

// Sun sits about 11 degrees right of straight ahead, just on the horizon.
export const SUN_DIR = new THREE.Vector3(Math.sin(0.192), 0.012, -Math.cos(0.192)).normalize()

// Origin of the piano group: front edge of the keyboard. The body extends 2.3 m along +x.
export const PIANO_POS = new THREE.Vector3(-2.55, 0, 3.7)

// Coastline. Keep in sync with shoreGLSL in glsl.js.
// Front shore: a wavy line, plus a grassy spit reaching out toward the ruins on the right.
export const shoreZ = (x) => -8 + Math.sin(x * 0.15) * 1.2 + Math.sin(x * 0.37 + 1.3) * 0.5
// Left bank: the field ends at a water channel.
export const bankX = (z) => -22 - 1.5 * Math.sin(z * 0.13) - 0.8 * Math.sin(z * 0.41 + 2.0)
// Main field only (positive = on land).
export const rightX = (z) => 58 + 3 * Math.sin(z * 0.17) + 1.5 * Math.sin(z * 0.5 + 1)
export const mainDist = (x, z) => Math.min(z - shoreZ(x), x - bankX(z), rightX(z) - x)

// The spit: a sandy, rocky strip that leaves the field, wanders out and curves right.
export const spitPoint = (t) => [16 + 6 * Math.sin(t * 3.0) + 22 * t * t, -5 - 48 * t]
export const spitHalfWidth = (t) => 2.2 + 8.5 * Math.pow(1 - t, 0.8) + 0.9 * Math.sin(t * 13.0)
const SPIT_N = 24
export function spitDist(x, z) {
  let best = -1e9
  let prev = spitPoint(0)
  for (let i = 1; i <= SPIT_N; i++) {
    const t1 = i / SPIT_N
    const cur = spitPoint(t1)
    const ex = cur[0] - prev[0]
    const ez = cur[1] - prev[1]
    const h = Math.min(1, Math.max(0, ((x - prev[0]) * ex + (z - prev[1]) * ez) / (ex * ex + ez * ez)))
    const d = Math.hypot(x - prev[0] - ex * h, z - prev[1] - ez * h)
    best = Math.max(best, spitHalfWidth((i - 1 + h) / SPIT_N) - d)
    prev = cur
  }
  return best
}
// Metres from the nearest waterline (negative = under water).
// Smooth union of the field and the spit, so the coast flows round where they meet.
const SHORE_BLEND = 9
function smax(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k))
  return b + (a - b) * h + k * h * (1 - h)
}
export const landDist = (x, z) => smax(mainDist(x, z), spitDist(x, z), SHORE_BLEND)
// Grass stops this far inland from the waterline, leaving a strip of beach.
export const BEACH_WIDTH = 3.2
// Centre of the piano case in world x/z.
export const PIANO_CENTRE = new THREE.Vector3(PIANO_POS.x + 1.1, 0.8, PIANO_POS.z)
// Light direction used for the piano's shadow: the sun's bearing, raised so the shadow stays compact.
export const SHADOW_DIR = new THREE.Vector3(SUN_DIR.x, 0.55, SUN_DIR.z).normalize()

export const palette = {
  zenith: '#0b0e2d',
  upper: '#171448',
  mid: '#3a2f7a',
  horizon: '#d9a6c8',
  glow: '#f5c8d0',
  aurora1: '#4f5dff',
  aurora2: '#a37bff',
  seaNear: '#2a35a8',
  seaFar: '#6e62a8',
  ruin: '#1e1525',
  headland: '#0e102e',
  grassBase: '#121640',
  grassTip: '#9a94d8',
  frost: '#e6dcff',
  pianoGlow: '#6f9bff',
  fog: '#3b3280',
}

const c = (hex) => new THREE.Color(hex)

// Uniforms shared by every custom shader, so time, sun and fog stay in sync.
export const shared = {
  uTime: { value: 0 },
  uMotion: { value: reducedMotion ? 0.25 : 1 },
  uSunDir: { value: SUN_DIR },
  uFogColor: { value: c(palette.fog) },
  uFogGlow: { value: c(palette.glow) },
  uFogDensity: { value: 0.0011 }, // ~5% at the towers, ~90% at the far edge of the sea
  uPianoPos: { value: PIANO_POS.clone().add(new THREE.Vector3(1.1, 0, 0)) },
  uPianoGlow: { value: c(palette.pianoGlow) },
  uGlowPulse: { value: 1 },
  // Piano shadow map (white placeholder until the real one is rendered).
  uShadowMap: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t })() },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uBeachMap: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t })() },
  uBeachMatrix: { value: new THREE.Matrix4() },
  // Cursor position on the field (x/z) and how strongly grass parts around it.
  uCursor: { value: new THREE.Vector2(999, 999) },
  uCursorStrength: { value: 0 },
  // Distance from the camera where grass blades stop; the ground paints a carpet beyond.
  uGrassFar: { value: 999 },
  // Rings of light spreading over the field from the piano on each note: start times (in
  // uTime) and strengths of the last four.
  uRippleT: { value: new THREE.Vector4(-1e4, -1e4, -1e4, -1e4) },
  uRippleA: { value: new THREE.Vector4() },
  uGrassHi: { value: 0 },
  // Colour grade (scene/grade.js): highlight and shadow tints, contrast curve strength.
  uGradeHigh: { value: new THREE.Vector3(1.07, 1.0, 0.93) },
  uGradeShadow: { value: new THREE.Vector3(0.9, 0.94, 1.08) },
  uGradeCurve: { value: 0.22 },
}

export const color = c

// Objects skipped in the water reflection pass (too costly, barely visible there).
export const hideInReflection = new Set()
// Skipped there on every tier: what stands on the field behind the shore (grass, beds, the
// piano, the shore plants), which the mirrored view, looking up and away from the cameras,
// can never see (only the spit runs out into the sea), yet cost as much to draw there as on
// screen. Layer NEVER_REFLECTED: the main cameras and the pointer raycaster have it, the
// reflection cameras don't. The WebGL grass and beds use the set instead (hidden around the
// reflection render), since they must stay in the piano's environment capture there.
export const NEVER_REFLECTED = 3
export const neverReflected = new Set()
