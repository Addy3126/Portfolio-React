import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { FPS_CAP, TIER_ORDER } from '../quality'

// Drives an on-demand render loop at a fixed frame rate.
export function FrameLimiter({ fps = FPS_CAP }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    // Each frame is due exactly 1/fps after the previous one; we render on the first
    // display refresh at or after that time, so the average never exceeds the cap.
    const interval = 1000 / fps
    let next = 0
    let raf
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
  }, [fps, invalidate])
  return null
}

// Adaptive quality. Watches the real interval between rendered frames (the scene renders at
// FPS_CAP, so anything slower means the GPU can't keep up) over two-second windows:
// - late frames: lower the render resolution in steps (to 85% or 70%), then drop a tier;
// - on time for a while: raise the resolution back, then try the next tier up (at most one
//   above the starting guess). A tier that proves too slow is never tried again, so it
//   settles instead of oscillating.
const BUDGET = 1000 / FPS_CAP
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
