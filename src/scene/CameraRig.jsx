import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { motion } from '../store'
import { reducedMotion } from '../quality'
import { SUN_DIR } from './world'

const v = (x, y, z) => new THREE.Vector3(x, y, z)
const contactPos = v(6, 0.7, -10)

// Camera stops, one per section. `portrait` overrides apply on tall screens.
export const SHOTS = [
  { pos: v(0, 1.0, 9), look: v(6, 2.6, -120), portrait: { pos: v(-1.5, 1.15, 10.8), look: v(-0.4, 2.7, -120) } },
  { pos: v(-5.2, 1.35, 8.2), look: v(2.5, 1.0, -6), portrait: { pos: v(-4.6, 1.5, 9.6), look: v(-1.6, 0.9, 3.6) } },
  { pos: v(52, 9, -122), look: v(93, 15, -222), portrait: { pos: v(70, 10, -150), look: v(93, 14, -222) } },
  {
    pos: contactPos,
    look: contactPos.clone().addScaledVector(SUN_DIR, 200).add(v(0, 9, 0)),
  },
]

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const tmpPos = new THREE.Vector3()
const tmpLook = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3(0, 1, 0)

function shot(i, portrait) {
  const s = SHOTS[i]
  return portrait && s.portrait ? s.portrait : s
}

export default function CameraRig() {
  const parallax = useRef({ x: 0, y: 0 })

  useFrame(({ camera, size, clock }) => {
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

    if (!reducedMotion) {
      const px = parallax.current
      px.x += (motion.pointerX - px.x) * 0.06
      px.y += (motion.pointerY - px.y) * 0.06
      right.subVectors(tmpLook, tmpPos).cross(up).normalize()
      const sway = Math.sin((clock.elapsedTime * Math.PI * 2) / 14) * 0.05
      tmpPos.addScaledVector(right, px.x * 0.25 + sway)
      tmpPos.y += px.y * 0.1
    }

    camera.position.copy(tmpPos)
    camera.lookAt(tmpLook)
  })

  return null
}
