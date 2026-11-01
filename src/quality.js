// Picks a rendering tier once at startup. Override with ?quality=low|mid|high.
const TIERS = {
  high: { grassNear: 95000, grassFar: 45000, effects: 'full', petals: 1500, dpr: [1, 1.25], reflection: 0.5 },
  mid: { grassNear: 48000, grassFar: 22000, effects: 'full', petals: 800, dpr: [1, 1.25], reflection: 0.35 },
  low: { grassNear: 20000, grassFar: 9000, effects: 'basic', petals: 320, dpr: [1, 1], reflection: 0 },
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
    q.reflection *= 0.6
  }
  if (level >= 2) {
    q.reflection = 0
    q.grassNear = Math.round(q.grassNear * 0.6)
    q.grassFar = Math.round(q.grassFar * 0.6)
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
// Debug: ?grass=0 hides grass and field flowers (useful for inspecting the piano).
export const grassEnabled = new URLSearchParams(window.location.search).get('grass') !== '0'
// Debug: ?autoquality=0 keeps the starting tier even if frames run long.
export const autoQualityEnabled = new URLSearchParams(window.location.search).get('autoquality') !== '0'
export const bloomEnabled = new URLSearchParams(window.location.search).get('bloom') !== '0'
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
