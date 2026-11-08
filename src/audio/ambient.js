import { motion } from '../store'
import { subscribe as onPiano } from '../piano/engine'
import { lookNew } from '../quality'

// Ambient sound, mixed by where the camera is. Each section has its own set of layers and
// they crossfade as the camera moves between stops:
//
//   layer              landing  about  projects  contact
//   grass rustle        0.5     0.8     0         0.25
//   breeze              0.5     0.3     0.75      0.5
//   evening crickets    0.35    0.6     0         0.25
//   distant surf        0.6     0.35    0         0
//   open-sea swell      0       0       0.8       0.3
//   lapping on towers   0       0       0.7       0
//   window whistles     0.12    0       0.45      0.15
//   shore break         0       0       0         0.9
//   string shimmer      0       0.3     0         0
//
// The water and the crickets are recordings (CC0, public/audio/ambient); the wind, the
// rustle, the hollow tones through broken windows and the piano strings humming on gusts
// are made here from noise and oscillators.
//
// On by default: browsers only allow sound after the first click, tap or key press, so it
// starts then (scrolling alone doesn't count). Turned off with the header's Sound button,
// it stays off on later visits. At the piano it drops to 20%; with the tab hidden it pauses.

export const MIX = {
  rustle: [0.5, 0.8, 0, 0.25],
  breeze: [0.5, 0.3, 0.75, 0.5],
  crickets: [0.35, 0.6, 0, 0.25],
  surf: [0.6, 0.35, 0, 0],
  swell: [0, 0, 0.8, 0.3],
  lapping: [0, 0, 0.7, 0],
  whistle: [0.12, 0, 0.45, 0.15],
  shore: [0, 0, 0, 0.9],
  shimmer: [0, 0.3, 0, 0],
}
// Each layer's own level, so that 1 in the table above is a comfortable loudness.
const LEVEL = { rustle: 0.1, breeze: 0.32, crickets: 0.5, surf: 0.85, swell: 0.75, lapping: 0.55, whistle: 0.5, shore: 0.6, shimmer: 0.024 }
const MASTER = 0.55
const DUCK = 0.2 // at the piano

// The mix at a camera position (0 landing … 3 contact), eased between the stops.
export function mixAt(p) {
  const i = Math.max(0, Math.min(2, Math.floor(p)))
  const t = Math.max(0, Math.min(1, p - i))
  const e = t * t * (3 - 2 * t)
  const out = {}
  for (const [k, v] of Object.entries(MIX)) out[k] = (v[i] + (v[i + 1] - v[i]) * e) * LEVEL[k]
  return out
}

const FILES = ['water-bed', 'crickets', 'shore-1', 'shore-2', 'shore-3', 'shore-4', 'splash-1', 'splash-2']

function noise(ctx, seconds, kind) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let b = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'brown') {
        b = (b + 0.02 * w) / 1.02
        d[i] = b * 3.5
      } else d[i] = w
    }
  }
  return buf
}

