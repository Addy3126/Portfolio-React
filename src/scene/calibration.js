// The calibration's decision after measuring every section at one setting (pure, so it can
// be tested on its own). rows: per section { gpu: ms or null, interval: ms }; budget: ms per
// frame at the target rate. Returns { action, tier, scale, note }:
// - 'finish': keep the current setting;
// - 'probe': lots of room, try the next tier up (once);
// - 'revert': the tier tried up didn't fit, go back to the one that did (then finish);
// - 'change': lower the resolution (GPU-bound) or the tier, and measure again.
// With GPU timings there are two checks: the GPU work fits the frame with headroom, and
// frames actually arrive on time. If the GPU fits but frames are late, the main thread is
// the limit: a lower resolution won't help, a lighter tier has fewer passes to issue.
export const TIERS = ['minimal', 'low', 'mid', 'high', 'ultra']
export const HEADROOM = 0.8

export function decide({ rows, budget, tier, scale, probed, late, minScale }) {
  const timed = rows.every((r) => r.gpu !== null && r.gpu !== undefined)
  const gpu = timed ? Math.max(...rows.map((r) => r.gpu)) : null
  const interval = Math.max(...rows.map((r) => r.interval))
  const frameOk = interval <= budget * 1.15
  const gpuOk = timed ? gpu <= budget * HEADROOM : frameOk
  const fits = gpuOk && frameOk
  const note = `${tier}@${Math.round(scale * 100)}%: ${timed ? `GPU ${gpu.toFixed(1)} ms, ` : ''}frame ${interval.toFixed(1)} ms${fits ? ' ok' : ''}`
  const idx = TIERS.indexOf(tier)
  if (fits) {
    if (!late && timed && !probed && scale === 1 && gpu < budget * 0.4 && idx < TIERS.length - 1) return { action: 'probe', tier: TIERS[idx + 1], scale: 1, note }
    return { action: 'finish', tier, scale, note }
  }
  if (probed && probed.tier !== tier) return { action: 'revert', tier: probed.tier, scale: probed.scale, note }
  if (late) return { action: 'finish', tier, scale, note }
  if (!gpuOk && scale > minScale + 1e-3) {
    // GPU-bound: resolution first (fragment work scales with pixels).
    const want = timed ? scale * Math.sqrt((budget * HEADROOM) / gpu) * 0.97 : scale - 0.15
    return { action: 'change', tier, scale: Math.max(minScale, Math.min(scale - 0.05, want)), note }
  }
  if (idx > 0) return { action: 'change', tier: TIERS[idx - 1], scale: 1, note }
  return { action: 'finish', tier, scale, note }
}
