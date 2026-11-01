// Small 3D value noise for building geometry at load time.
const fract = (v) => v - Math.floor(v)
export const hash3 = (i, j, k) => fract(Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453)

export function noise3(x, y, z) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const l = (a, b, t) => a + (b - a) * t
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k)
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}

export function fbm3(x, y, z, octaves = 4) {
  let s = 0
  let a = 0.5
  for (let i = 0; i < octaves; i++) {
    s += a * noise3(x, y, z)
    x = x * 2.02 + 11.3
    y = y * 2.02 + 7.1
    z = z * 2.02 + 3.7
    a *= 0.5
  }
  return s
}

// Sharp ridges (creases) for rocky detail.
export const ridged3 = (x, y, z) => 1 - Math.abs(noise3(x, y, z) * 2 - 1)

export function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
