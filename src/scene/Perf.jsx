import './threeLog'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { calibrate, debug, markCalibrationStale, saveCalibration, settingsFor } from '../quality'
import { decide } from './calibration'
import { motion, setLoadingStage } from '../store'
import { texturesReady } from '../textureReady'

// Live numbers for the ?hud=1 readout (and tests): frame interval, main-thread time per
// frame, GPU time per frame (WebGPU timestamp queries, where the browser offers them).
export const perf = { intervals: [], cpu: [], gpu: [], sink: null }
const keep = (arr, v, n = 120) => {
  arr.push(v)
  if (arr.length > n) arr.shift()
}
const median = (arr) => {
  if (!arr.length) return null
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}

// Startup, behind the loading screen, in three steps:
// 1. Warm-up tour: once the textures are in, render a frame from each section's camera and
//    from mid-flight, so every shader is compiled and every texture is on the GPU before the
//    page shows (otherwise each section stalled on its first visit).
// 2. Calibration (first visit on this GPU and screen): render each section for a few
//    frames and measure the GPU time per frame (timestamp queries; without them, whether
//    frames keep up with the display). If the heaviest section doesn't fit the frame budget,
//    lower the render resolution, then the tier (and warm up again), and measure again; if
//    there's lots of room, try one tier up.
// 3. Settle: the result is fixed for the visit (nothing switches while browsing) and
//    remembered for the next one.
const TOUR = [1, 2, 3, 2.5, 1.5, 0.5, 0]
// Measured: the stops and the two long flights (landing to About crosses the whole field,
// Projects to Contact the sea at its widest).
const MEASURE = [0, 0.5, 1, 2, 2.5, 3]
const SETTLE = 2 // frames after moving before measuring (level of detail, uploads)
const SAMPLES = 6
const MAX_TIME = 20000 // ms: make no further changes after this
const HARD_STOP = 30000 // ms: stop measuring, keep what we have
const minScale = (tierName) => (Math.max(1, Math.min(window.devicePixelRatio, settingsFor(tierName).dpr[1])) > 1.2 ? 0.7 : 0.85)

export function Startup({ tier, scale, onQuality, onDone }) {
  const gl = useThree((s) => s.gl)
  const st = useRef(null)
  if (!st.current) st.current = { phase: 'wait', mounted: 0, live: true, i: 0, f: 0, m: 0, last: 0, tier, scale, saved: 0, t0: 0, rows: [], probed: null, failed: new Set(), log: [], times: {}, phaseT: 0 }

  useEffect(() => {
    const s = st.current
    s.live = true
    calibrated.done = false // (again, if the WebGL scene takes over from a failed WebGPU one)
    return () => {
      s.live = false
      perf.sink = null
    }
  }, [])

  useFrame(() => {
    const s = st.current
    const now = performance.now()
    // Wait a few frames so everything has mounted and queued its downloads, then for those,
    // then two frames' grace for what mounts once its download is in.
    if (++s.mounted === 3) texturesReady().then(() => s.live && s.phase === 'wait' && Object.assign(s, { phase: 'grace', i: 2 }))
    if (s.phase === 'wait' || s.phase === 'done') return

    const begin = (phase) => {
      setLoadingStage(phase === 'warm' ? 'Warming up' : 'Finding the right settings for this screen')
      // Time per phase, for the ?hud=1 readout (where a slow first visit spends its seconds).
      if (s.phaseT) s.times[s.phase] = (s.times[s.phase] || 0) + (now - s.phaseT)
      s.phaseT = now
      Object.assign(s, { phase, i: 0, f: 0, m: 0, rows: [], last: 0 })
    }
    const finish = () => {
      motion.progress = s.saved
      if (calibrate) saveCalibration(s.tier, s.scale)
      if (gl.backend && !debug.hud) gl.backend.trackTimestamp = false // no query cost while browsing
      perf.sink = null
      if (s.phaseT) s.times[s.phase] = (s.times[s.phase] || 0) + (now - s.phaseT)
      s.phase = 'done'
      calibrated.done = true
      window.__calibration = { tier: s.tier, scale: s.scale, ms: Math.round(now - s.t0), steps: s.log, times: Object.fromEntries(Object.entries(s.times).map(([k, v]) => [k, Math.round(v)])) }
      onDone()
    }
    const change = (tierName, sc) => {
      const recompile = tierName !== s.tier
      s.tier = tierName
      s.scale = sc
      onQuality(tierName, sc)
      begin(recompile ? 'warm' : 'measure')
    }

    if (s.phase === 'grace') {
      if (--s.i > 0) return
      s.saved = motion.progress
      s.t0 = now
      begin('warm')
    }

    if (s.phase === 'warm') {
      if (s.i < TOUR.length) {
        motion.progress = TOUR[s.i++] // the camera rig (next in the frame) places the camera
        return
      }
      if (s.revert) return finish() // back on the last tier that fitted, now warmed up
      if (!calibrate) return finish()
      begin('measure')
    }

    // phase 'measure'
    if (now - s.t0 > HARD_STOP) {
      // Frames this slow mean the tier is far too heavy: settle on the lightest (warmed up
      // first), unless already there.
      s.log.push('out of time')
      if (s.tier === 'minimal' || s.revert) return finish()
      s.revert = true
      return change('minimal', 1)
    }
    motion.progress = MEASURE[s.m]
    const dt = s.last ? now - s.last : 0
    s.last = now
    if (s.f === SETTLE) {
      s.intervals = []
      s.gpu = []
      perf.sink = s.gpu
    }
    if (s.f > SETTLE) s.intervals.push(dt)
    if (++s.f < SETTLE + SAMPLES + 1) return
    s.rows.push({ interval: median(s.intervals), gpu: median(s.gpu) })
    s.f = 0
    s.last = 0
    if (++s.m < MEASURE.length) return

    // Decide (scene/calibration.js) and act.
    const d = decide({ rows: s.rows, budget: 1000 / pace.fps, tier: s.tier, scale: s.scale, probed: s.probed, late: now - s.t0 > MAX_TIME, minScale: minScale(s.tier) })
    s.log.push(d.note)
    if (d.action === 'probe') s.probed = { tier: s.tier, scale: s.scale }
    if (d.action === 'revert') s.revert = true
    if (d.action === 'finish') return finish()
    change(d.tier, d.scale)
  }, -10)
  return null
}

