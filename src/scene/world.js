import * as THREE from 'three'
import { reducedMotion } from '../quality'

// Sun sits about 11 degrees right of straight ahead, just on the horizon.
export const SUN_DIR = new THREE.Vector3(Math.sin(0.192), 0.012, -Math.cos(0.192)).normalize()

// Origin of the piano group: front edge of the keyboard. The body extends 2.3 m along +x.
export const PIANO_POS = new THREE.Vector3(-2.55, 0, 3.7)

// Wavy shoreline: grass grows where z > shoreZ(x).
export const shoreZ = (x) => -8 + Math.sin(x * 0.15) * 1.2 + Math.sin(x * 0.37 + 1.3) * 0.5

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
  grassTip: '#6a64b8',
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
  uFogDensity: { value: 0.0042 },
  uPianoPos: { value: PIANO_POS.clone().add(new THREE.Vector3(1.1, 0, 0)) },
  uPianoGlow: { value: c(palette.pianoGlow) },
  uGlowPulse: { value: 1 },
}

export const color = c
