import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { TIER_ORDER } from '../quality'
import { motion } from '../store'
import { texturesReady } from '../textureReady'

// Warm-up tour, behind the loading screen: once the textures are in, render a frame from
// each section's camera and from mid-flight (the camera rig runs first in a frame, so the
// level-of-detail choices that follow see the new position), so every shader is compiled and
// every texture is on the GPU before the page shows. Otherwise each was prepared the first
// time it came into view, and every section stalled on its first visit.
export const warm = { done: false }
const TOUR = [1, 2, 3, 2.5, 1.5, 0.5, 0]
export function Warmup({ onDone }) {
  const st = useRef({ step: -1, saved: 0, mounted: 0, live: true })
  useEffect(() => {
    warm.done = false // (again, if the WebGL scene takes over from a failed WebGPU one)
    const s = st.current
    s.live = true
    return () => {
      s.live = false
    }
  }, [])
  useFrame(() => {
    const s = st.current
    // Wait a few frames so everything has mounted and queued its downloads, then for those.
    // (Two frames' grace after that, for what mounts once its download is in.)
    if (++s.mounted === 3) texturesReady().then(() => s.live && (s.step = -3))
    if (s.step === -1 || warm.done) return
    if (s.step < -1) {
      s.step = s.step === -2 ? 0 : s.step + 1
      return
    }
    if (s.step === 0) s.saved = motion.progress
    if (s.step >= TOUR.length) {
      motion.progress = s.saved
      warm.done = true
      onDone()
      return
    }
    motion.progress = TOUR[s.step++] // the camera rig places the camera from this
  }, -10)
  return null
}

// The frame rate the scene renders at (read by Adaptive).
export const pace = { fps: 60 }
// Highest rate the scene renders at automatically.
const MAX_FPS = 75
const RATES = [48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]

// Drives the on-demand render loop. With no fixed rate (the default) it renders on every
// k-th display refresh, k picked so the rate is at most MAX_FPS: 60 Hz and 120 Hz screens
// get 60 fps, 144 Hz gets 72. An even divisor of the refresh keeps every frame on screen
// for the same time; a rate that doesn't divide it (45 fps on a 60 Hz screen) alternates
// one- and two-refresh frames, which reads as judder while the camera moves.
// `fps` > 0 pins a rate instead (?fps=), timed against the clock.
export function FrameLimiter({ fps }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let raf
    if (fps > 0) {
      pace.fps = fps
      // Each frame is due exactly 1/fps after the previous one; we render on the first
      // display refresh at or after that time, so the average never exceeds the cap.
      const interval = 1000 / fps
      let next = 0
      const tick = (t) => {
        raf = requestAnimationFrame(tick)
        if (t >= next) {
          invalidate()
          next += interval
          if (t - next > interval) next = t + interval // fell behind (tab hidden, slow frame): resync
        }
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }
    // First measure the display's refresh from the gaps between animation frames, with
    // nothing rendering (the loading screen is still up), over half a second: a low
    // percentile, so frames held up by loading work don't count, snapped to a standard rate.
    const gaps = []
    let last = 0
    let every = 1
    let n = 0
    const tick = (t) => {
      raf = requestAnimationFrame(tick)
      if (gaps.length < 30) {
        if (last) gaps.push(t - last)
        last = t
        if (gaps.length === 30) {
          const sorted = [...gaps].sort((a, b) => a - b)
          const hz = 1000 / sorted[Math.floor(sorted.length * 0.2)]
          const refresh = RATES.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a))
          every = Math.max(1, Math.ceil(refresh / MAX_FPS - 0.01))
          pace.fps = refresh / every
          window.__pace = { refresh, every, fps: pace.fps }
        }
        return
      }
      if (++n % every === 0) invalidate()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fps, invalidate])
  return null
}

