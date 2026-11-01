import * as THREE from 'three'
import { reducedMotion } from '../quality'

// Sun sits about 11 degrees right of straight ahead, just on the horizon.
export const SUN_DIR = new THREE.Vector3(Math.sin(0.192), 0.012, -Math.cos(0.192)).normalize()

// Origin of the piano group: front edge of the keyboard. The body extends 2.3 m along +x.
export const PIANO_POS = new THREE.Vector3(-2.55, 0, 3.7)

// Coastline. Keep in sync with shoreGLSL in glsl.js.
// Front shore: a wavy line, plus a grassy spit reaching out toward the ruins on the right.
export const shoreZ = (x) =>
  -8 + Math.sin(x * 0.15) * 1.2 + Math.sin(x * 0.37 + 1.3) * 0.5 - 46 * Math.exp(-0.5 * ((x - 24) / 13) ** 2)
// Left bank: a water channel separates the field from the rock plateau.
export const bankX = (z) => -22 - 1.5 * Math.sin(z * 0.13) - 0.8 * Math.sin(z * 0.41 + 2.0)
// Metres from the nearest waterline (negative = under water).
export const landDist = (x, z) => Math.min(z - shoreZ(x), x - bankX(z))
// Grass stops this far inland from the waterline, leaving a strip of beach.
export const BEACH_WIDTH = 0.8
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
  cloud: '#2c2768',
  cloudLit: '#a585c0',
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
  // Cursor position on the field (x/z) and how strongly grass parts around it.
  uCursor: { value: new THREE.Vector2(999, 999) },
  uCursorStrength: { value: 0 },
  // Distance from the camera where grass blades stop; the ground paints a carpet beyond.
  uGrassFar: { value: 999 },
}

export const color = c

// Objects skipped in the water reflection pass (too costly, barely visible there).
export const hideInReflection = new Set()
