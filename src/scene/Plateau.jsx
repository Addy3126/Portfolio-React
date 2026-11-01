import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from './glsl'
import { inside, offset } from './piano/geometry'
import { fbm3, seeded } from './ruins/noise3'
import { rockGeometry, rockMaterial } from './ruins/rocks'
import { color, shared } from './world'

// The rock plateau on the left: stacked, angular rock "planes" stepping back in terraces,
// with ruins on top. Its front edge is an arc at a constant distance from the cameras
// (about as far as the ruins by the sun), running from just left of the sun out past the
// left edge of the screen and around behind, so it never comes close and never ends in view.

const CAM = [0, 9] // landing camera (x, z)
const RADIUS = 275
// Point at bearing `deg` (negative = left of straight ahead) and distance r from the camera.
export const polar = (r, deg) => {
  const t = (deg * Math.PI) / 180
  return [CAM[0] + r * Math.sin(t), CAM[1] - r * Math.cos(t)]
}

// Front edge, from behind-left round to just left of the sun.
const FRONT = []
for (let deg = -120; deg <= -9; deg += 3) {
  const wobble = 10 * Math.sin(deg * 0.21) + 6 * Math.sin(deg * 0.57 + 1)
  FRONT.push(polar(RADIUS + wobble, deg))
}
const BACK = [polar(900, -6), [-1100, -900], [-1100, 600], polar(400, -125)]

// Layers: [inset from the front edge (m), bottom y, top y]
const LAYERS = [
  [0, -1.2, 1.8],
  [1.5, 1.8, 3.8],
  [3.2, 3.8, 5.5],
  [5.5, 5.5, 7.8],
  [8.5, 7.8, 10],
  [12.5, 10, 12.5],
  [18, 12.5, 15.5],
]

// Resample the front edge every ~6 m and jitter it sideways into angular, broken facets.
function frontOutline(seed, amount) {
  const pts = []
  for (let i = 0; i < FRONT.length - 1; i++) {
    const [ax, az] = FRONT[i]
    const [bx, bz] = FRONT[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const bearing = (Math.atan2(ax - CAM[0], CAM[1] - az) * 180) / Math.PI
    const steps = Math.max(1, Math.round(len / (Math.hypot(ax, az) > 500 ? 40 : bearing < -80 ? 10 : 2.5)))
    const nx = -(bz - az) / len
    const nz = (bx - ax) / len
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const j = (fbm3(x * 0.08 + seed, z * 0.08, seed) - 0.5) * 2 * amount
      pts.push(new THREE.Vector2(x + nx * j, z + nz * j))
    }
  }
  pts.push(new THREE.Vector2(...FRONT[FRONT.length - 1]))
  for (const [x, z] of BACK) pts.push(new THREE.Vector2(x, z))
  return pts
}

// Extrude a world-space (x, z) polygon between two heights. With `chip`, the walls get
// height subdivisions and every vertex is pushed by position-based noise, so walls bulge
// and edges chip; shared positions move identically, so no cracks open. Flat normals give
// the fractured-stone facets.
function extrudeXZ(pts, y0, y1, chip = 0) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)))
  const steps = chip ? Math.max(1, Math.ceil((y1 - y0) / 1.1)) : 1
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, steps, bevelEnabled: false, curveSegments: 1 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, y0, 0)
  if (chip) {
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      if (x < -400) continue // far off-screen: leave plain
      const big = fbm3(x * 0.18, y * 0.35, z * 0.18, 3) - 0.5
      const small = fbm3(x * 0.9 + 5, y * 1.1, z * 0.9 - 3, 2) - 0.5
      const dx = big * 2.2 * chip + small * 0.7 * chip
      const dz = (fbm3(x * 0.18 + 31, y * 0.35, z * 0.18 + 17, 3) - 0.5) * 2.2 * chip + (fbm3(x * 0.9 - 9, y * 1.1 + 4, z * 0.9, 2) - 0.5) * 0.7 * chip
      // Chip the top edge down a little in places.
      const dy = y === y1 ? -Math.max(0, small) * 1.2 * chip : (small * 0.4 * chip)
      pos.setXYZ(i, x + dx, y + dy, z + dz)
    }
    const flat = g.toNonIndexed()
    flat.computeVertexNormals()
    g.dispose()
    return flat
  }
  return g
}

