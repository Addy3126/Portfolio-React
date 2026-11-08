import { motion } from '../store'

// Optional ambient sound, off until the visitor turns it on (the header's Sound button):
// waves and wind, made from filtered noise (no audio files to download). The waves are
// brown noise through a low-pass, swelling with two slow, out-of-step oscillators; the wind
// is white noise through a wandering band-pass. The mix follows the camera: more sea
// toward Projects and Contact, more wind over the field.
export const ambient = { on: false, listeners: new Set() }

let ctx = null
let master = null
let wavesGain = null
let windGain = null
let timer = null

function noise(seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else d[i] = w
    }
  }
  return buf
}

function loop(buffer) {
  const s = ctx.createBufferSource()
  s.buffer = buffer
  s.loop = true
  s.start()
  return s
}

function lfo(freq, depth, target) {
  const o = ctx.createOscillator()
  o.frequency.value = freq
  const g = ctx.createGain()
  g.gain.value = depth
  o.connect(g)
  g.connect(target)
  o.start()
}

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)

  // Waves.
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 420
  lp.Q.value = 0.4
  wavesGain = ctx.createGain()
  wavesGain.gain.value = 0
  const swell = ctx.createGain()
  swell.gain.value = 0.6
  lfo(0.11, 0.32, swell.gain)
  lfo(0.067, 0.18, swell.gain)
  loop(noise(8, true)).connect(lp)
  lp.connect(swell)
  swell.connect(wavesGain)
  wavesGain.connect(master)

  // Wind.
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 650
  bp.Q.value = 0.7
  lfo(0.05, 260, bp.frequency)
  windGain = ctx.createGain()
  windGain.gain.value = 0
  const gust = ctx.createGain()
  gust.gain.value = 0.5
  lfo(0.043, 0.35, gust.gain)
  loop(noise(6, false)).connect(bp)
  bp.connect(gust)
  gust.connect(windGain)
  windGain.connect(master)
}

function mix() {
  const p = motion.progress // 0 landing … 3 contact
  const sea = 0.45 + 0.55 * Math.min(1, Math.max(0, (p - 1) / 1.2))
  const field = 1 - 0.6 * Math.min(1, Math.max(0, (p - 1) / 1.5))
  const t = ctx.currentTime
  wavesGain.gain.setTargetAtTime(sea * 0.7, t, 0.8)
  windGain.gain.setTargetAtTime(field * 0.12, t, 0.8)
}

export function setAmbient(on) {
  if (on && !ctx) build()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume()
  ambient.on = on
  master.gain.setTargetAtTime(on ? 0.35 : 0, ctx.currentTime, 0.7)
  clearInterval(timer)
  if (on) {
    mix()
    timer = setInterval(mix, 250)
  }
  ambient.listeners.forEach((fn) => fn(on))
}
