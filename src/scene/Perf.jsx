import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { FPS_CAP, MAX_LEVEL } from '../quality'

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

// Watches real frame intervals. If the scene can't hold the cap (frames run ~35% long
// for two seconds), it steps quality down one level. It never steps back up, so it
// can't oscillate; a reload starts again from the detected tier.
export function AutoQuality({ level, onLevel, fps = FPS_CAP }) {
  const s = useRef({ last: 0, start: performance.now(), sum: 0, n: 0, windowStart: 0, settleUntil: 0 })
  useFrame(() => {
    const st = s.current
    const now = performance.now()
    const dt = now - st.last
    st.last = now
    // Ignore shader warm-up, tab switches and the settle time after a change.
    if (now - st.start < 4000 || now < st.settleUntil || dt > 1000 || level >= MAX_LEVEL) return
    if (!st.windowStart) st.windowStart = now
    st.sum += dt
    st.n++
    if (now - st.windowStart < 2000) return
    const avg = st.sum / st.n
    st.sum = 0
    st.n = 0
    st.windowStart = 0
    if (avg > (1000 / fps) * 1.35) {
      st.settleUntil = now + 3000
      onLevel(level + 1)
    }
  })
  return null
}
