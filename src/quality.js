// Picks a rendering tier once at startup. Override with ?quality=low|mid|high.
const TIERS = {
  high: { grassDensity: 140, grassHi: 10, grassLo: 28, effects: 'full', petals: 1500, dpr: [1, 1.25], reflection: 0.5 },
  mid: { grassDensity: 80, grassHi: 8, grassLo: 24, effects: 'full', petals: 800, dpr: [1, 1.25], reflection: 0.35 },
  low: { grassDensity: 40, grassHi: 0, grassLo: 20, effects: 'basic', petals: 320, dpr: [1, 1], reflection: 0 },
}

// Frames per second the scene renders at (the page itself still scrolls at full rate).
export const FPS_CAP = 45

// Auto quality steps down from the starting tier when frames run long.
// 0 = as detected, 1 = lighter, 2 = lightest.
export const MAX_LEVEL = 2
export function settingsFor(level) {
  const q = { ...TIERS[tier] }
  q.godRays = q.effects === 'full' && level < 1
  q.dof = q.effects === 'full' && level < 2
  if (level >= 1) {
    q.dpr = [1, 1]
    q.grassHi *= 0.7
    q.grassDensity = Math.round(q.grassDensity * 0.85)
    q.reflection *= 0.6
  }
  if (level >= 2) {
    q.reflection = 0
    q.grassHi = 0 // simple blades only
    q.grassDensity = Math.round(q.grassDensity * 0.6)
    q.petals = Math.round(q.petals * 0.6)
  }
  return q
}

function pickTier() {
  const forced = new URLSearchParams(window.location.search).get('quality')
  if (forced && TIERS[forced]) return forced
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 4
  if (coarse) return cores >= 8 ? 'mid' : 'low'
  return cores >= 8 ? 'high' : 'mid'
}

export const tier = pickTier()
export const quality = TIERS[tier]
// Debug switches for tracking down rendering problems, e.g. ?godrays=0&dof=0.
const params = new URLSearchParams(window.location.search)
const off = (name) => params.get(name) === '0'
export const debug = {
  godRays: !off('godrays'),
  dof: !off('dof'),
  sanitize: !off('sanitize'),
  reflection: !off('reflection'),
  flowers: !off('flowers'),
  shadow: !off('shadow'),
  // ?fps=0 renders every display frame (no cap); ?fps=60 sets a different cap.
  fps: params.has('fps') ? Number(params.get('fps')) : FPS_CAP,
  // ?msaa=0|2|4 overrides multisampling.
  msaa: params.has('msaa') ? Number(params.get('msaa')) : null,
}
// Debug: ?grass=0 hides grass and field flowers (useful for inspecting the piano).
export const grassEnabled = new URLSearchParams(window.location.search).get('grass') !== '0'
// Debug: ?autoquality=0 keeps the starting tier even if frames run long.
export const autoQualityEnabled = new URLSearchParams(window.location.search).get('autoquality') !== '0'
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
