// Rendering tiers, lightest to richest. The starting tier is a guess from the device (GPU
// name, memory, phone or desktop); at runtime the scene then adapts (see scene/Perf.jsx):
// render resolution first, then the tier, down when frames run late and back up when there
// is steady headroom. ?quality=minimal|low|mid|high|ultra pins the starting tier.
const TIERS = {
  minimal: { grassDensity: 53, grassHi: 0, grassLo: 14, effects: 'basic', petals: 140, dpr: [0.75, 0.75], reflection: 0 },
  low: { grassDensity: 96, grassHi: 0, grassLo: 20, effects: 'basic', petals: 320, dpr: [1, 1], reflection: 0 },
  mid: { grassDensity: 192, grassHi: 8, grassLo: 24, effects: 'full', petals: 800, dpr: [1, 1.25], reflection: 0.35 },
  high: { grassDensity: 336, grassHi: 10, grassLo: 28, effects: 'full', petals: 1500, dpr: [1, 1.25], reflection: 0.5 },
  ultra: { grassDensity: 456, grassHi: 13, grassLo: 34, effects: 'full', petals: 2000, dpr: [1, 1.5], reflection: 0.6 },
}
export const TIER_ORDER = ['minimal', 'low', 'mid', 'high', 'ultra']

// Frames per second the scene renders at (the page itself still scrolls at full rate).
export const FPS_CAP = 45

export function settingsFor(tierName) {
  const q = { ...TIERS[tierName] }
  q.tier = tierName
  q.godRays = q.effects === 'full'
  q.ao = q.effects === 'full'
  q.contact = tierName === 'high' || tierName === 'ultra'
  return q
}

// The GPU's name, from WebGL (the same string WebGPU adapters describe).
function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return String(name || '')
  } catch {
    return ''
  }
}

function pickTier() {
  const forced = new URLSearchParams(window.location.search).get('quality')
  if (forced && TIERS[forced]) return forced
  const gpu = gpuName().toLowerCase()
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 4
  const memory = navigator.deviceMemory || 8 // GB (Chrome only; capped at 8)
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(gpu)) return 'minimal'
  if (coarse) {
    // Phones and tablets: flagship chips get mid, everything else low.
    if (/apple gpu|adreno \(tm\) (7[3-9]\d|8\d\d)|mali-g7[1-9]|immortalis/.test(gpu) && memory >= 6) return 'mid'
    return memory >= 4 && cores >= 8 ? 'low' : 'minimal'
  }
  // Desktop discrete GPUs, recent generations first.
  if (/rtx [2-5]0\d0|rx [6-9]\d{3}|radeon pro w[6-7]|arc a[57]\d\d|arc b\d{3}|apple m\d (pro|max|ultra)/.test(gpu)) return 'ultra'
  if (/nvidia|geforce|quadro|radeon (rx|pro)|arc a|apple m\d/.test(gpu)) return 'high'
  if (/intel|uhd|iris|vega|radeon\(tm\) graphics|mali|adreno/.test(gpu)) return memory >= 8 && cores >= 8 ? 'mid' : 'low'
  return cores >= 8 ? 'high' : 'mid'
}

export const tier = pickTier()
// Debug switches for tracking down rendering problems, e.g. ?godrays=0&reflection=0.
const params = new URLSearchParams(window.location.search)
const off = (name) => params.get(name) === '0'
export const debug = {
  godRays: !off('godrays'),
  sanitize: !off('sanitize'),
  reflection: !off('reflection'),
  flowers: !off('flowers'),
  shadow: !off('shadow'),
  envCapture: !off('envcap'),
  ao: !off('ao'),
  // ?grassscale= / ?grasswidth= multiply grass blade height / width on top of the defaults
  // in scene/Grass.jsx (for trying out field proportions).
  grassScale: Math.min(2, Math.max(0.2, Number(params.get('grassscale')) || 1)),
  grassWidth: Math.min(2, Math.max(0.2, Number(params.get('grasswidth')) || 1)),
  contact: !off('contact'),
  flare: !off('flare'),
  life: !off('life'),
  grade: !off('grade'),
  // ?tm=agx|aces|neutral picks the tone mapper (for comparisons).
  tm: params.get('tm'),
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
