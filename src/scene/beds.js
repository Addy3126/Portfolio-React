import { PIANO_POS, spitPoint } from './world'

// Flower beds: [centre x, centre z, radius x, radius z, lilies, bells, short stems]
// Grass inside a bed is kept low so the flowers stand above it.
const [ax, az] = spitPoint(0.34)
const [bx, bz] = spitPoint(0.8)
export const BEDS = [
  // (The first two were widened when their lilies were doubled, so they don't turn into a carpet.)
  [PIANO_POS.x + 4.6, PIANO_POS.z - 1.3, 2.6, 1.8, 150, 120, false],
  [ax + 1.5, az, 2.8, 2.1, 120, 100, true],
  [bx - 1.6, bz + 0.8, 1.9, 1.4, 95, 80, true],
]

// 0 outside every bed, rising to 1 across the bed (soft edge).
export function bedFactor(x, z) {
  let f = 0
  for (const [cx, cz, rx, rz] of BEDS) {
    const d = Math.hypot((x - cx) / rx, (z - cz) / rz)
    f = Math.max(f, 1 - Math.min(1, Math.max(0, (d - 0.75) / 0.4)))
  }
  return f
}
