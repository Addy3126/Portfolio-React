// The playable piano: note state, sound and sequencing, shared by the 3D piano (key motion,
// glow), the scene effects and the overlay (hints, buttons). Plain module state plus a tiny
// event bus, so nothing re-renders React per note.
import { motion } from '../store'

// --- The 88 keys: A0 (MIDI 21) to C8 (108), in the order the model builds them. ---
const LETTERS = 'ABCDEFG'
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
export const WHITE_MIDI = Array.from({ length: 52 }, (_, i) => 12 * (Math.floor((i + 5) / 7) + 1) + SEMI[LETTERS[i % 7]])
export const BLACK_MIDI = []
WHITE_MIDI.forEach((m, i) => i < 51 && 'ACDFG'.includes(LETTERS[i % 7]) && BLACK_MIDI.push(m + 1))
export const LOWEST = 21
export const HIGHEST = 108
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12)

// --- State read by the scene every frame ---
export const keys = {
  down: new Uint8Array(128), // held now (by any source)
  glow: new Float32Array(128), // 1 on press, fades in the scene
  energy: 0, // recent loudness, for the lid inlay
}
export const piano = { playing: false, sustain: false, octave: 4, mode: 'free' } // mode: free | demo | replay

const listeners = new Set()
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (e) => listeners.forEach((fn) => fn(e))

// --- Audio: Salamander Grand Piano samples (CC BY 3.0, Alexander Holm), one every minor
// third, re-pitched in between; a soft synthesised piano covers any not loaded yet. ---
let ctx = null
let out = null
const buffers = new Map() // sample MIDI -> AudioBuffer
const SAMPLE_PC = { C: 0, Ds: 3, Fs: 6, A: 9 }
const SAMPLES = []
for (let o = 0; o <= 8; o++)
  for (const n of ['A', 'C', 'Ds', 'Fs']) {
    const m = 12 * (o + 1) + SAMPLE_PC[n]
    if (m >= 21 && m <= 108) SAMPLES.push({ name: `${n}${o}`, midi: m })
  }

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return ir
}

