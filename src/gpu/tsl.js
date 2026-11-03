// Shared shader helpers in TSL (three.js's node shading language), ported from
// scene/glsl.js so the WebGPU path matches the WebGL one. TSL compiles to WGSL on WebGPU
// and to GLSL on the WebGL2 fallback, so this one source runs on both backends.
import {
  Fn,
  If,
  Loop,
  abs,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  pow,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { cameraViewMatrix, normalize, vec4 as v4 } from 'three/tsl'
import { shared } from '../scene/world'

// Uniforms mirroring the shared values the WebGL shaders use. Vectors and colours share
// the same objects, so they stay in sync; plain numbers are copied each frame (sync()).
export const u = {
  time: uniform(0),
  motion: uniform(shared.uMotion.value),
  sunDir: uniform(shared.uSunDir.value),
  fogColor: uniform(shared.uFogColor.value),
  fogGlow: uniform(shared.uFogGlow.value),
  fogDensity: uniform(shared.uFogDensity.value),
  pianoPos: uniform(shared.uPianoPos.value),
  pianoGlow: uniform(shared.uPianoGlow.value),
  glowPulse: uniform(1),
  grassFar: uniform(999),
  grassHi: uniform(0),
  cursor: uniform(shared.uCursor.value),
  cursorStrength: uniform(0),
  rippleT: uniform(shared.uRippleT.value),
  rippleA: uniform(shared.uRippleA.value),
}
export function sync() {
  u.time.value = shared.uTime.value
  u.motion.value = shared.uMotion.value
  u.glowPulse.value = shared.uGlowPulse.value
  u.grassFar.value = shared.uGrassFar.value
  u.grassHi.value = shared.uGrassHi.value
  u.cursorStrength.value = shared.uCursorStrength.value
}

export const spow = Fn(([x, e]) => pow(max(x, 0.0), e))

export const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
  p3.addAssign(dot(p3, p3.yzx.add(33.33)))
  return fract(p3.x.add(p3.y).mul(p3.z))
})

export const vnoise = Fn(([p]) => {
  const i = floor(p)
  const f = fract(p)
  const w = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0)))
  const a = hash12(i)
  const b = hash12(i.add(vec2(1, 0)))
  const c = hash12(i.add(vec2(0, 1)))
  const d = hash12(i.add(vec2(1, 1)))
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y)
})

export const fbm = Fn(([p0]) => {
  const p = vec2(p0).toVar()
  const v = float(0).toVar()
  const a = float(0.5).toVar()
  Loop(5, () => {
    v.addAssign(a.mul(vnoise(p)))
    p.assign(p.mul(2.03).add(vec2(17.1, 9.2)))
    a.mulAssign(0.5)
  })
  return v
})

// --- Coastline (keep in sync with world.js and glsl.js) ---
export const shoreZ = Fn(([x]) => float(-8.0).add(sin(x.mul(0.15)).mul(1.2)).add(sin(x.mul(0.37).add(1.3)).mul(0.5)))
export const bankX = Fn(([z]) => float(-22.0).sub(sin(z.mul(0.13)).mul(1.5)).sub(sin(z.mul(0.41).add(2.0)).mul(0.8)))
export const rightX = Fn(([z]) => float(58.0).add(sin(z.mul(0.17)).mul(3.0)).add(sin(z.mul(0.5).add(1.0)).mul(1.5)))
export const mainDist = Fn(([xz]) => min(min(xz.y.sub(shoreZ(xz.x)), xz.x.sub(bankX(xz.y))), rightX(xz.y).sub(xz.x)))

const spitPoint = Fn(([t]) => vec2(float(16.0).add(sin(t.mul(3.0)).mul(6.0)).add(t.mul(t).mul(22.0)), float(-5.0).sub(t.mul(48.0))))
const spitHalfWidth = Fn(([t]) => float(2.2).add(pow(float(1.0).sub(t), 0.8).mul(8.5)).add(sin(t.mul(13.0)).mul(0.9)))

export const spitDist = Fn(([xz]) => {
  const result = float(-1000.0).toVar()
  // Only evaluate near the spit (beyond 40 m the smooth union no longer changes).
  const dq = max(abs(xz.sub(vec2(22.5, -29.0))).sub(vec2(23.5, 35.0)), 0.0)
  If(length(dq).lessThanEqual(40.0), () => {
    const best = float(-1e9).toVar()
    const prev = spitPoint(float(0.0)).toVar()
    Loop({ start: 1, end: 25 }, ({ i }) => {
      const t1 = float(i).div(24.0)
      const cur = spitPoint(t1).toVar()
      const e = cur.sub(prev)
      const h = clamp(dot(xz.sub(prev), e).div(dot(e, e)), 0.0, 1.0)
      const d = length(xz.sub(prev).sub(e.mul(h)))
      best.assign(max(best, spitHalfWidth(float(i).sub(1).add(h).div(24.0)).sub(d)))
      prev.assign(cur)
    })
    result.assign(best)
  })
  return result
})