// The graph: one gain per layer (set by mixAt), on any audio context (so it can also be
// rendered offline to check levels). buffers: decoded recordings by name, or {} (the
// recorded layers then stay silent until they arrive: see addRecordings).
export function buildGraph(ctx, dest) {
  const g = {}
  const layer = (name) => {
    const n = ctx.createGain()
    n.gain.value = 0
    n.connect(dest)
    g[name] = n
    return n
  }
  const loop = (buffer, offset = 0) => {
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.loop = true
    s.start(0, offset % buffer.duration)
    return s
  }
  const lfo = (freq, depth, target, type = 'sine') => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const d = ctx.createGain()
    d.gain.value = depth
    o.connect(d)
    d.connect(target)
    o.start()
  }
  const filter = (type, freq, q = 0.7) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  // Gusts: one slow wind envelope shared by the rustle, the whistles and the strings.
  const one = ctx.createConstantSource() // a steady 1, shaped into the gust envelope
  one.start()
  const gust = ctx.createGain()
  gust.gain.value = 0.55
  lfo(0.043, 0.3, gust.gain)
  lfo(0.11, 0.15, gust.gain)
  one.connect(gust)
  const white = noise(ctx, 6, 'white')
  const brown = noise(ctx, 8, 'brown')

  // Grass rustle: bright noise, swelling with the gusts.
  const rustleIn = ctx.createGain()
  rustleIn.gain.value = 0
  gust.connect(rustleIn.gain) // gust envelope modulates the rustle
  loop(white).connect(filter('highpass', 2200)).connect(filter('bandpass', 4200, 0.6)).connect(rustleIn)
  rustleIn.connect(layer('rustle'))

  // Breeze: soft broadband wind, its colour wandering.
  const breezeBp = filter('bandpass', 520, 0.6)
  lfo(0.05, 220, breezeBp.frequency)
  const breezeAmp = ctx.createGain()
  breezeAmp.gain.value = 0.7
  lfo(0.031, 0.25, breezeAmp.gain)
  loop(brown, 2).connect(breezeBp).connect(breezeAmp).connect(layer('breeze'))

  // Hollow tones through broken windows: narrow resonances on the wind, rising with gusts.
  const whistleIn = ctx.createGain()
  whistleIn.gain.value = 0
  gust.connect(whistleIn.gain)
  const whistleSrc = loop(white, 3)
  for (const [f, q] of [
    [523, 28],
    [784, 32],
    [1175, 36],
  ]) {
    const bp = filter('bandpass', f, q)
    lfo(0.07 + f / 40000, f * 0.012, bp.frequency) // a slow waver in pitch
    whistleSrc.connect(bp).connect(whistleIn)
  }
  whistleIn.connect(layer('whistle'))

  // Piano strings humming on the gusts: soft partials of a G major chord.
  const shimmerIn = ctx.createGain()
  shimmerIn.gain.value = 0
  gust.connect(shimmerIn.gain)
  for (const f of [98, 147, 196, 247, 294, 392]) {
    const o = ctx.createOscillator()
    o.frequency.value = f
    o.detune.value = (Math.random() - 0.5) * 8
    const a = ctx.createGain()
    a.gain.value = 0.5
    lfo(0.05 + Math.random() * 0.05, 0.45, a.gain)
    o.connect(a).connect(shimmerIn)
    o.start()
  }
  shimmerIn.connect(filter('lowpass', 900)).connect(layer('shimmer'))

  // Layers fed by recordings get their gain nodes now and their sources when decoded.
  layer('surf')
  layer('swell')
  layer('lapping')
  layer('crickets')
  layer('shore')
  return g
}

// The recorded layers, once decoded. The one water recording serves three ways: muffled
// for the distant surf, deep and slow for the open-sea swell, close and bright for the
// lapping round the towers (plus splashes against the walls); the shore break is single
// waves at random intervals, each a little different.
export function addRecordings(ctx, g, buffers, schedule = true) {
  const loop = (buffer, offset) => {
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.loop = true
    s.start(0, offset % buffer.duration)
    return s
  }
  const filter = (type, freq, q = 0.7) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }
  const water = buffers['water-bed']
  if (water) {
    loop(water, 0).connect(filter('lowpass', 380)).connect(g.surf)
    const swellAmp = ctx.createGain()
    swellAmp.gain.value = 0.7
    const o = ctx.createOscillator()
    o.frequency.value = 0.09
    const d = ctx.createGain()
    d.gain.value = 0.3
    o.connect(d).connect(swellAmp.gain)
    o.start()
    const s = loop(water, 13)
    s.playbackRate.value = 0.82 // deeper
    s.connect(filter('lowpass', 700)).connect(swellAmp).connect(g.swell)
    loop(water, 27).connect(filter('highpass', 260)).connect(g.lapping)
  }
  if (buffers.crickets) loop(buffers.crickets, 0).connect(filter('lowpass', 7000)).connect(g.crickets)
  if (!schedule) return
  const oneShot = (name, dest, rate, gain) => {
    const b = buffers[name]
    if (!b) return
    const s = ctx.createBufferSource()
    s.buffer = b
    s.playbackRate.value = rate
    const a = ctx.createGain()
    a.gain.value = gain
    s.connect(a).connect(dest)
    s.start()
  }
  const pick = (names) => names[Math.floor(Math.random() * names.length)]
  // Shore break every 5–9 s; splashes on the towers every 3–7 s (only heard where their
  // layers are up, so they can run all the time).
  const shore = () => {
    oneShot(pick(['shore-1', 'shore-2', 'shore-3', 'shore-4']), g.shore, 0.9 + Math.random() * 0.15, 0.7 + Math.random() * 0.3)
    timers.push(setTimeout(shore, 5000 + Math.random() * 4000))
  }
  const splash = () => {
    oneShot(pick(['splash-1', 'splash-2']), g.lapping, 0.85 + Math.random() * 0.25, 0.35 + Math.random() * 0.35)
    timers.push(setTimeout(splash, 3000 + Math.random() * 4000))
  }
  shore()
  splash()
}

