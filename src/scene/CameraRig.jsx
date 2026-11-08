import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { motion } from '../store'
import { updateGrade } from './grade'
import { lookNew, reducedMotion } from '../quality'
import { PIANO_POS, SUN_DIR } from './world'
import { WHITE_MIDI, piano } from '../piano/engine'
import { facades, focus } from '../focus'

const v = (x, y, z) => new THREE.Vector3(x, y, z)
const contactPos = v(31, 1.3, -38) // out on the spit, its rocky end in the middle distance

// Camera stops, one per section. `portrait` overrides apply on tall screens.
export const SHOTS = [
  {
    pos: v(0, 1.0, 9),
    look: v(6, 2.6, -120),
    portrait: { pos: v(-1.5, 1.15, 10.8), look: v(-0.4, 2.7, -120) },
  },
  // About: close on the piano set (bench at left, lid at right), clear of the text panel.
  {
    pos: v(-4.4, 1.6, 6.3),
    look: v(-2.6, 0.85, 3.3),
    portrait: { pos: v(-4.4, 1.7, 8.7), look: v(-1.9, 0.3, 3.6) },
  },
  // Projects. The new look comes low over the water and takes in all three project towers,
  // the far spire included, from 16:10 to ultrawide screens (the list sits above the spire).
  lookNew
    ? { pos: v(60, 6, -120), look: v(77, 15, -230), portrait: { pos: v(75, 16, -40), look: v(112, 15, -230) } }
    : {
        pos: v(70, 9, -120),
        look: v(87, 15, -218),
        portrait: { pos: v(75, 16, -40), look: v(112, 15, -230) },
      },
  {
    pos: contactPos,
    look: contactPos
      .clone()
      .addScaledVector(SUN_DIR, 200)
      .add(v(0, 9, 0)),
  },
]

// Debug: ?cam=x,y,z,lookX,lookY,lookZ pins the camera (handy for inspecting the scene).
const debugCam = (() => {
  const v = new URLSearchParams(window.location.search).get('cam')
  const n = v ? v.split(',').map(Number) : []
  return n.length === 6 && n.every(Number.isFinite)
    ? {
        pos: new THREE.Vector3(n[0], n[1], n[2]),
        look: new THREE.Vector3(n[3], n[4], n[5]),
      }
    : null
})()

// Play mode: seated at the keyboard, looking down the keys with the music desk ahead. The
// look point sits below the keys so they land in the upper-middle of the frame, clear of
// the controls along the bottom. On tall (phone) screens the whole keyboard would leave
// each key a few pixels wide, so the camera comes close over the playable octave and a
// half instead, and pans along the keys as the octave changes.
const PLAY = {
  pos: v(-3.3, 1.42, 3.7),
  look: v(-2.3, 0.3, 3.7),
  portrait: { pos: v(-3.0, 1.38, 0), look: v(-2.5, 0.44, 0) },
}
const KEY_W = 1.22 / 52
const playZ = () => PIANO_POS.z - 0.61 + (WHITE_MIDI.indexOf(12 * (piano.octave + 1)) + 5.5) * KEY_W

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const tmpPos = new THREE.Vector3()
const tmpLook = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3(0, 1, 0)

// Walking up to a project tower (focus.js): where the camera stands for each stage. The
// face, or the opening, is fitted to the screen at the current aspect; on phones the lower
// part of the screen holds the project's text, so the tower sits in the upper part.
const FIT = { facade: 1, opening: 0.72, inside: 0.72 }
function towerPose(project, stage, aspect, fovDeg, portrait, pos, look) {
  const f = facades.get(project)
  if (!f) return false
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
  const tanH = tanV * aspect
  const frac = portrait ? 0.56 : 1
  if (stage === 'facade') {
    const W = f.width + 3
    const H = f.height + 2.6
    const dist = Math.max(H / frac / 2 / tanV, W / 2 / tanH)
    look.set(f.center.x, f.center.y - (H / frac - H) / 2, f.frontZ)
    pos.set(f.center.x, f.center.y - 1.2, f.frontZ + dist)
  } else {
    const o = f.opening
    let dist = Math.max(o.h / FIT[stage] / frac / 2 / tanV, o.w / FIT[stage] / 2 / tanH)
    if (stage === 'inside') dist *= 0.45 // pushing in as the panel opens
    look.set(o.center.x, o.center.y - (portrait ? (o.h / frac - o.h) / 2 : 0), f.frontZ)
    pos.set(o.center.x, o.center.y - 0.3, f.frontZ + dist)
  }
  return true
}
const ride = { key: null, active: false, t0: 0, dur: 0, arc: 0, from: { pos: new THREE.Vector3(), look: new THREE.Vector3() } }
const last = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
const tgtPos = new THREE.Vector3()
const tgtLook = new THREE.Vector3()