// Adaptive quality. Watches the real interval between rendered frames (the scene renders at
// pace.fps, so anything slower means the GPU can't keep up) over two-second windows:
// - late frames: lower the render resolution in steps (to 85% or 70%), then drop a tier;
// - on time for a while: raise the resolution back, then try the next tier up (at most one
//   above the starting guess). A tier that proves too slow is never tried again, so it
//   settles instead of oscillating.
const STEP = 0.15
// On standard-DPI screens a lower render resolution shows as blur, so there it only drops to
// 85% before the tier goes down; high-DPI screens can go to 70% unnoticed.
const minScale = (baseDpr) => (Math.min(window.devicePixelRatio, baseDpr) > 1.2 ? 0.7 : 0.85)
export function Adaptive({ tier, onTier, startTier, baseDpr }) {
  const setDpr = useThree((s) => s.setDpr)
  const s = useRef(null)
  if (!s.current) s.current = { last: 0, start: performance.now(), sum: 0, n: 0, windowStart: 0, settleUntil: 0, goodSince: 0, scale: 1, failed: new Set(), probe: null }
  const idx = TIER_ORDER.indexOf(tier)
  const maxIdx = Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(startTier) + 1)

  useFrame(() => {
    const st = s.current
    const now = performance.now()
    const dt = now - st.last
    st.last = now
    if (!warm.done) {
      st.start = now // count from the end of the warm-up (its frames compile shaders)
      return
    }
    // Ignore shader warm-up, tab switches and the settle time after a change.
    // (Slow frames still count: only a hidden tab or a stall over 1.5 s is skipped.)
    if (now - st.start < 4000 || now < st.settleUntil || document.hidden || dt > 1500) return
    if (!st.windowStart) st.windowStart = now
    st.sum += dt
    st.n++
    if (now - st.windowStart < 2000) return
    const avg = st.sum / st.n
    st.sum = 0
    st.n = 0
    st.windowStart = 0
    window.__adaptive = { tier, scale: st.scale, avg: Math.round(avg * 10) / 10 }
    const apply = (scale) => {
      st.scale = scale
      setDpr(Math.min(window.devicePixelRatio, baseDpr) * scale)
    }

    const BUDGET = 1000 / pace.fps
    if (avg > BUDGET * 1.3) {
      st.goodSince = 0
      st.settleUntil = now + 2500
      if (st.probe !== null) {
        // The tier we just tried is too much for this machine: go back and remember.
        st.failed.add(st.probe)
        st.probe = null
        onTier(TIER_ORDER[idx - 1])
      } else if (st.scale > minScale(baseDpr) + 1e-3) apply(Math.max(minScale(baseDpr), st.scale - STEP))
      else if (idx > 0) {
        apply(1)
        onTier(TIER_ORDER[idx - 1])
      }
      return
    }
    if (avg < BUDGET * 1.08) {
      if (!st.goodSince) st.goodSince = now
      if (st.probe !== null && now - st.goodSince > 6000) st.probe = null // the new tier holds
      if (now - st.goodSince < 8000) return
      st.goodSince = now
      if (st.scale < 1 - 1e-3) apply(Math.min(1, st.scale + STEP))
      else if (idx < maxIdx && !st.failed.has(idx + 1)) {
        st.probe = idx + 1
        st.settleUntil = now + 2500
        onTier(TIER_ORDER[idx + 1])
      }
    } else st.goodSince = 0
  })
  return null
}

// Debug: ?stats=1 exposes per-frame render counts as window.__stats (both renderers).
export const statsOn = new URLSearchParams(window.location.search).get('stats') === '1'
export function Stats() {
  // Count the whole frame (all passes), not just the last render call.
  useFrame(({ gl }) => {
    gl.info.autoReset = false
    gl.info.reset()
  }, -1000)
  useFrame(({ gl }) => {
    window.__gl = gl
    const r = gl.info.render
    window.__stats = { triangles: r.triangles, calls: r.drawCalls ?? r.calls, programs: gl.info.programs?.length ?? null }
  }, 1000)
  return null
}