// Called from the "Play the piano" click (browsers only start audio from a user gesture).
export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume()
    return
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' })
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -12
  comp.ratio.value = 4
  comp.connect(ctx.destination)
  out = ctx.createGain()
  out.gain.value = 0.85
  // A little open-air reverb.
  const verb = ctx.createConvolver()
  verb.buffer = impulse(2.4, 3.2)
  const wet = ctx.createGain()
  wet.gain.value = 0.22
  out.connect(comp)
  out.connect(verb)
  verb.connect(wet)
  wet.connect(comp)
  // Load the samples, nearest middle C first.
  const base = import.meta.env.BASE_URL
  ;[...SAMPLES]
    .sort((a, b) => Math.abs(a.midi - 60) - Math.abs(b.midi - 60))
    .forEach((s) =>
      fetch(`${base}audio/piano/${s.name}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => {
          buffers.set(s.midi, buf)
          window.__pianoSamples = buffers.size // for checks
        })
        .catch(() => {}),
    )
}

const voices = new Map() // midi -> [{ gain, stop }]
const sustained = new Set() // released while the pedal is down

function startVoice(midi, vel) {
  const t = ctx.currentTime
  const gain = ctx.createGain()
  const level = 0.18 + vel * 0.62
  gain.connect(out)
  // Nearest loaded sample.
  let best = null
  for (const [m, buf] of buffers) if (!best || Math.abs(m - midi) < Math.abs(best.m - midi)) best = { m, buf }
  let stopAt
  if (best && Math.abs(best.m - midi) <= 4) {
    const src = ctx.createBufferSource()
    src.buffer = best.buf
    src.playbackRate.value = Math.pow(2, (midi - best.m) / 12)
    src.connect(gain)
    gain.gain.setValueAtTime(level, t)
    src.start(t)
    stopAt = (when) => src.stop(when)
  } else {
    // Fallback: a soft struck tone (triangle + a quiet octave), decaying like a piano.
    const f = 440 * Math.pow(2, (midi - 69) / 12)
    const oscs = [
      [f, 'triangle', 1],
      [f * 2, 'sine', 0.25],
    ].map(([freq, type, amp]) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.value = freq
      g.gain.value = amp
      o.connect(g)
      g.connect(gain)
      o.start(t)
      return o
    })
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level * 0.6, t + 0.005)
    gain.gain.setTargetAtTime(0, t + 0.005, 0.6 + (108 - midi) / 60)
    stopAt = (when) => oscs.forEach((o) => o.stop(when))
  }
  const v = { gain, stop: stopAt }
  if (!voices.has(midi)) voices.set(midi, [])
  voices.get(midi).push(v)
  return v
}

function releaseVoices(midi, time = 0.12) {
  const list = voices.get(midi)
  if (!list) return
  const t = ctx.currentTime
  for (const v of list) {
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setTargetAtTime(0, t, time)
    try {
      v.stop(t + time * 8)
    } catch {
      /* already stopped */
    }
  }
  voices.delete(midi)
}

// --- Recording ---
let recording = null // { start, events }
let lastTake = null

export function noteOn(midi, vel = 0.75, source = 'user') {
  if (midi < LOWEST || midi > HIGHEST) return
  if (ctx) {
    if (keys.down[midi]) releaseVoices(midi, 0.03) // re-strike
    sustained.delete(midi)
    startVoice(midi, vel)
  }
  keys.down[midi] = 1
  keys.glow[midi] = 1
  keys.energy = Math.min(2, keys.energy + vel * 0.6)
  if (recording && source === 'user') recording.events.push([performance.now() - recording.start, 1, midi, vel])
  emit({ type: 'on', midi, vel, source })
}

export function noteOff(midi, source = 'user') {
  if (!keys.down[midi]) return
  keys.down[midi] = 0
  if (ctx) {
    if (piano.sustain) sustained.add(midi)
    else releaseVoices(midi, midi > 88 ? 0.08 : 0.14)
  }
  if (recording && source === 'user') recording.events.push([performance.now() - recording.start, 0, midi, 0])
  emit({ type: 'off', midi, source })
}

export function setSustain(on, source = 'user') {
  if (piano.sustain === on) return
  piano.sustain = on
  if (!on && ctx) {
    for (const m of sustained) if (!keys.down[m]) releaseVoices(m, 0.25)
    sustained.clear()
  }
  if (recording && source === 'user') recording.events.push([performance.now() - recording.start, on ? 2 : 3, 0, 0])
  emit({ type: 'sustain', on })
}

export function allOff() {
  for (let m = 0; m < 128; m++) if (keys.down[m]) noteOff(m, 'system')
  setSustain(false, 'system')
  if (ctx) for (const m of [...voices.keys()]) releaseVoices(m, 0.2)
}

export function setOctave(o) {
  piano.octave = Math.max(1, Math.min(6, o))
  emit({ type: 'octave', octave: piano.octave })
}

export function startRecording() {
  stopSequence()
  recording = { start: performance.now(), events: [] }
  emit({ type: 'record', on: true })
}
export function stopRecording() {
  if (!recording) return
  if (recording.events.length) lastTake = recording.events
  recording = null
  emit({ type: 'record', on: false, hasTake: !!lastTake })
}
export const isRecording = () => !!recording
export const hasTake = () => !!lastTake

// --- Sequences (demo piece, replays): [ms, kind (1 on, 0 off, 2/3 pedal), midi, vel] ---
let seq = null
export function playSequence(events, mode) {
  stopSequence()
  allOff()
  const start = performance.now() + 150
  let i = 0
  piano.mode = mode
  const tick = () => {
    const now = performance.now() - start
    while (i < events.length && events[i][0] <= now) {
      const [, kind, midi, vel] = events[i++]
      if (kind === 1) noteOn(midi, vel, mode)
      else if (kind === 0) noteOff(midi, mode)
      else setSustain(kind === 2, mode)
    }
    if (i >= events.length) {
      seq = setTimeout(() => {
        allOff()
        seq = null
        piano.mode = 'free'
        emit({ type: 'sequence', on: false })
      }, 1500)
      return
    }
    seq = setTimeout(tick, 8)
  }
  seq = setTimeout(tick, 0)
  emit({ type: 'sequence', on: true, mode })
}
export function stopSequence() {
  if (!seq) return
  clearTimeout(seq)
  seq = null
  piano.mode = 'free'
  allOff()
  emit({ type: 'sequence', on: false })
}
export const replayTake = () => lastTake && playSequence(lastTake, 'replay')

// --- Entering and leaving ---
export function enterPlay() {
  ensureAudio()
  piano.playing = true
  motion.playing = true
  emit({ type: 'play', on: true })
}
export function exitPlay() {
  stopSequence()
  stopRecording()
  allOff()
  piano.playing = false
  motion.playing = false
  emit({ type: 'play', on: false })
}
