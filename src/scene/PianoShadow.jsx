import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PIANO_CENTRE, SHADOW_DIR, shared } from './world'

export const SHADOW_LAYER = 1
const SIZE = 1024
const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

// Renders the piano's depth once from the shadow direction. The piano never moves,
// so the map is static; grass and ground sample it through shared uniforms.
export default function PianoShadow() {
  const { gl, scene } = useThree()
  const done = useRef(0)

  const { target, camera } = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true })
    target.depthTexture = new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType)
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 1, 30)
    camera.position.copy(PIANO_CENTRE).addScaledVector(SHADOW_DIR, 14)
    camera.lookAt(PIANO_CENTRE)
    camera.updateMatrixWorld()
    camera.layers.set(SHADOW_LAYER)
    return { target, camera }
  }, [])

  useEffect(() => () => target.dispose(), [target])

  useFrame(() => {
    // Wait a couple of frames so the piano has mounted, then render once.
    if (done.current > 2) return
    if (++done.current < 2) return
    const override = scene.overrideMaterial
    const background = scene.background
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    scene.background = null
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(prev)
    scene.overrideMaterial.dispose()
    scene.overrideMaterial = override
    scene.background = background

    shared.uShadowMap.value = target.depthTexture
    shared.uShadowMatrix.value.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
  })

  return null
}
