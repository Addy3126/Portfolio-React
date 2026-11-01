import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { motion } from '../store'
import { reducedMotion } from '../quality'
import { shared } from './world'

// Projects the mouse onto the field so the grass can part around it (mouse only).
export default function CursorField() {
  const tools = useMemo(
    () => ({ ray: new THREE.Raycaster(), ndc: new THREE.Vector2(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit: new THREE.Vector3(), target: new THREE.Vector2(999, 999) }),
    [],
  )

  useFrame(({ camera }, dt) => {
    const { ray, ndc, plane, hit, target } = tools
    let want = 0
    if (!reducedMotion && motion.pointerInside && performance.now() - motion.pointerMovedAt < 2500) {
      ndc.set(motion.pointerX, motion.pointerY)
      ray.setFromCamera(ndc, camera)
      if (ray.ray.intersectPlane(plane, hit) && hit.distanceTo(camera.position) < 25) {
        target.set(hit.x, hit.z)
        want = 1
      }
    }
    const cur = shared.uCursor.value
    if (cur.x > 900) cur.copy(target)
    else cur.lerp(target, Math.min(1, dt * 10))
    shared.uCursorStrength.value += (want - shared.uCursorStrength.value) * Math.min(1, dt * 4)
  })

  return null
}
