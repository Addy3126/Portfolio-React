import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rocksVersion } from './ScannedRocks'

// The cool fill light from behind the cameras (left, low), which is what models the rock
// faces we see: the sun is behind them. It casts the rocks' shadows (ledges darkening the
// face below, rocks shading each other), rendered once into a static shadow map covering
// the beach, the spit and the headland, and again whenever the rocks change.
const DIR = new THREE.Vector3(-6, 4, 12).normalize()
const CENTRE = new THREE.Vector3(120, 0, -150)

export default function FillLight({ shadowSize = 0 }) {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight('#9a9cec', 1.9)
    l.position.copy(CENTRE).addScaledVector(DIR, 500)
    l.target.position.copy(CENTRE)
    l.target.updateMatrixWorld()
    if (shadowSize) {
      l.castShadow = true
      l.shadow.mapSize.set(shadowSize, shadowSize)
      Object.assign(l.shadow.camera, { left: -190, right: 190, top: 150, bottom: -150, near: 300, far: 720 })
      l.shadow.camera.updateProjectionMatrix()
      l.shadow.bias = -0.0004
      l.shadow.normalBias = 0.04
      l.shadow.autoUpdate = false
      l.shadow.needsUpdate = true
    }
    return l
  }, [shadowSize])
  useEffect(() => () => light.shadow?.dispose(), [light])

  const seen = useRef(-1)
  useFrame(() => {
    if (shadowSize && seen.current !== rocksVersion.value) {
      seen.current = rocksVersion.value
      light.shadow.needsUpdate = true
    }
  })

  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  )
}
