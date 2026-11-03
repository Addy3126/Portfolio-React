import { useEffect, useRef, useState } from 'react'
import { texturesReady } from '../textureReady'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { Fn, If, float, texture, uniform, vec2, vec4 } from 'three/tsl'
import { SHADOW_LAYER } from '../scene/PianoShadow'
import { beachCamera } from '../scene/BeachShadow'
import { PIANO_CENTRE, SHADOW_DIR } from '../scene/world'

// The piano's cast shadow on the WebGPU path, as scene/PianoShadow on WebGL: its depth is
// rendered once from the shadow direction (the piano never moves) and the ground and grass
// sample it with a 5x5 PCF kernel.
const SIZE = 1024
const target = new THREE.RenderTarget(SIZE, SIZE, { depthBuffer: true })
target.depthTexture = new THREE.DepthTexture(SIZE, SIZE)
const shadowMatrix = uniform(new THREE.Matrix4())
const shadowOn = uniform(0)
const depthTex = texture(target.depthTexture)

// 1 = lit, 0 = in the piano's shadow.
export const pianoShadow = Fn(([wp]) => {
  const lit = float(1.0).toVar()
  const sc = shadowMatrix.mul(vec4(wp, 1.0))
  const p = sc.xyz.div(sc.w).toVar()
  If(
    shadowOn.greaterThan(0.5).and(p.x.greaterThan(0.0)).and(p.x.lessThan(1.0)).and(p.y.greaterThan(0.0)).and(p.y.lessThan(1.0)).and(p.z.lessThan(1.0)),
    () => {
      const sum = float(0.0).toVar()
      const r = 1.0 / 512.0
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const d = depthTex.sample(p.xy.add(vec2(i * r, j * r))).level(0).x
          sum.addAssign(p.z.sub(0.003).greaterThan(d).select(0.0, 1.0))
        }
      }
      lit.assign(sum.div(25.0))
    },
  )
  return lit
})

export function PianoShadowGPU() {
  const { gl, scene } = useThree()
  const done = useRef(0)
  const camera = useRef(null)
  if (!camera.current) {
    const cam = new THREE.OrthographicCamera(-4, 4, 4, -4, 1, 30)
    cam.position.copy(PIANO_CENTRE).addScaledVector(SHADOW_DIR, 14)
    cam.lookAt(PIANO_CENTRE)
    cam.updateMatrixWorld()
    cam.layers.set(SHADOW_LAYER)
    camera.current = cam
  }

  useFrame(() => {
    // Wait a couple of frames so the piano has mounted, then render once.
    if (done.current > 2) return
    if (++done.current < 2) return
    const cam = camera.current
    const override = scene.overrideMaterial
    const background = scene.background
    scene.overrideMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
    scene.background = null
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, cam)
    gl.setRenderTarget(prev)
    scene.overrideMaterial.dispose()
    scene.overrideMaterial = override
    scene.background = background
    // Clip space -> texture space. WebGPU's depth range is already 0..1; texture v runs
    // downward from the top.
    const webgpuDepth = cam.coordinateSystem === THREE.WebGPUCoordinateSystem
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, -0.5, 0, 0.5, 0, 0, webgpuDepth ? 1 : 0.5, webgpuDepth ? 0 : 0.5, 0, 0, 0, 1)
    shadowMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse)
    shadowOn.value = 1
  })

  useEffect(() => () => (shadowOn.value = 0), [])
  return null
}

// Baked shadows of the beach stones and rocks (as scene/BeachShadow.jsx). 1 = lit.
const BSIZE = 2048
const beachTarget = new THREE.RenderTarget(BSIZE, BSIZE, { depthBuffer: true })
beachTarget.depthTexture = new THREE.DepthTexture(BSIZE, BSIZE)
const beachMatrix = uniform(new THREE.Matrix4())
const beachOn = uniform(0)
const beachTex = texture(beachTarget.depthTexture)
export const beachShadow = Fn(([wp]) => {
  const lit = float(1.0).toVar()
  const sc = beachMatrix.mul(vec4(wp, 1.0))
  const p = sc.xyz.div(sc.w).toVar()
  If(beachOn.greaterThan(0.5).and(p.x.greaterThan(0.0)).and(p.x.lessThan(1.0)).and(p.y.greaterThan(0.0)).and(p.y.lessThan(1.0)).and(p.z.lessThan(1.0)), () => {
    const sum = float(0.0).toVar()
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const d = beachTex.sample(p.xy.add(vec2(i / BSIZE, j / BSIZE))).level(0).x
        sum.addAssign(p.z.sub(0.0008).greaterThan(d).select(0.0, 1.0))
      }
    }
    lit.assign(sum.div(9.0))
  })
  return lit
})

export function BeachShadowGPU() {
  const { gl, scene } = useThree()
  const done = useRef(0)
  // Wait for the streamed-in casters (scanned boulders) before baking.
  const [ready, setReady] = useState(false)
  useEffect(() => void texturesReady().then(() => setReady(true)), [])
  const camera = useRef(null)
  if (!camera.current) camera.current = beachCamera(THREE.OrthographicCamera)
  useFrame(() => {
    if (!ready || done.current > 3) return
    if (++done.current < 3) return
    const cam = camera.current
    const override = scene.overrideMaterial
    const background = scene.background
    scene.overrideMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
    scene.background = null
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(beachTarget)
    gl.clear()
    gl.render(scene, cam)
    gl.setRenderTarget(prev)
    scene.overrideMaterial.dispose()
    scene.overrideMaterial = override
    scene.background = background
    const webgpuDepth = cam.coordinateSystem === THREE.WebGPUCoordinateSystem
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, -0.5, 0, 0.5, 0, 0, webgpuDepth ? 1 : 0.5, webgpuDepth ? 0 : 0.5, 0, 0, 0, 1)
    beachMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse)
    beachOn.value = 1
  })
  useEffect(() => () => (beachOn.value = 0), [])
  return null
}