// Unit outward (toward the water) direction at each outline point near the visible stretch.
function outwardSamples(outline, every, filter) {
  const out = []
  for (let i = 1; i < outline.length - 1; i += every) {
    const p = outline[i]
    if (!filter(p)) continue
    const a = outline[i - 1]
    const b = outline[i + 1]
    let n = new THREE.Vector2(-(b.y - a.y), b.x - a.x).normalize()
    const probe = p.clone().addScaledVector(n, 1.5)
    if (inside(outline, probe.x, probe.y)) n.negate()
    out.push({ p, n })
  }
  return out
}

// Layer outlines, computed once (shared with Ruins and Rocks for placement).
const layerOutlines = LAYERS.map(([inset], i) => {
  const base = frontOutline(11 + i * 7.3, 2.8 + i * 0.4)
  return inset > 0 ? offset(base, inset * (0.85 + 0.3 * ((i * 0.37) % 1))) : base
})

// Height of the plateau surface at (x, z), or null if (x, z) is not on it.
export function plateauTopAt(x, z) {
  for (let i = LAYERS.length - 1; i >= 0; i--) if (inside(layerOutlines[i], x, z)) return LAYERS[i][2]
  return null
}

// Sand along the foot of the cliffs, wet toward the water.
const sandVertex = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const sandFragment = /* glsl */ `
uniform vec3 cSandP, cWetP, cSkyP;
varying vec3 vWorld;
${noiseGLSL}
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  float n = vnoise(vWorld.xz * 0.6) * 0.6 + vnoise(vWorld.xz * 3.0) * 0.4;
  vec3 col = mix(cWetP, cSandP, smoothstep(0.35, 0.65, n)) * (0.85 + 0.3 * vnoise(vWorld.xz * 9.0));
  vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
  col += uFogGlow * pow(max(dot(R, uSunDir), 0.0), 30.0) * 0.3 * (1.0 - smoothstep(0.4, 0.6, n));
  gl_FragColor = vec4(applyFog(col * (0.6 + 0.4 * cSkyP), dist, V), 1.0);
}
`