function shot(i, portrait) {
  const s = SHOTS[i]
  return portrait && s.portrait ? s.portrait : s
}

export default function CameraRig() {
  const parallax = useRef({ x: 0, y: 0 })
  const play = useRef(0)
  const panZ = useRef(null)

  useFrame(({ camera, size, clock }, dt) => {
    const aspect = size.width / size.height
    const portrait = aspect < 1
    const fov = aspect < 1 ? 62 : aspect < 1.6 ? 50 : 42
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    const p = THREE.MathUtils.clamp(motion.progress, 0, SHOTS.length - 1)
    const i = Math.min(Math.floor(p), SHOTS.length - 2)
    const t = ease(p - i)
    const a = shot(i, portrait)
    const b = shot(i + 1, portrait)
    tmpPos.lerpVectors(a.pos, b.pos, t)
    tmpLook.lerpVectors(a.look, b.look, t)

    // Arc upward between distant stops so the flight clears the field.
    tmpPos.y += Math.sin(t * Math.PI) * a.pos.distanceTo(b.pos) * 0.06

    // Into play mode and back: an eased move (a cut with reduced motion).
    const want = motion.playing ? 1 : 0
    play.current = reducedMotion ? want : play.current + (want - play.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.2))
    const pk = ease(play.current)
    const freeLook = 1 - pk

    if (!reducedMotion) {
      const px = parallax.current
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3.7) // same feel at any frame rate
      px.x += (motion.pointerX - px.x) * k
      px.y += (motion.pointerY - px.y) * k
      right.subVectors(tmpLook, tmpPos).cross(up).normalize()
      const sway = Math.sin((clock.elapsedTime * Math.PI * 2) / 14) * 0.05
      tmpPos.addScaledVector(right, (px.x * 0.25 + sway) * freeLook)
      tmpPos.y += px.y * 0.1 * freeLook
    }
    if (pk > 1e-4) {
      let ps = PLAY
      if (portrait) {
        const z = playZ()
        panZ.current = panZ.current === null || reducedMotion ? z : panZ.current + (z - panZ.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 4))
        ps = PLAY.portrait
        ps.pos.z = ps.look.z = panZ.current
      }
      tmpPos.lerp(ps.pos, pk)
      tmpLook.lerp(ps.look, pk)
    }

    // At a project tower: an eased move from wherever the camera was to the stop for the
    // current stage (or back to the section's shot), arcing a little over the water on long
    // glides. Longer moves take longer.
    const key = focus.project === null ? 'bay' : `${focus.project}:${focus.stage}`
    const now = performance.now()
    if (key !== ride.key) {
      if (ride.key !== null) {
        ride.from.pos.copy(last.pos)
        ride.from.look.copy(last.look)
        ride.t0 = now
        ride.dur = 0
        ride.active = true
      }
      ride.key = key
    }
    if (ride.active || key !== 'bay') {
      if (key === 'bay') {
        tgtPos.copy(tmpPos)
        tgtLook.copy(tmpLook)
      } else if (!towerPose(focus.project, focus.stage, aspect, fov, portrait, tgtPos, tgtLook)) {
        tgtPos.copy(last.pos)
        tgtLook.copy(last.look)
      }
      if (!ride.dur) {
        const d = ride.from.pos.distanceTo(tgtPos)
        ride.dur = focus.stage === 'inside' ? 0.8 : focus.stage === 'opening' ? 1.2 : THREE.MathUtils.clamp(1.3 + d / 90, 1.2, 4.2)
        ride.arc = Math.min(6, d * 0.04)
      }
      const k = reducedMotion ? 1 : Math.min(1, (now - ride.t0) / (ride.dur * 1000))
      const e = ease(k)
      tmpPos.lerpVectors(ride.from.pos, tgtPos, e)
      tmpPos.y += Math.sin(e * Math.PI) * ride.arc
      tmpLook.lerpVectors(ride.from.look, tgtLook, e)
      if (key === 'bay') {
        if (k >= 1) ride.active = false
      } else {
        if (k >= 0.82 && !focus.arrivedAt) focus.arrivedAt = now // the windows start as it settles
        // A little parallax at the tower, so the windows and the opening have depth.
        if (!reducedMotion && focus.stage !== 'inside') {
          right.subVectors(tmpLook, tmpPos).cross(up).normalize()
          const px = parallax.current
          tmpPos.addScaledVector(right, px.x * 0.35 * e)
          tmpPos.y += px.y * 0.15 * e
        }
      }
    }
    last.pos.copy(tmpPos)
    last.look.copy(tmpLook)

    if (debugCam) {
      tmpPos.copy(debugCam.pos)
      tmpLook.copy(debugCam.look)
    }
    camera.position.copy(tmpPos)
    camera.lookAt(tmpLook)
    updateGrade(p) // the colour grade follows the camera between sections
  })

  return null
}
