import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR, shared } from './world'

// Baked sun shadows of the stones and rocks on the beach and the spit: their depth is
// rendered once from the low sun (lifted a little so the shadows stay a few times the
// stones' height rather than running off to the horizon) and the ground samples it. Static
// scene, so it costs nothing per frame.
export const BEACH_LAYER = 3
const SIZE = 2048
const ELEV = 0.3
export const BEACH_DIR = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize().multiplyScalar(Math.cos(ELEV)).setY(Math.sin(ELEV))
export const BEACH_CENTRE = new THREE.Vector3(14, 0, -30)
export const BEACH_HALF = 46 // metres covered each side of the centre
const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

export function beachCamera(OrthographicCamera) {
  const camera = new OrthographicCamera(-BEACH_HALF, BEACH_HALF, BEACH_HALF, -BEACH_HALF, 1, 200)
  camera.position.copy(BEACH_CENTRE).addScaledVector(BEACH_DIR, 90)
  camera.lookAt(BEACH_CENTRE)
  camera.updateMatrixWorld()
  camera.layers.set(BEACH_LAYER)
  return camera
}

export default function BeachShadow() {
  const { gl, scene } = useThree()
  const done = useRef(0)
  const { target, camera } = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true })
    target.depthTexture = new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType)
    return { target, camera: beachCamera(THREE.OrthographicCamera) }
  }, [])
  useEffect(() => () => target.dispose(), [target])

  useFrame(() => {
    if (done.current > 3) return
    if (++done.current < 3) return
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
    shared.uBeachMap.value = target.depthTexture
    shared.uBeachMatrix.value.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
  })
  return null
}
