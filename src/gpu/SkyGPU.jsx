import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  clamp,
  cubeTexture,
  dot,
  exp,
  float,
  floor,
  fract,
  int,
  length,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { tier } from '../quality'
import { DRIFT, useCloudDrift } from '../scene/cloudDrift'
import { color, palette } from '../scene/world'
import { fbm3g, hash12, u, vnoise3 } from './tsl'

// Sky, as the WebGL sky, in two parts:
// 1. Baked once into a cube map: the gradient, the sunset glow and ray-marched clouds lit
//    with Beer's law, the powder term and a two-lobe Henyey-Greenstein phase. Alpha stores
//    how much open sky shows through the clouds. The same cube lights the scene
//    (scene.environment; node materials prefilter it themselves).
// 2. Live: a lookup of that cube plus the sun disc and twinkling stars, hidden by clouds.
const c = (hex) => vec3(...color(hex).toArray())
const SLAB0 = 1.0
const SLAB1 = 1.55
const PI = Math.PI

const hg = Fn(([cs, g]) => {
  const g2 = g.mul(g)
  return float(1.0).sub(g2).div(pow(float(1.0).add(g2).sub(g.mul(2.0).mul(cs)), 1.5).mul(4.0 * PI))
})

function densityFn(detail) {
  return Fn(([p, cov]) => {
    const h = p.y.sub(SLAB0).div(SLAB1 - SLAB0)
    const profile = smoothstep(0.0, 0.12, h).mul(float(1.0).sub(smoothstep(0.45, 1.0, h)))
    const pp = p.add(cloudShift) // the field drifts downwind (see scene/cloudDrift.js)
    const q = vec3(pp.x, pp.y.mul(2.2), pp.z)
    const base = fbm3g(q.mul(0.62).add(vec3(3.1, 0.0, 1.7)))
    const d = base.sub(float(1.0).sub(cov)).div(max(cov, 0.05)).mul(1.6).toVar()
    d.assign(d.mul(profile).sub(float(1.0).sub(profile).mul(0.35)))
    if (detail) {
      If(d.greaterThan(0.0), () => {
        d.subAssign(vnoise3(q.mul(3.4).add(7.0)).mul(0.6).add(vnoise3(q.mul(8.0).sub(3.0)).mul(0.4)).mul(0.45).mul(float(1.0).sub(d)))
      })
    }
    return clamp(d, 0.0, 1.0)
  })
}
const density = densityFn(true)
const densityLo = densityFn(false)

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

  const T = float(1.0).toVar()
  If(h.greaterThan(0.004), () => {
    const t0 = float(SLAB0).div(h)
    const t1 = min(float(SLAB1).div(h), t0.add(30.0))
    const STEPS = 22
    const dt = t1.sub(t0).div(STEPS)
    const cov = float(0.36).add(exp(hc.mul(-5.0)).mul(0.2)).add(pow(sd, 2.0).mul(0.12))
    const cosA = dot(d, u.sunDir)
    const phase = mix(hg(cosA, float(0.62)), hg(cosA, float(-0.2)), 0.3).mul(4.0 * PI)
    const sunCol = c(palette.glow).mul(vec3(1.2, 0.98, 0.85)).mul(1.7)
    const scat = vec3(0.0).toVar()
    const SIGMA = 9.0
    Loop({ start: int(0), end: int(STEPS), type: 'int', condition: '<' }, ({ i }) => {
      const t = t0.add(float(i).add(0.5).mul(dt))
      const p = d.mul(t)
      const den = density(p, cov)
      // Only where there is cloud, and until the view is all but blocked. (A guard rather
      // than continue/break: TSL emits those so that WGSL warns of unreachable code.)
      If(den.greaterThan(0.003).and(T.greaterThanEqual(0.02)), () => {
        // Light march toward the sun (cheap density).
        const od = float(0.0).toVar()
        const lp = vec3(p).toVar()
        for (let j = 1; j <= 5; j++) {
          lp.addAssign(u.sunDir.mul(0.09 * j))
          od.addAssign(densityLo(lp, cov).mul(0.09 * j))
        }
        const odS = od.mul(SIGMA * 1.7)
        const beer = exp(odS.negate())
        const powder = float(1.0).sub(exp(odS.mul(-2.0)))
        const lightE = beer.mul(mix(1.0, powder.mul(2.0), 0.5))
        const hf = clamp(p.y.sub(SLAB0).div(SLAB1 - SLAB0), 0.0, 1.0)
        const ambient = mix(c(palette.cloud).mul(0.32), c(palette.cloudLit).mul(0.38), hf.mul(hf)).add(c(palette.upper).mul(0.12))
        const S = sunCol.mul(lightE).mul(phase).add(ambient)
        const a = exp(den.mul(SIGMA).mul(dt).negate())
        scat.addAssign(S.mul(T).mul(float(1.0).sub(a)))
        T.mulAssign(a)
      })
    })
    const fade = smoothstep(0.004, 0.03, h)
    const aerial = float(1.0).sub(exp(t0.mul(-0.02)))
    const hazeCol = mix(c(palette.mid), c(palette.glow), pow(sd, 4.0).mul(0.8))
    scat.assign(mix(scat, hazeCol.mul(float(1.0).sub(T)), aerial.mul(0.55)))
    col.assign(mix(col, col.mul(T).add(scat), fade))
    T.assign(mix(1.0, T, fade))
  })
  const below = mix(u.fogColor, u.fogGlow, pow(sd, 8.0).mul(0.7))
  col.assign(mix(col, below, float(1.0).sub(smoothstep(-0.01, 0.0, h))))
  return vec4(col, T)
})

