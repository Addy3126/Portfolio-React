import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { Fn, cubeTexture, dot, exp, float, floor, fract, length, max, mix, normalize, positionLocal, pow, sin, smoothstep, step, vec3 } from 'three/tsl'
import { lookNew } from '../quality'
import { color, palette } from '../scene/world'
import { hash12, u } from './tsl'

// Sky, as the WebGL sky, in two parts:
// 1. Baked once into a small cube map: the gradient and the sunset glow. The same cube
//    lights the scene (scene.environment; node materials prefilter it themselves).
// 2. Live: a lookup of that cube plus the sun disc and twinkling stars.
const c = (hex) => vec3(...color(hex).toArray())

const bakeColor = Fn(() => {
  const d = normalize(positionLocal)
  const h = d.y
  const hc = max(h, 0.0)
  const sd = max(dot(d, u.sunDir), 0.0)

  const col = mix(c(palette.horizon), c(palette.mid), smoothstep(0.0, 0.07, hc)).toVar()
  col.assign(mix(col, c(palette.upper), smoothstep(0.07, 0.3, hc)))
  col.assign(mix(col, c(palette.zenith), smoothstep(0.3, 0.8, hc)))
  col.assign(mix(col, c(palette.mid), float(1.0).sub(pow(sd, 3.0)).mul(float(1.0).sub(smoothstep(0.0, 0.1, hc))).mul(0.7)))
  col.addAssign(c(palette.glow).mul(exp(hc.mul(-14.0))).mul(float(0.05).add(pow(sd, 9.0).mul(0.75))))
  col.addAssign(c(palette.glow).mul(pow(sd, 40.0)).mul(0.6))

  // Below the horizon: blend into the fog colour the far sea fades to.
  const below = mix(u.fogColor, u.fogGlow, pow(sd, 8.0).mul(0.7))
  col.assign(mix(col, below, float(1.0).sub(smoothstep(-0.01, 0.0, h))))
  return col
})

// A smooth gradient: a small cube holds it (the sun disc and halo are drawn live).
const CUBE_SIZE = 256

export default function SkyGPU() {
  const mesh = useRef()
  const { gl, scene } = useThree()

  const { target, material } = useMemo(() => {
    const target = new THREE.CubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false })
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
    const sky = cubeTexture(target.texture)
    m.colorNode = Fn(() => {
      const d = normalize(positionLocal)
      const col = sky.sample(d).rgb.toVar()
      const h = d.y
      const sd = max(dot(d, u.sunDir), 0.0)
      // Stars, fading out near the sun and the horizon.
      const sp = d.xz.div(d.y.add(0.35)).mul(140.0)
      const r = hash12(floor(sp))
      const star = step(0.986, r).mul(float(1.0).sub(smoothstep(0.0, 0.12, length(fract(sp).sub(0.5)))))
      const tw = float(0.55).add(sin(u.time.mul(r.mul(3.0).add(1.0)).add(r.mul(60.0))).mul(0.45))
      col.addAssign(vec3(0.85, 0.85, 1.0).mul(star).mul(tw).mul(smoothstep(0.08, 0.35, h)).mul(float(1.0).sub(pow(sd, 3.0))))
      // Sun disc.
      const disc = smoothstep(0.99955, 0.99975, sd).mul(smoothstep(-0.004, 0.003, h))
      col.addAssign(vec3(7.0, 6.4, 6.2).mul(disc))
      col.addAssign(vec3(1.6, 1.3, 1.35).mul(pow(sd, 500.0)))
      if (lookNew) {
        // Warm atmospheric glow round the low sun: a tight corona and a wide soft halo.
        col.addAssign(
          vec3(1.0, 0.8, 0.74)
            .mul(pow(sd, 2500.0).mul(1.1).add(pow(sd, 90.0).mul(0.16)))
            .mul(smoothstep(-0.03, 0.01, h)),
        )
      }
      // Salt-spray haze just above the horizon, so sea and sky meet softly.
      const haze = exp(max(h, 0.0).mul(-38.0)).mul(smoothstep(-0.02, 0.0, h))
      col.assign(mix(col, mix(u.fogColor, u.fogGlow, pow(sd, 6.0).mul(0.8)).mul(1.06), haze.mul(0.42)))
      return col
    })()
    return { target, material: m }
  }, [])

  // Bake the sky once; the same cube lights the scene.
  useEffect(() => {
    const bakeScene = new THREE.Scene()
    const bakeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
    bakeMat.colorNode = bakeColor()
    const sphere = new THREE.SphereGeometry(10, 64, 32)
    bakeScene.add(new THREE.Mesh(sphere, bakeMat))
    new THREE.CubeCamera(0.1, 100, target).update(gl, bakeScene)
    bakeMat.dispose()
    sphere.dispose()
    scene.environment = target.texture
    scene.environmentIntensity = 0.9
    return () => {
      scene.environment = null
    }
  }, [gl, scene, target])

  useEffect(() => () => target.dispose(), [target])
  useFrame(({ camera }) => mesh.current.position.copy(camera.position))

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1500, 64, 32]} />
    </mesh>
  )
}
