// Picks a rendering tier once at startup. Override with ?quality=low|mid|high.
const TIERS = {
  high: { grass: 70000, petals: 2400, dpr: [1, 2], multisampling: 4, reflection: 0.5 },
  mid: { grass: 36000, petals: 1200, dpr: [1, 1.5], multisampling: 4, reflection: 0.35 },
  low: { grass: 20000, petals: 480, dpr: [1, 1.25], multisampling: 0, reflection: 0 },
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