const cloudShift = uniform(new THREE.Vector3())
const CUBE_SIZE = tier === 'low' || tier === 'minimal' ? 512 : 1024

export default function SkyGPU() {
  const mesh = useRef()
  const { gl, scene } = useThree()

  const { target, material, texA, texB, blend } = useMemo(() => {
    const target = new THREE.CubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false })
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
    const texA = cubeTexture(target.texture)
    const texB = cubeTexture(target.texture)
    const blend = uniform(0)
    m.colorNode = Fn(() => {
      const d = normalize(positionLocal)
      const sky = mix(texA.sample(d), texB.sample(d), blend)
      const col = sky.rgb.toVar()
      const clear = sky.a
      const h = d.y
      const sd = max(dot(d, u.sunDir), 0.0)
      // Stars, fading out near the sun and the horizon, hidden by clouds.
      const sp = d.xz.div(d.y.add(0.35)).mul(140.0)
      const r = hash12(floor(sp))
      const star = step(0.986, r).mul(float(1.0).sub(smoothstep(0.0, 0.12, length(fract(sp).sub(0.5)))))
      const tw = float(0.55).add(sin(u.time.mul(r.mul(3.0).add(1.0)).add(r.mul(60.0))).mul(0.45))
      col.addAssign(vec3(0.85, 0.85, 1.0).mul(star).mul(tw).mul(smoothstep(0.08, 0.35, h)).mul(float(1.0).sub(pow(sd, 3.0))).mul(clear))
      // Sun disc, dimmed where clouds pass in front of it.
      const disc = smoothstep(0.99955, 0.99975, sd).mul(smoothstep(-0.004, 0.003, h))
      col.addAssign(vec3(7.0, 6.4, 6.2).mul(disc).mul(mix(0.15, 1.0, clear)))
      col.addAssign(vec3(1.6, 1.3, 1.35).mul(pow(sd, 500.0)).mul(mix(0.4, 1.0, clear)))
      // Salt-spray haze just above the horizon, so sea and sky meet softly.
      const haze = exp(max(h, 0.0).mul(-38.0)).mul(smoothstep(-0.02, 0.0, h))
      col.assign(mix(col, mix(u.fogColor, u.fogGlow, pow(sd, 6.0).mul(0.8)).mul(1.06), haze.mul(0.42)))
      return col
    })()
    return { target, material: m, texA, texB, blend }
  }, [])

  // Bake the sky and clouds once; the same cube lights the scene. The bake scene is kept
  // for the drifting re-bakes.
  const bake = useMemo(() => {
    const bakeScene = new THREE.Scene()
    const bakeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
    bakeMat.colorNode = bakeColor()
    bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), bakeMat))
    return { bakeScene, cam: new THREE.CubeCamera(0.1, 100, target) }
  }, [target])
  const [baked, setBaked] = useState(null)
  useEffect(() => {
    cloudShift.value.set(0, 0, 0)
    bake.cam.update(gl, bake.bakeScene)
    scene.environment = target.texture
    scene.environmentIntensity = 0.9
    setBaked(target.texture)
    return () => {
      scene.environment = null
    }
  }, [gl, scene, target, bake])

  const makeTarget = useCallback((size) => new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false }), [])
  useCloudDrift({
    enabled: DRIFT,
    renderer: gl,
    cubeCamera: bake.cam,
    bakeScene: bake.bakeScene,
    setShift: (x, y, z) => cloudShift.value.set(x, y, z),
    makeTarget,
    first: baked,
    show: (a, b, t) => {
      texA.value = a
      texB.value = b
      blend.value = t
    },
  })

  useEffect(() => () => target.dispose(), [target])
  useFrame(({ camera }) => mesh.current.position.copy(camera.position))

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1500, 64, 32]} />
    </mesh>
  )
}
