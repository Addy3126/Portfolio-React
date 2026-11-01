import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from './glsl'
import { inside, offset } from './piano/geometry'
import { fbm3, seeded } from './ruins/noise3'
import { rockGeometry, rockMaterial } from './ruins/rocks'
import { color, shared } from './world'

// The rock plateau on the left: stacked, angular rock "planes" stepping back in terraces,
// with ruins on top. Its footprint runs far off to the left and behind the camera, so no
// camera stop or flight ever reaches an edge.

// Front edge (facing the field and the sea), from behind the camera out to the far left.
const FRONT = [
  [-30, 100], [-27, 60], [-28, 35], [-27, 15], [-30, 0], [-29, -14], [-33, -30], [-31, -48],
  [-38, -70], [-36, -95], [-44, -120], [-41, -142], [-50, -168], [-55, -200], [-63, -235],
  [-78, -268], [-110, -300], [-170, -322], [-260, -345], [-420, -365], [-700, -380],
]
const BACK = [[-1000, -380], [-1000, 100]]

// Layers: [inset from the front edge (m), bottom y, top y]
const LAYERS = [
  [0, -1.2, 3.5],
  [3, 3.5, 7.5],
  [6.5, 7.5, 11],
  [11, 11, 15.5],
  [17, 15.5, 20],
  [25, 20, 25],
  [36, 25, 31],
]

// Resample the front edge every ~6 m and jitter it sideways into angular, broken facets.
function frontOutline(seed, amount) {
  const pts = []
  for (let i = 0; i < FRONT.length - 1; i++) {
    const [ax, az] = FRONT[i]
    const [bx, bz] = FRONT[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.round(len / (Math.abs(ax) > 300 ? 40 : 6)))
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

// Extrude a world-space (x, z) polygon between two heights.
function extrudeXZ(pts, y0, y1) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, y0, 0)
  return g
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
    const list = LAYERS.map(([, y0, y1], i) => new THREE.Mesh(extrudeXZ(layerOutlines[i], y0, y1), mat))

    // Sand apron in front of the lowest layer.
    const sand = new THREE.Mesh(
      extrudeXZ(offset(layerOutlines[0], -6), -0.7, 0.08),
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
    for (const [x, z, sx, sy, sz] of [
      [-78, -120, 26, 34, 22],
      [-70, -60, 20, 26, 18],
      [-120, -150, 40, 46, 32],
      [-190, -230, 55, 60, 40],
      [-110, -30, 34, 36, 28],
      [-160, -70, 45, 50, 36],
      [-280, -280, 70, 70, 50],
    ]) {
      const m = new THREE.Mesh(massGeo, mat)
      m.position.set(x, (plateauTopAt(x, z) ?? 20) - sy * 0.3, z)
      m.scale.set(sx, sy, sz)
      m.rotation.y = rand() * 6.28
      list.push(m)
    }

    // Broken slabs and boulders scattered on the terraces near the edge.
    const slabGeo = rockGeometry(31, { detail: 2, flatTop: 0.15, terrace: 0, rough: 1.2, cliff: 0.3 })
    const items = []
    for (let i = 0; i < 70; i++) {
      const z = -10 - rand() * 280
      const x = -30 - rand() * 60 - Math.max(0, -z - 150) * 0.6
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