// After settling, watch in 10-second windows (visible tab only) for a sustained run of late
// frames: two windows in a row with over a third of frames late flags the remembered result
// for re-testing on the next visit (nothing changes now).
function watchStale(s, dt, now) {
  if (!calibrated.done || document.hidden || dt > 1000) return
  if (!s.win) s.win = now
  s.n++
  if (dt > (1000 / pace.fps) * 1.5) s.slow++
  if (now - s.win < 10000) return
  s.bad = s.slow > s.n / 3 ? s.bad + 1 : 0
  if (s.bad === 2) markCalibrationStale()
  s.win = now
  s.n = s.slow = 0
}
export const calibrated = { done: false }

// Per-frame numbers: main-thread time (first to last frame callback, which includes the
// render calls), the interval between frames, and GPU time from timestamp queries. Also the
// render counts for ?stats=1 (window.__stats).
export function Probe() {
  const st = useRef({ start: 0, last: 0, since: 0, pending: false, win: 0, slow: 0, n: 0, bad: 0 })
  useFrame(({ gl }) => {
    const s = st.current
    s.start = performance.now()
    if (s.last) {
      const dt = s.start - s.last
      keep(perf.intervals, dt)
      watchStale(s, dt, s.start)
    }
    s.last = s.start
    gl.info.autoReset = false
    gl.info.reset()
  }, -1000)
  useFrame(({ gl }) => {
    const s = st.current
    keep(perf.cpu, performance.now() - s.start)
    const r = gl.info.render
    window.__gl = gl
    window.__stats = { triangles: r.triangles, calls: r.drawCalls ?? r.calls, programs: gl.info.programs?.length ?? null }
    window.__perf = perf
    // GPU time: resolve the queries of the frames since the last resolve, per frame.
    s.since++
    if (gl.backend?.trackTimestamp && !s.pending) {
      const n = s.since
      s.since = 0
      s.pending = true
      gl.resolveTimestampsAsync('render')
        .then((d) => {
          if (d > 0 && n > 0) {
            keep(perf.gpu, d / n)
            perf.sink?.push(d / n)
          }
        })
        .catch(() => {})
        .finally(() => (s.pending = false))
    }
  }, 1000)
  return null
}

// The frame rate the scene renders at (the calibration's frame budget).
export const pace = { fps: 60 }
// Highest rate the scene renders at automatically.
const MAX_FPS = 75

// Drives the on-demand render loop. With no fixed rate (the default) it renders on every
// k-th display refresh, k picked so the rate is at most MAX_FPS: 60 Hz and 120 Hz screens
// get 60 fps, 144 Hz gets 72, 200 Hz gets 66.7. An even divisor of the refresh keeps every frame on screen
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
    // The display's refresh, from the gaps between animation frames (they come every refresh
    // whether or not we render): first over half a second with nothing rendering (the loading
    // screen is up), then kept up to date for the whole visit, so a reading spoiled by loading
    // work, or a window moved to another screen, corrects itself. A low percentile, so frames
    // held up by other work don't count; no snapping to a list (screens run at 200 Hz, 100 Hz…).
    const gaps = []
    let last = 0
    let every = 1
    let n = 0
    let refresh = 0
    let ticks = 0
    const estimate = () => {
      const sorted = [...gaps].sort((a, b) => a - b)
      const hz = Math.round(1000 / sorted[Math.floor(sorted.length * 0.1)])
      if (Math.abs(hz - refresh) <= Math.max(2, refresh * 0.03)) return // same screen, noise
      refresh = hz
      every = Math.max(1, Math.ceil(refresh / MAX_FPS - 0.01))
      pace.fps = refresh / every
      window.__pace = { refresh, every, fps: Math.round(pace.fps * 10) / 10 }
    }
    const tick = (t) => {
      raf = requestAnimationFrame(tick)
      if (last && t - last < 100) {
        gaps.push(t - last)
        if (gaps.length > 240) gaps.shift()
      }
      last = t
      if (!refresh) {
        if (gaps.length >= 30) estimate()
        return
      }
      if (++ticks % 120 === 0) estimate()
      if (++n % every === 0) invalidate()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fps, invalidate])
  return null
}

