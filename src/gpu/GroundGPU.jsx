import { useMemo } from 'react'
import * as THREE from 'three/webgpu'
import { Fn, If, cameraPosition, clamp, dot, float, length, max, mix, normalize, positionWorld, pow, reflect, sin, smoothstep, step, texture, vec2, vec3 } from 'three/tsl'
import { cullHidden } from '../scene/visibility'
import { color, landDist as landDistJS, palette } from '../scene/world'
import { beachShadow, pianoShadow } from './shadow'
import { surface } from './textures'
import { lookNew } from '../quality'
import { applyFog, foamShadeAt, landDist, mainDist, spitDist, swash, u, vnoise, pianoRipple } from './tsl'

// Ground, as the WebGL ground: field soil, beach and spit sand (ripples, grain, grit), the
// shore swash (water sheet, foam, wet sand) shared with the sea, seabed darkening, far
// grass carpet, sun back-light, piano shadow and contact darkening, piano glow.
const c = (hex) => vec3(...color(hex).toArray())

function groundGeometry() {
  const g = new THREE.PlaneGeometry(140, 80, 280, 200)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0, -28)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const below = -landDistJS(x, z)
    const y = below > 0 ? -Math.min(0.45, below * 0.22) : Math.sin(x * 0.3) * Math.cos(z * 0.4) * 0.04 * Math.min(1, -below)
    pos.setY(i, y)
  }
  g.computeVertexNormals()
  const out = cullHidden(g)
  g.dispose()
  return out
}