export default function Plateau() {
  const { meshes } = useMemo(() => {
    const mat = rockMaterial()
    const list = []
    LAYERS.forEach(([, y0, y1], i) => {
      list.push(new THREE.Mesh(extrudeXZ(layerOutlines[i], y0, y1, 0.6), mat))
      // Overhang: a thinner ledge at the top of the layer that juts out past the wall.
      if (i < LAYERS.length - 1) {
        const lipH = Math.min(0.8, (y1 - y0) * 0.3)
        list.push(new THREE.Mesh(extrudeXZ(offset(layerOutlines[i], -(0.7 + 0.15 * i)), y1 - lipH, y1 + 0.1, 0.8), mat))
      }
    })

    // Sand apron in front of the lowest layer.
    const sand = new THREE.Mesh(
      extrudeXZ(offset(layerOutlines[0], -3), -0.7, 0.08),
      new THREE.ShaderMaterial({
        vertexShader: sandVertex,
        fragmentShader: sandFragment,
        uniforms: { ...shared, cSandP: { value: color('#8d84bc') }, cWetP: { value: color('#3a3c80') }, cSkyP: { value: color('#9a92dc') } },
      }),
    )
    list.push(sand)

    // Taller weathered masses further back give the plateau its big silhouette.
    const rand = seeded(777)
    const massGeo = rockGeometry(21, { detail: 5, flatTop: 0.7, terrace: 0.3, rough: 0.9, cliff: 0.45, faceted: false, fine: 0.12 })
    for (const [r, deg, sx, sy, sz] of [
      [300, -14, 13, 17, 11],
      [312, -30, 20, 23, 16],
      [330, -45, 28, 30, 20],
      [318, -58, 17, 20, 14],
      [345, -22, 22, 26, 18],
      [360, -70, 35, 35, 25],
    ]) {
      const [x, z] = polar(r, deg)
      const m = new THREE.Mesh(massGeo, mat)
      m.position.set(x, (plateauTopAt(x, z) ?? 10) - sy * 0.3, z)
      m.scale.set(sx, sy, sz)
      m.rotation.y = rand() * 6.28
      list.push(m)
    }

    // Broken slabs and boulders scattered on the terraces near the edge.
    const slabGeo = rockGeometry(31, { detail: 2, flatTop: 0.15, terrace: 0, rough: 1.2, cliff: 0.3 })
    const items = []
    for (let i = 0; i < 70; i++) {
      const [x, z] = polar(RADIUS + 3 + rand() * 30, -10 - rand() * 60)
      const top = plateauTopAt(x, z)
      if (top === null) continue
      const s = 0.8 + rand() * 3
      items.push([x, top, z, s * (1.2 + rand()), s * (0.25 + rand() * 0.35), s, rand() * 6.28])
    }
    const slabs = new THREE.InstancedMesh(slabGeo, mat, items.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    items.forEach(([x, y, z, sx, sy, sz, ry], i) => {
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.3, ry, (rand() - 0.5) * 0.3))
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
      slabs.setMatrixAt(i, m4)
    })
    slabs.computeBoundingSphere()
    list.push(slabs)

    // Fallen blocks and rubble: at the foot of the cliffs (on the sand) and on each terrace
    // just in front of the next wall up. Only along the stretch the cameras can see.
    const visible = (p) => {
      const deg = (Math.atan2(p.x - CAM[0], CAM[1] - p.y) * 180) / Math.PI
      return deg > -75 && deg < -5 && Math.hypot(p.x - CAM[0], p.y - CAM[1]) < 340
    }
    const blocks = []
    const debris = []
    const scatter = (outline, baseY, gap, scale) => {
      for (const { p, n } of outwardSamples(outline, 2, visible)) {
        if (rand() < 0.45) {
          const d = 0.5 + rand() * gap
          const sz = scale * (0.8 + rand() * 1.6)
          blocks.push([p.x + n.x * d, baseY + sz * 0.15, p.y + n.y * d, sz * (1 + rand() * 0.6), sz * (0.5 + rand() * 0.6), sz, rand() * 6.28, (rand() - 0.5) * 0.6])
        }
        const k = 2 + Math.floor(rand() * 5)
        for (let j = 0; j < k; j++) {
          const d = rand() * gap * 1.6
          const side = (rand() - 0.5) * 4
          const sz = scale * (0.12 + rand() * rand() * 0.45)
          debris.push([p.x + n.x * d - n.y * side, baseY + sz * 0.2, p.y + n.y * d + n.x * side, sz * 1.3, sz * (0.6 + rand() * 0.5), sz, rand() * 6.28, (rand() - 0.5) * 1.2])
        }
      }
    }
    scatter(layerOutlines[0], -0.2, 3, 1.0)
    for (let i = 1; i < LAYERS.length; i++) scatter(layerOutlines[i], LAYERS[i - 1][2], 1.4, 0.6)

    const blockGeo = rockGeometry(41, { detail: 1, flatTop: 0.3, terrace: 0, rough: 1.1, cliff: 0.6 })
    const debrisGeo = rockGeometry(43, { detail: 1, flatTop: 0.25, terrace: 0, rough: 1.4, cliff: 0.3 })
    for (const [geo, items] of [[blockGeo, blocks], [debrisGeo, debris]]) {
      const im = new THREE.InstancedMesh(geo, mat, items.length)
      items.forEach(([x, y, z, sx, sy, sz, ry, tilt], i) => {
        q.setFromEuler(new THREE.Euler(tilt, ry, tilt * 0.6))
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
        im.setMatrixAt(i, m4)
      })
      im.computeBoundingSphere()
      list.push(im)
    }
    return { meshes: list }
  }, [])

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}
