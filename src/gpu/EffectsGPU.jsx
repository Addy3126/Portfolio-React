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

export default function EffectsGPU({ godRays = true, gradeOn = true, ao = false, aoFull = false }) {
  const { gl, scene, camera, size } = useThree()

  const { pipeline, sunUV, sunOn } = useMemo(() => {
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
    return { pipeline, sunUV, sunOn }
  }, [gl, scene, camera, godRays, gradeOn, ao, aoFull])

  useEffect(() => {
    pipeline._texel.value.set(1 / (size.width * gl.getPixelRatio()), 1 / (size.height * gl.getPixelRatio()))
    if (pipeline._aspect) pipeline._aspect.value = size.width / size.height
  }, [pipeline, size, gl])
  useEffect(() => () => pipeline.dispose(), [pipeline])

  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    // Sun position on screen (the shafts fade out when it is behind the camera).
    tmp.copy(camera.position).addScaledVector(SUN_DIR, 1400).project(camera)
    sunUV.value.set(tmp.x * 0.5 + 0.5, 0.5 - tmp.y * 0.5) // screen uv: y down
    sunOn.value = tmp.z < 1 ? 1 : 0
    pipeline.render()
  }, 1)

  return null
}