const smaxk = Fn(([a, b, k]) => {
  const h = clamp(float(0.5).add(a.sub(b).mul(0.5).div(k)), 0.0, 1.0)
  return mix(b, a, h).add(k.mul(h).mul(float(1.0).sub(h)))
})
export const landDist = Fn(([xz]) => smaxk(mainDist(xz), spitDist(xz), float(9.0)))
export const seabedY = Fn(([xz]) => {
  const below = landDist(xz).negate()
  return below.greaterThan(0.0).select(min(float(0.45), below.mul(0.22)).negate(), float(0.0))
})

// --- Fog: exponential-squared, warming toward the sun ---
export const applyFog = Fn(([col, dist, V]) => {
  const fd = dist.mul(u.fogDensity)
  const f = float(1.0).sub(exp(fd.mul(fd).negate()))
  const sd = max(dot(V, u.sunDir), 0.0)
  const fc = mix(u.fogColor, u.fogGlow, pow(sd, 8.0).mul(0.7))
  return mix(col, fc, f)
})

export const smooth = smoothstep

// --- Shore swash and foam (ported from swashGLSL) ---
const hash22 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar()
  p3.addAssign(dot(p3, p3.yzx.add(33.33)))
  return fract(p3.xx.add(p3.yz).mul(p3.zy))
})
// Voronoi: x = F1 (distance to the nearest cell centre), y = F2 - F1 (small along borders).
// The 3x3 cell loop is unrolled at build time.
export const voronoi2 = Fn(([p, t]) => {
  const i = floor(p)
  const f = fract(p)
  const d1 = float(8.0).toVar()
  const d2 = float(8.0).toVar()
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const g = vec2(x, y)
      const o = sin(t.add(hash22(i.add(g)).mul(6.2831))).mul(0.42).add(0.5)
      const d = length(g.add(o).sub(f))
      d2.assign(min(d2, max(d1, d)))
      d1.assign(min(d1, d))
    }
  }
  return vec2(d1, d2.sub(d1))
})

// L = landDist (metres, + on land). Returns x: water cover over the sand, y: foam,
// z: sand wetness, w: rim shadow beside the foam line.
export const swash = Fn(([xz, L, t]) => {
  const out = vec4(0.0).toVar()
  If(L.lessThan(-10.0), () => {
    out.assign(vec4(1, 0, 0, 0))
  }).ElseIf(L.lessThanEqual(4.5), () => {
    const seed = vnoise(xz.mul(0.05).add(3.1))
    const ph = fract(t.div(8.0).add(seed.mul(2.3)))
    const UP = 0.4
    const s = ph.lessThan(UP).select(float(1.0).sub(pow(max(float(1.0).sub(ph.div(UP)), 0.0), 2.2)), pow(max(float(1.0).sub(ph.sub(UP).div(1.0 - UP)), 0.0), 1.5))
    const cusp = float(0.7).add(vnoise(xz.mul(0.21).add(seed.mul(9.0))).mul(0.55))
    const reach = cusp.mul(2.3)
    const R = float(0.1).add(reach.mul(s))
    const wig = vnoise(xz.mul(1.3).add(vec2(t.mul(0.04), 0.0))).sub(0.5).mul(0.35).add(vnoise(xz.mul(3.7)).sub(0.5).mul(0.12))
    const e = L.sub(R).add(wig)
    const cover = float(1.0).sub(smoothstep(-0.04, 0.02, e))
    const advancing = float(1.0).sub(smoothstep(UP - 0.08, UP + 0.02, ph))

    const lineW = float(0.09).add(advancing.mul(0.22))
    const line = smoothstep(lineW.negate(), lineW.mul(-0.25), e)
      .mul(float(1.0).sub(smoothstep(-0.02, 0.015, e)))
      .mul(float(0.75).add(vnoise(xz.mul(9.0)).mul(0.25)))

    const behind = max(e.negate(), 0.0)
    const patchy = vnoise(xz.mul(0.9).add(vec2(t.mul(0.05), t.mul(-0.03)))).mul(0.6).add(vnoise(xz.mul(2.4).sub(t.mul(0.04))).mul(0.4))
    const dens0 = exp(behind.mul(-1.15))
      .mul(float(0.45).add(s.mul(0.55)))
      .mul(smoothstep(0.15, 0.6, patchy.add(exp(behind.mul(-1.5)).mul(0.25))))
    const surf = float(1.0)
      .sub(smoothstep(-6.0, -0.5, L))
      .mul(smoothstep(-12.0, -6.0, L))
      .mul(smoothstep(0.62, 0.85, vnoise(vec2(L.mul(0.7).sub(t.mul(0.3)), xz.x.add(xz.y).mul(0.07)))))
      .mul(0.45)
    const dens = max(dens0.mul(cover), surf)
    const p = xz.mul(2.2).add(vec2(t.mul(0.02), t.mul(0.035))).toVar()
    p.addAssign(vec2(vnoise(xz.mul(1.1).add(3.0)), vnoise(xz.mul(1.1).sub(5.0))).sub(0.5).mul(1.6))
    p.addAssign(vec2(vnoise(xz.mul(4.3).add(t.mul(0.1))), vnoise(xz.mul(4.3).add(9.0))).sub(0.5).mul(0.45))
    const vA = voronoi2(p, t.mul(0.2))
    const vB = voronoi2(p.mul(2.4).add(4.0), t.mul(0.25))
    const width = mix(0.02, 0.45, dens)
    const strands = max(
      float(1.0).sub(smoothstep(width.mul(0.55), width, vA.y)),
      float(1.0).sub(smoothstep(width.mul(0.45), width.mul(0.9), vB.y)).mul(0.85),
    )
    const vC = voronoi2(xz.mul(14.0).add(p.mul(0.5)), t.mul(0.6))
    const holes = float(1.0)
      .sub(smoothstep(0.12, 0.26, vC.x))
      .mul(smoothstep(0.35, 0.85, dens))
      .mul(smoothstep(0.35, 0.65, vnoise(xz.mul(5.0).add(1.0))))
    const lace = strands.mul(smoothstep(0.02, 0.2, dens)).mul(float(1.0).sub(holes.mul(0.9)))
    const foam = clamp(max(line, lace.mul(float(0.6).add(dens.mul(0.4)))), 0.0, 1.0)
    const wet = float(1.0).sub(smoothstep(reach.sub(0.1), reach.add(0.8), L.add(wig)))
    const rimLine = smoothstep(0.0, 0.03, e).mul(float(1.0).sub(smoothstep(0.03, 0.12, e))).mul(float(0.4).add(advancing.mul(0.6)))
    out.assign(vec4(cover, foam, wet, rimLine))
  })
  return out
})