export default function GroundGPU() {
  const geometry = useMemo(groundGeometry, [])
  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ fog: false })
    const sandTex = surface('coast_sand_04')
    const gravelTex = surface('clean_pebbles')
    const pebbleTex = surface('ganges_river_pebbles')
    m.colorNode = Fn(() => {
      const W = positionWorld
      const toP = W.sub(cameraPosition)
      const dist = length(toP)
      const V = normalize(toP)
      const xz = W.xz

      const col = mix(c('#181d4e'), c('#6b62a8'), smoothstep(2.0, 18.0, dist)).toVar()
      const inland = landDist(xz)
      const spit = float(1.0).sub(smoothstep(-3.0, 0.5, mainDist(xz)))
      const beach = max(float(1.0).sub(smoothstep(3.0, 5.2, inland)), spit)

      const t = u.time.mul(u.motion)
      const sand = c('#a49ad0').mul(float(0.85).add(vnoise(xz.mul(3.0)).mul(0.3))).toVar()
      // Swash: wet sand up to the highest recent reach (darker, mirrors the glow).
      const sw = swash(xz, inland, t).toVar()
      const R = reflect(V, vec3(0, 1, 0))
      const wetCol = c('#3c3f8c').add(u.fogGlow.mul(max(dot(R, u.sunDir), 0.0).pow(30.0)).mul(0.6))
      sand.assign(mix(sand, wetCol, sw.z.mul(0.85)))
      // Sand surface: soft wind ripples, fine grain and a sprinkling of tiny dark grit.
      const near = float(1.0).sub(smoothstep(6.0, 30.0, dist))
      const ripple = sin(dot(xz, vec2(0.8, 0.6)).mul(7.0).add(vnoise(xz.mul(0.6)).mul(7.0))).mul(0.5).add(0.5)
      sand.mulAssign(float(1.0).add(ripple.sub(0.5).mul(0.05).mul(float(1.0).sub(smoothstep(10.0, 45.0, dist)))))
      // Scanned ground: fine beach sand, with gravel and river pebbles on the spit (in
      // patches, heavier toward its rocky end). Luminance modulates the palette colour, and
      // the scan's normals are lit by the low sun relative to flat ground, so ripples and
      // pebbles stand out without changing the overall tone. Detail fades with distance.
      const detail = float(1.0).sub(smoothstep(22.0, 70.0, dist)).toVar()
      const sS = texture(sandTex.s, xz.div(1.6))
      const sN = texture(sandTex.n, xz.div(1.6))
      const gS = texture(gravelTex.s, xz.div(1.1))
      const gN = texture(gravelTex.n, xz.div(1.1))
      const pS = texture(pebbleTex.s, xz.div(1.4))
      const pN = texture(pebbleTex.n, xz.div(1.4))
      const patch = vnoise(xz.mul(0.22).add(5.0))
      const gravel = spit.mul(smoothstep(0.35, 0.6, patch)).toVar()
      const pebbles = spit.mul(smoothstep(0.62, 0.8, patch)).mul(smoothstep(-4.0, 1.5, spitDist(xz).negate())).toVar()
      const lum = mix(mix(sS.r, gS.r, gravel), pS.r, pebbles)
      const tn = mix(mix(sN.xy, gN.xy, gravel), pN.xy, pebbles).mul(2.0).sub(1.0).mul(detail).mul(mix(1.0, 0.45, sw.z))
      const Nd = normalize(vec3(tn.x, 1.0, tn.y.negate()))
      const L = u.sunDir
      const relief = max(dot(Nd, L), 0.0).mul(0.8).add(0.35).div(max(L.y, 0.0).mul(0.8).add(0.35))
      sand.mulAssign(mix(float(1.0), lum.mul(0.95).add(0.55), detail))
      sand.mulAssign(mix(float(1.0), relief, detail))
      // Pebbles are a little darker and cooler than the sand they sit in.
      sand.assign(mix(sand, sand.mul(c('#8a84b8')).mul(1.25), pebbles.mul(0.6)))
      // Wet sand: smooth spots catch a sharp glint of the glow.
      const rough = mix(mix(sS.g, gS.g, gravel), pS.g, pebbles)
      const Rd = reflect(V, Nd)
      sand.addAssign(u.fogGlow.mul(pow(max(dot(Rd, L), 0.0), 60.0)).mul(sw.z).mul(float(1.0).sub(rough)).mul(detail).mul(0.8))
      const grit = smoothstep(0.86, 0.95, vnoise(xz.mul(38.0))).mul(near).mul(float(1.0).sub(detail.mul(0.6)))
      sand.assign(mix(sand, c('#3a3558'), grit.mul(0.45).mul(float(0.4).add(spit.mul(0.6)))))
      col.assign(mix(col, sand, beach))

      // The swash itself: a thin sheet of water over the sand, the foam on top, and a faint
      // shadow beside the foam line.
      If(sw.x.add(sw.y).add(sw.w).greaterThan(0.001), () => {
        const rip = vec2(vnoise(xz.mul(4.0).add(t.mul(0.8))), vnoise(xz.mul(4.0).add(7.0).sub(t.mul(0.7)))).sub(0.5)
        const nW = normalize(vec3(rip.x.mul(0.12), 1.0, rip.y.mul(0.12)))
        const fres = float(0.02).add(pow(float(1.0).sub(clamp(dot(V.negate(), nW), 0.0, 1.0)), 5.0).mul(0.98))
        const sdw = max(dot(reflect(V, nW), u.sunDir), 0.0)
        const skyR = mix(c('#5a4f9e'), u.fogGlow, pow(sdw, 8.0))
        const film = mix(c('#5d5aa6').mul(0.85), skyR, clamp(fres.mul(1.2).add(0.1), 0.0, 1.0)).add(vec3(4.0).mul(pow(sdw, 900.0)))
        col.assign(mix(col, film, sw.x))
        col.mulAssign(float(1.0).sub(sw.w.mul(0.22)))
        col.assign(mix(col, foamShadeAt(c('#e4dcff'), V, xz, sw.y), sw.y.mul(0.92)))
      })
      col.assign(mix(col, c('#3c3f8c').mul(0.5), float(1.0).sub(smoothstep(-1.5, -0.1, inland))))

      const far = smoothstep(u.grassFar.sub(9.0), u.grassFar.sub(3.0), length(xz.sub(cameraPosition.xz)))
      const carpet = c('#8a82cf').mul(lookNew ? 0.84 : 1.0).mul(float(0.8).add(vnoise(xz.mul(0.6)).mul(0.35))).mul(float(0.85).add(vnoise(xz.mul(0.09).add(3.0)).mul(0.3)))
      col.assign(mix(col, carpet, far.mul(float(1.0).sub(beach)).mul(step(0.0, inland))))

      const back = pow(max(dot(V, u.sunDir), 0.0), 5.0)
      col.addAssign(c(palette.frost).mul(back).mul(0.25).mul(float(1.0).sub(beach)))

      // Piano shadow, and contact darkening under the piano and bench.
      col.mulAssign(mix(0.45, 1.0, pianoShadow(W).mul(mix(1.0, beachShadow(W), 0.9))))
      const e = length(xz.sub(vec2(-1.45, 3.7)).div(vec2(1.45, 0.85)))
      const bench = length(xz.sub(vec2(-3.33, 3.7)).div(vec2(0.32, 0.55)))
      col.mulAssign(float(1.0).sub(float(1.0).sub(smoothstep(0.55, 1.35, e)).mul(0.45)).mul(float(1.0).sub(float(1.0).sub(smoothstep(0.6, 1.4, bench)).mul(0.3))))

      const pd = length(xz.sub(u.pianoPos.xz))
      col.addAssign(u.pianoGlow.mul(u.glowPulse).mul(0.5).div(pd.mul(pd).mul(1.2).add(1.0)))
      col.addAssign(u.pianoGlow.mul(pianoRipple(pd)).mul(0.55))
      return applyFog(col, dist, V)
    })()
    return m
  }, [])

  return <mesh geometry={geometry} material={material} />
}
