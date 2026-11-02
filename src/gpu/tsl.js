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
} from 'three/tsl'
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
}
export function sync() {
  u.time.value = shared.uTime.value
  u.motion.value = shared.uMotion.value
  u.glowPulse.value = shared.uGlowPulse.value
  u.grassFar.value = shared.uGrassFar.value
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
