import * as THREE from 'three'

// Piano coordinate frame (group origin = front edge of the case at the keyboard):
//   x: along the piano, 0 at the keyboard end, L at the tail
//   s: across the case, 0 on the straight spine (bass side), W on the curved bentside
//   world z = s - W / 2
export const W = 1.48
export const HALF = W / 2
export const RIM_BOTTOM = 0.66
export const RIM_H = 0.3
export const RIM_TOP = RIM_BOTTOM + RIM_H
export const WALL = 0.045

// Case outline as points in (x, s).
export function outline(L, n = 260) {
  const shape = new THREE.Shape()
  const P = (x, s) => [x, s]
  shape.moveTo(...P(0, 0))
  shape.lineTo(...P(0, W))
  shape.lineTo(...P(0.24 * L, W))
  shape.bezierCurveTo(...P(0.43 * L, W), ...P(0.48 * L, 0.66 * W), ...P(0.65 * L, 0.56 * W))
  shape.bezierCurveTo(...P(0.83 * L, 0.46 * W), ...P(L, 0.42 * W), ...P(L, 0.2 * W))
  shape.quadraticCurveTo(...P(L, 0), ...P(L - 0.2, 0))
  shape.lineTo(...P(0, 0))
  const pts = shape.getSpacedPoints(n)
  if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop()
  return pts
}

const area = (pts) => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

// Offset a closed polygon inward (d > 0) or outward (d < 0).
export function offset(pts, d) {
  const ccw = area(pts) > 0
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length]
    const b = pts[(i + 1) % pts.length]
    const t = new THREE.Vector2().subVectors(b, a).normalize()
    const left = new THREE.Vector2(-t.y, t.x)
    const inward = ccw ? left : left.negate()
    return new THREE.Vector2(p.x + inward.x * d, p.y + inward.y * d)
  })
}

export function inside(pts, x, y) {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

// (x, s) shape points -> THREE.Shape in the extrusion plane (x, HALF - s), so that
// rotating -90deg about X maps s to world z = s - HALF and extrusion to +y.
export const toShapePts = (pts) => pts.map((p) => new THREE.Vector2(p.x, HALF - p.y))

export function extrudeUp(shapeOrPts, depth, y0, bevel = 0, holes = []) {
  const shape = shapeOrPts instanceof THREE.Shape ? shapeOrPts : new THREE.Shape(toShapePts(shapeOrPts))
  holes.forEach((h) => shape.holes.push(new THREE.Path(toShapePts(h))))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  })
  g.rotateX(-Math.PI / 2)
  g.translate(0, y0, 0)
  return g
}

export function flatUp(pts, y) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(toShapePts(pts)))
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

// Width of the case (s on the bentside) at a given x.
export function bentsideAt(pts, x) {
  let best = 0
  for (const p of pts) if (Math.abs(p.x - x) < 0.02 && p.y > best) best = p.y
  return best
}

// Ellipse path in (x, s).
export const ellipse = (cx, cs, rx, rs, n = 28) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return new THREE.Vector2(cx + Math.cos(a) * rx, cs + Math.sin(a) * rs)
  })

// Rounded rectangle shape in its own (u, v) plane.
export function roundedRect(w, h, r) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

// Lathe from a (radius, height) profile.
export const lathe = (profile, segments = 24) =>
  new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  )

// Merge simple non-indexed/indexed geometries that share the same attributes (position, normal, uv).
export function merge(geos) {
  const out = []
  for (const g of geos) out.push(g.index ? g.toNonIndexed() : g)
  const names = ['position', 'normal', 'uv'].filter((n) => out.every((g) => g.attributes[n]))
  const merged = new THREE.BufferGeometry()
  for (const n of names) {
    const size = out[0].attributes[n].itemSize
    const total = out.reduce((a, g) => a + g.attributes[n].array.length, 0)
    const arr = new Float32Array(total)
    let o = 0
    for (const g of out) {
      arr.set(g.attributes[n].array, o)
      o += g.attributes[n].array.length
    }
    merged.setAttribute(n, new THREE.BufferAttribute(arr, size))
  }
  return merged
}
