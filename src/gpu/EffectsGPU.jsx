import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  clamp,
  unpackRGBToNormal,
  packNormalToRGB,
  dot,
  float,
  fract,
  int,
  length,
  max,
  min,
  mrt,
  normalView,
  output,
  mix,
  pass,
  pow,
  renderOutput,
  rtt,
  sample,
  sin,
  smoothstep,
  step,
  toneMapping,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  abs,
  exp,
  perspectiveDepthToViewZ,
  getViewPosition,
  getScreenPosition,
  interleavedGradientNoise,
  screenCoordinate,
} from 'three/tsl'
import { ao as gtao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js'
import { reducedMotion } from '../quality'
import { SUN_DIR } from '../scene/world'
import { u } from './tsl'

// Post-processing on the WebGPU path, matching the WebGL chain:
// sanitize -> light shafts -> neutral tone mapping -> grade -> vignette -> grain -> sRGB
// -> SMAA, with ground-truth ambient occlusion first on the tiers that can afford it.

const LUMA = vec3(0.2126, 0.7152, 0.0722)

// Colour grade: cool shadows, warm highlights, a gentle S-curve and a little vibrance.
const grade = Fn(([c0]) => {
  const c = clamp(c0, 0.0, 1.0).toVar()
  const l = dot(c, LUMA)
  c.mulAssign(mix(vec3(0.9, 0.94, 1.08), vec3(1.0), smoothstep(0.0, 0.45, l)))
  c.mulAssign(mix(vec3(1.0), vec3(1.07, 1.0, 0.93), smoothstep(0.45, 1.0, l)))
  c.assign(mix(c, c.mul(c).mul(vec3(3.0).sub(c.mul(2.0))), 0.22))
  const l2 = dot(c, LUMA)
  const sat = max(max(c.r, c.g), c.b).sub(min(min(c.r, c.g), c.b))
  return clamp(mix(vec3(l2), c, float(1.0).add(float(1.0).sub(sat).mul(0.18))), 0.0, 1.0)
})

export default function EffectsGPU({ godRays = true, gradeOn = true, ao = false, aoFull = false, contact = false, flare = true }) {
  const { gl, scene, camera, size } = useThree()

  const { pipeline, sunUV, sunOn, sunView } = useMemo(() => {
    const pipeline = new THREE.RenderPipeline(gl)
    pipeline.outputColorTransform = false
    const scenePass = pass(scene, camera)
    const sceneTex = scenePass.getTextureNode('output')
    const viewZ = scenePass.getViewZNode()
    const texel = uniform(new THREE.Vector2(1 / 1280, 1 / 720))
    const sunUV = uniform(new THREE.Vector2(0.5, 0.5))
    const sunOn = uniform(1)

    // Sanitize: rebuild invalid pixels (NaN, infinite, exactly black) from valid neighbours.
    const bad = (c) => c.r.greaterThanEqual(0.0).and(c.g.greaterThanEqual(0.0)).and(c.b.greaterThanEqual(0.0))
      .and(c.r.lessThan(6e4)).and(c.g.lessThan(6e4)).and(c.b.lessThan(6e4))
      .and(c.r.add(c.g).add(c.b).greaterThan(0.0)).not()
    const clean = Fn(() => {
      const c = sceneTex.sample(uv()).rgb.toVar()
      If(bad(c), () => {
        const sum = vec3(0.0).toVar()
        const n = float(0.0).toVar()
        for (let r = 1; r <= 2; r++) {
          for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4
            const s = sceneTex.sample(uv().add(vec2(Math.cos(a), Math.sin(a)).mul(texel).mul(r * 2))).rgb
            If(bad(s).not(), () => {
              sum.addAssign(s)
              n.addAssign(1.0)
            })
          }
        }
        c.assign(n.greaterThan(0.0).select(sum.div(max(n, 1.0)), vec3(0.0)))
      })
      return min(max(c, vec3(0.0)), vec3(12.0))
    })()

    let hdr = clean
    if (ao) {
      // Real surface normals for the AO (a second target in the scene pass): rebuilt from
      // depth they mottle large smooth surfaces like the piano lid.
      scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }))
      const normalTex = scenePass.getTextureNode('normal')
      const sceneNormal = sample((p) => unpackRGBToNormal(normalTex.sample(p)))
      // Ground-truth AO: contact shadows where things meet, as N8AO on the WebGL path. Full
      // resolution on the ultra tier, half below it.
      const depthTex = scenePass.getTextureNode('depth')
      const aoPass = gtao(depthTex, sceneNormal, camera)
      aoPass.resolutionScale = aoFull ? 1 : 0.5
      aoPass.radius.value = 0.9
      aoPass.distanceFallOff.value = 0.6
      aoPass.samples.value = 12
      // Edge-aware smoothing (joint bilateral): each tap counts only if it lies at about the
      // same depth as this pixel, so AO never bleeds across edges. A plain blur smeared the
      // shadow of the blades behind onto each grass blade, which read as blurry grass.
      // AO fades out with distance (grazing far surfaces like the sea read as occluded).
      const aoTex = aoPass.getTextureNode()
      // The scene camera's clip planes (cameraNear/cameraFar here would be the full-screen
      // quad's camera).
      const near = uniform(camera.near)
      const far = uniform(camera.far)
      const zAt = (p) => perspectiveDepthToViewZ(depthTex.sample(p).x, near, far)
      const occ = Fn(() => {
        const zc = zAt(uv()).toVar()
        const tol = abs(zc).mul(0.03).add(0.02).toVar()
        const sum = float(0.0).toVar()
        const wsum = float(0.0).toVar()
        for (let i = -2; i <= 2; i++) {
          for (let j = -2; j <= 2; j++) {
            const p = uv().add(vec2(i, j).mul(texel).mul(aoFull ? 1.0 : 1.5))
            const w = exp(abs(zAt(p).sub(zc)).div(tol).negate()).mul(1.0 / (1 + i * i + j * j))
            sum.addAssign(aoTex.sample(p).r.mul(w))
            wsum.addAssign(w)
          }
        }
        return mix(sum.div(max(wsum, 1e-4)), float(1.0), smoothstep(-25.0, -60.0, zc))
      })()
      hdr = hdr.mul(mix(vec3(0.05, 0.045, 0.16), vec3(1.0), pow(clamp(occ, 0.0, 1.0), 1.15)))
    }
    const sunView = uniform(new THREE.Vector3())
    if (contact) {
      // Screen-space contact shadows: from each pixel a short ray runs toward the sun through
      // the depth buffer; if a surface sits in front of the ray (within a thin slab) the
      // pixel is shadowed. Gives grass blades, flowers, stones and piano legs the small
      // shadows a shadow map can't resolve. Faded out with distance.
      const depthTex = scenePass.getTextureNode('depth')
      const near = uniform(camera.near)
      const far = uniform(camera.far)
      const projM = uniform(camera.projectionMatrix)
      const projInv = uniform(camera.projectionMatrixInverse)
      const STEPS = 12
      const lit = Fn(() => {
        const d = depthTex.sample(uv()).x.toVar()
        const res = float(1.0).toVar()
        If(d.lessThan(0.99999), () => {
          const P = getViewPosition(uv(), d, projInv).toVar()
          const dist = length(P).toVar()
          const len = clamp(dist.mul(0.025), 0.12, 0.7)
          const stepV = sunView.mul(len.div(STEPS)).toVar()
          const jitter = interleavedGradientNoise(screenCoordinate)
          const p = P.add(stepV.mul(jitter)).toVar()
          const bias = dist.mul(0.002).add(0.01)
          const occ = float(0.0).toVar()
          for (let i = 0; i < STEPS; i++) {
            p.addAssign(stepV)
            const sUv = getScreenPosition(p, projM)
            const inside = sUv.x.greaterThan(0.0).and(sUv.x.lessThan(1.0)).and(sUv.y.greaterThan(0.0)).and(sUv.y.lessThan(1.0))
            const zs = perspectiveDepthToViewZ(depthTex.sample(sUv).x, near, far)
            const dz = zs.sub(p.z)
            const hit = inside.and(dz.greaterThan(bias)).and(dz.lessThan(0.35))
            // Nearer hits count fully, the last steps fade (soft end of the shadow).
            occ.assign(max(occ, hit.select(float(1.0 - (i / STEPS) * 0.5), float(0.0))))
          }
          res.assign(float(1.0).sub(occ.mul(float(1.0).sub(smoothstep(18.0, 40.0, dist)))))
        })
        return res
      })()
      hdr = hdr.mul(mix(vec3(0.52, 0.5, 0.7), vec3(1.0), lit))
    }
    if (godRays) {
      // Light shafts (screen-space, as the WebGL GodRays): a bright sun disc where the sky
      // is visible, blurred radially away from the sun at half resolution.
      const aspect = uniform(1)
      const mask = rtt(
        Fn(() => {
          const sky = smoothstep(-1300.0, -1450.0, viewZ)
          const d = length(uv().sub(sunUV).mul(vec2(aspect, 1.0)))
          return vec4(vec3(1.0, 0.97, 0.95).mul(sky).mul(smoothstep(0.016, 0.012, d)).mul(sunOn), 1.0)
        })(),
        null,
        null,
        { resolutionScale: 0.5 },
      )
      const samples = reducedMotion ? 30 : 40
      const rays = rtt(
        Fn(() => {
          const tc = uv().toVar()
          const delta = tc.sub(sunUV).mul(0.96 / samples)
          const decay = float(1.0).toVar()
          const acc = vec3(0.0).toVar()
          Loop({ start: int(0), end: int(samples), type: 'int', condition: '<' }, () => {
            tc.subAssign(delta)
            acc.addAssign(mask.sample(tc).rgb.mul(decay).mul(0.35))
            decay.mulAssign(0.94)
          })
          return vec4(clamp(acc.mul(0.32), 0.0, 1.0), 1.0)
        })(),
        null,
        null,
        { resolutionScale: 0.5 },
      )
      const r = rays.sample(uv()).rgb
      hdr = hdr.add(r).sub(min(hdr.mul(r), vec3(1.0))) // screen blend, as postprocessing's
      pipeline._aspect = aspect
    }

    if (flare) {
      // Sun lens flare: how much of the sun disc is in view (sky depth sampled on a small
      // ring around it), then ghosts along the line through the screen centre, a faint halo
      // and a soft horizontal streak. Analytic shapes, so nothing can flicker.
      const flareDepth = scenePass.getTextureNode('depth')
      const fNear = uniform(camera.near)
      const fFar = uniform(camera.far)
      const flareAspect = uniform(1)
      pipeline._flareAspect = flareAspect
      const flareCol = Fn(() => {
        const visSum = float(0.0).toVar()
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2
          const r = k % 2 ? 0.006 : 0.012
          const p = sunUV.add(vec2(Math.cos(a) * r, Math.sin(a) * r).div(vec2(flareAspect, 1.0)))
          const z = perspectiveDepthToViewZ(flareDepth.sample(p).x, fNear, fFar)
          visSum.addAssign(smoothstep(-1300.0, -1450.0, z))
        }
        const onScreen = smoothstep(-0.1, 0.05, sunUV.x).mul(smoothstep(1.1, 0.95, sunUV.x)).mul(smoothstep(-0.1, 0.05, sunUV.y)).mul(smoothstep(1.1, 0.95, sunUV.y))
        const vis = visSum.div(12.0).mul(onScreen).mul(sunOn).toVar()
        const res = vec3(0.0).toVar()
        If(vis.greaterThan(0.001), () => {
          const A = vec2(flareAspect, 1.0)
          const toC = vec2(0.5).sub(sunUV)
          // Ghosts: [position along sun->centre->beyond, radius, tint].
          const GHOSTS = [
            [0.55, 0.035, [0.55, 0.45, 0.9]],
            [0.95, 0.02, [0.9, 0.6, 0.75]],
            [1.35, 0.06, [0.4, 0.5, 1.0]],
            [1.7, 0.028, [0.75, 0.55, 1.0]],
            [2.15, 0.09, [0.35, 0.3, 0.8]],
          ]
          for (const [f, rad, tint] of GHOSTS) {
            const c = sunUV.add(toC.mul(f))
            const d = length(uv().sub(c).mul(A))
            const disc = smoothstep(rad, rad * 0.55, d).mul(float(0.55).add(smoothstep(rad * 0.4, rad, d).mul(0.45)))
            res.addAssign(vec3(...tint).mul(disc).mul(0.16))
          }
          // Halo ring centred on the screen-mirrored sun.
          const hd = length(uv().sub(sunUV.add(toC.mul(1.0))).mul(A))
          res.addAssign(vec3(0.5, 0.42, 0.85).mul(exp(abs(hd.sub(0.32)).mul(-60.0))).mul(0.05))
          // Horizontal streak and glare around the sun.
          const ds = uv().sub(sunUV).mul(A)
          res.addAssign(vec3(0.75, 0.7, 1.0).mul(exp(abs(ds.y).mul(-320.0))).mul(exp(abs(ds.x).mul(-4.5))).mul(0.32))
          res.addAssign(vec3(1.0, 0.85, 0.8).mul(exp(length(ds).mul(-14.0))).mul(0.12))
        })
        return res.mul(vis)
      })()
      hdr = hdr.add(flareCol)
    }

    let col = toneMapping(THREE.NeutralToneMapping, float(1.0), vec4(hdr, 1.0)).rgb
    if (gradeOn) col = grade(col)
    // Vignette (as postprocessing's default: offset 0.3, darkness 0.55).
    const d = length(uv().sub(0.5))
    col = col.mul(smoothstep(0.8, 0.3 * 0.799, d.mul(0.55 + 0.3)))
    // Film grain (overlay blend, 3.5%).
    const grain = Fn(() => {
      const n = fract(sin(dot(uv().add(fract(u.time.mul(0.37))), vec2(12.9898, 78.233))).mul(43758.5453))
      const base = col
      const over = mix(base.mul(n).mul(2.0), vec3(1.0).sub(vec3(1.0).sub(base).mul(float(1.0).sub(n)).mul(2.0)), step(vec3(0.5), base))
      return mix(base, over, 0.035)
    })()
    const out = renderOutput(vec4(grain, 1.0), THREE.NoToneMapping, THREE.SRGBColorSpace)
    pipeline.outputNode = smaa(out)
    pipeline._texel = texel
    return { pipeline, sunUV, sunOn, sunView }
  }, [gl, scene, camera, godRays, gradeOn, ao, aoFull, contact, flare])

  useEffect(() => {
    pipeline._texel.value.set(1 / (size.width * gl.getPixelRatio()), 1 / (size.height * gl.getPixelRatio()))
    if (pipeline._aspect) pipeline._aspect.value = size.width / size.height
    if (pipeline._flareAspect) pipeline._flareAspect.value = size.width / size.height
  }, [pipeline, size, gl])
  useEffect(() => () => pipeline.dispose(), [pipeline])

  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    // Sun position on screen (the shafts fade out when it is behind the camera).
    tmp.copy(camera.position).addScaledVector(SUN_DIR, 1400).project(camera)
    sunUV.value.set(tmp.x * 0.5 + 0.5, 0.5 - tmp.y * 0.5) // screen uv: y down
    sunOn.value = tmp.z < 1 ? 1 : 0
    sunView.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse) // for contact shadows
    pipeline.render()
  }, 1)

  return null
}