// --- Runtime ---------------------------------------------------------------------------
const STORE = 'nocturne-sound'
const remembered = () => {
  try {
    return localStorage.getItem(STORE)
  } catch {
    return null
  }
}
export const ambient = { on: lookNew && remembered() !== 'off', listeners: new Set() }

let ctx = null
let master = null
let graph = null
let mixTimer = null
let ducked = false
const timers = []

function level() {
  if (!ambient.on || document.hidden) return 0
  return MASTER * (ducked ? DUCK : 1)
}
function applyLevel(time = 0.6) {
  if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, time)
}

function start() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume()
    return
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)
  graph = buildGraph(ctx, master)
  const base = import.meta.env.BASE_URL
  Promise.all(
    FILES.map((f) =>
      fetch(`${base}audio/ambient/${f}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => [f, buf])
        .catch(() => [f, null]),
    ),
  ).then((list) => addRecordings(ctx, graph, Object.fromEntries(list.filter(([, b]) => b))))
  const mix = () => {
    const m = mixAt(motion.progress)
    for (const [k, v] of Object.entries(m)) graph[k].gain.setTargetAtTime(v, ctx.currentTime, 0.5)
  }
  mix()
  mixTimer = setInterval(mix, 120)
  applyLevel(1.2) // fade in
}

export function setAmbient(on) {
  ambient.on = on
  try {
    localStorage.setItem(STORE, on ? 'on' : 'off')
  } catch {
    /* storage unavailable: the choice holds for this visit */
  }
  if (on) start()
  applyLevel()
  ambient.listeners.forEach((fn) => fn(on))
}

// Start on the first interaction, if it's on.
function arm() {
  const go = () => {
    window.removeEventListener('pointerdown', go, true)
    window.removeEventListener('keydown', go, true)
    window.removeEventListener('touchend', go, true)
    if (ambient.on) start()
  }
  window.addEventListener('pointerdown', go, true)
  window.addEventListener('keydown', go, true)
  window.addEventListener('touchend', go, true)
  document.addEventListener('visibilitychange', () => applyLevel(0.3))
  // At the piano: ambience down to 20% so the notes sit on top.
  onPiano((e) => {
    if (e.type !== 'play') return
    ducked = e.on
    applyLevel(0.6)
  })
}
if (typeof window !== 'undefined' && lookNew) arm() // (the earlier look had no sound)

// A soft tick for hovering a project tower, a two-note chime for choosing one.
export function uiSound(kind) {
  if (!ctx || !ambient.on || document.hidden) return
  const t = ctx.currentTime
  const notes = kind === 'select' ? [880, 1320] : [1560]
  notes.forEach((f, i) => {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    const a = ctx.createGain()
    const t0 = t + i * 0.07
    a.gain.setValueAtTime(0, t0)
    a.gain.linearRampToValueAtTime(kind === 'select' ? 0.05 : 0.025, t0 + 0.005)
    a.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === 'select' ? 0.6 : 0.09))
    o.connect(a).connect(ctx.destination)
    o.start(t0)
    o.stop(t0 + 0.7)
  })
}
export const _internals = { timers, mixTimer: () => mixTimer, master: () => master, ctx: () => ctx }
