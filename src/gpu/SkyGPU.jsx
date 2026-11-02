import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { Fn, cameraPosition, dot, float, floor, fract, length, max, mix, normalize, pow, positionWorld, sin, smoothstep, step, vec3 } from 'three/tsl'
import { color, palette } from '../scene/world'
import { hash12, u } from './tsl'

// Phase 0 sky: gradient, sun glow, sun disc and twinkling stars (as the WebGL sky, minus
// the baked clouds, which come in the next phase).
const c = (hex) => vec3(...color(hex).toArray())

export default function SkyGPU() {
  const mesh = useRef()
  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
    m.colorNode = Fn(() => {
      const d = normalize(positionWorld.sub(cameraPosition))
      const h = d.y
      const hc = max(h, 0.0)
      const sd = max(dot(d, u.sunDir), 0.0)
      const col = mix(c(palette.horizon), c(palette.mid), smoothstep(0.0, 0.07, hc)).toVar()
      col.assign(mix(col, c(palette.upper), smoothstep(0.07, 0.3, hc)))
      col.assign(mix(col, c(palette.zenith), smoothstep(0.3, 0.8, hc)))
      col.assign(mix(col, c(palette.mid), float(1.0).sub(pow(sd, 3.0)).mul(float(1.0).sub(smoothstep(0.0, 0.1, hc))).mul(0.7)))
      const band = hc.mul(-14.0).exp()
      col.addAssign(c(palette.glow).mul(band).mul(float(0.05).add(pow(sd, 9.0).mul(0.75))))
      col.addAssign(c(palette.glow).mul(pow(sd, 40.0)).mul(0.6))
      // Stars.
      const sp = d.xz.div(d.y.add(0.35)).mul(140.0)
      const r = hash12(floor(sp))
      const star = step(0.986, r).mul(float(1.0).sub(smoothstep(0.0, 0.12, length(fract(sp).sub(0.5)))))
      const tw = float(0.55).add(sin(u.time.mul(r.mul(3.0).add(1.0)).add(r.mul(60.0))).mul(0.45))
      col.addAssign(vec3(0.85, 0.85, 1.0).mul(star).mul(tw).mul(smoothstep(0.08, 0.35, h)).mul(float(1.0).sub(pow(sd, 3.0))))
      // Below the horizon: the fog colour the far sea fades to.
      const below = mix(u.fogColor, u.fogGlow, pow(sd, 8.0).mul(0.7))
      col.assign(mix(col, below, float(1.0).sub(smoothstep(-0.01, 0.0, h))))
      // Sun disc.
      const disc = smoothstep(0.99955, 0.99975, sd).mul(smoothstep(-0.004, 0.003, h))
      col.addAssign(vec3(7.0, 6.4, 6.2).mul(disc))
      col.addAssign(vec3(1.6, 1.3, 1.35).mul(pow(sd, 500.0)))
      return col
    })()
    return m
  }, [])

  useFrame(({ camera }) => mesh.current.position.copy(camera.position))

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1500, 64, 32]} />
    </mesh>
  )
}