// Foam colour: bright but lit by the twilight, warmer toward the sun, with a little tonal
// variation and relief (thicker foam catches more light).
export const foamShadeAt = Fn(([base, V, xz, amt]) => {
  const sd = max(dot(V, u.sunDir), 0.0)
  const shade = base.mul(0.78).add(u.fogGlow.mul(float(0.08).add(pow(sd, 6.0).mul(0.35))))
  return shade.mul(float(0.86).add(vnoise(xz.mul(7.0)).mul(0.14))).mul(float(0.85).add(amt.mul(0.15)))
})

// --- 3D value noise (ported from noise3GLSL) ---
export const hash13 = Fn(([p0]) => {
  const p = fract(p0.mul(0.1031)).toVar()
  p.addAssign(dot(p, p.zyx.add(31.32)))
  return fract(p.x.add(p.y).mul(p.z))
})
export const vnoise3 = Fn(([p]) => {
  const i = floor(p)
  const f = fract(p)
  const w = f.mul(f).mul(vec3(3.0).sub(f.mul(2.0)))
  const h = (x, y, z) => hash13(i.add(vec3(x, y, z)))
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), w.x), mix(h(0, 1, 0), h(1, 1, 0), w.x), w.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), w.x), mix(h(0, 1, 1), h(1, 1, 1), w.x), w.y),
    w.z,
  )
})
export const fbm3g = Fn(([p0]) => {
  const p = vec3(p0).toVar()
  const v = float(0).toVar()
  const a = float(0.5).toVar()
  Loop(4, () => {
    v.addAssign(a.mul(vnoise3(p)))
    p.assign(p.mul(2.03).add(vec3(11.3, 7.1, 3.7)))
    a.mulAssign(0.5)
  })
  return v
})

// A world-space normal in view space, for material.normalNode (read by the AO pass's
// normal buffer; the scene's own shading works in world space).
export const viewNormal = (Nw) => normalize(cameraViewMatrix.mul(v4(Nw, 0.0)).xyz)

// Rings of light spreading from the piano when it is played (as rippleGLSL).
export const pianoRipple = Fn(([d]) => {
  const age = max(vec4(u.time).sub(u.rippleT), vec4(0.0))
  const off = vec4(d).sub(age.mul(3.2))
  const band = exp(off.mul(off).div(-0.18)).mul(exp(age.mul(-0.85))).mul(u.rippleA)
  return band.x.add(band.y).add(band.z).add(band.w)
})
