import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fogGLSL } from './glsl'
import { plateauTopAt } from './Plateau'
import { headlandTopAt } from './Rocks'
import { buildTower, buildingMaterial } from './ruins/buildings'
import { HEADLAND_BUILDINGS, PLATEAU_BUILDINGS, SLABS, TOWERS } from './ruins/layout'
import { seeded } from './ruins/noise3'
import { cullHidden } from './visibility'
import { color, shared } from './world'

export { TOWERS }

// One material per masonry style, shared by every building of that style.
const materials = {
  concrete: buildingMaterial('concrete'),
  brick: buildingMaterial('brick'),
  stone: buildingMaterial('stone'),
}

// Project tower windows: dim until hovered, bright when selected.
const windowVertex = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const windowFragment = /* glsl */ `
uniform vec3 uColor;
varying vec3 vWorld;
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  gl_FragColor = vec4(applyFog(uColor, dist, toP / dist), 1.0);
}
`
const DIM = color('#1c2350')
const LIT = new THREE.Color(3.2, 2.2, 2.4)
const HOVER = new THREE.Color(1.5, 1.1, 1.3)

function windowGeometry(windows) {
  const geos = windows.map((w) => new THREE.PlaneGeometry(w.w, w.h).translate(w.x, w.y, w.z))
  if (!geos.length) return null
  const pos = []
  const index = []
  let offset = 0
  for (const g of geos) {
    pos.push(...g.attributes.position.array)
    for (const i of g.index.array) index.push(i + offset)
    offset += g.attributes.position.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setIndex(index)
  return out
}

function Building({ spec, index, baseY = 0, state, onHover, onSelect }) {
  const built = useMemo(() => {
    const b = buildTower(spec, seeded(1000 + index * 37))
    // Drop faces no camera can see (back walls, undersides, anything under the sea).
    const [tz = 0, tx = 0] = spec.tilt || []
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(spec.x, baseY - (spec.sunk || 0), spec.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tx, 0, tz)),
      new THREE.Vector3(1, 1, 1),
    )
    const geometry = cullHidden(b.geometry, m)
    b.geometry.dispose()
    return { ...b, geometry }
  }, [spec, index, baseY])
  const interactive = spec.project !== undefined
  const windowMat = useMemo(
    () =>
      interactive
        ? new THREE.ShaderMaterial({ vertexShader: windowVertex, fragmentShader: windowFragment, uniforms: { ...shared, uColor: { value: DIM.clone() } } })
        : null,
    [interactive],
  )
  const windowGeo = useMemo(() => (interactive ? windowGeometry(built.windows) : null), [interactive, built])

  const level = useRef(0)
  useFrame((_, dt) => {
    if (!windowMat) return
    const target = state === 'selected' ? 1 : state === 'hover' ? 0.6 : 0
    level.current += (target - level.current) * Math.min(1, dt * 5)
    const l = level.current
    windowMat.uniforms.uColor.value.copy(DIM).lerp(l > 0.6 ? LIT : HOVER, Math.min(1, l / (l > 0.6 ? 1 : 0.6)))
  })

  const handlers = interactive
    ? {
        onPointerOver: (e) => {
          e.stopPropagation()
          onHover(spec.project)
        },
        onPointerOut: () => onHover(null),
        onClick: (e) => {
          e.stopPropagation()
          onSelect(spec.project)
        },
      }
    : {}

  const [tz = 0, tx = 0] = spec.tilt || []
  return (
    <group position={[spec.x, baseY - (spec.sunk || 0), spec.z]} rotation={[tx, 0, tz]}>
      <mesh geometry={built.geometry} material={materials[spec.style] || materials.concrete} {...handlers} />
      {windowGeo && <mesh geometry={windowGeo} material={windowMat} />}
    </group>
  )
}

export default function Ruins({ hovered, selected, onHover, onSelect }) {
  // Headland buildings stand on the rock; sink them slightly so they read as rooted.
  const headland = useMemo(
    () => HEADLAND_BUILDINGS.map((b) => ({ spec: b, baseY: (headlandTopAt(b.x, b.z) ?? 8) - 0.8 })),
    [],
  )
  // Towers that fall on the plateau stand on its surface; plus the ruins along its terraces.
  const towerBase = useMemo(() => TOWERS.map((t) => { const top = plateauTopAt(t.x, t.z); return top === null ? 0 : top - 0.5 }), [])
  const plateau = useMemo(() => PLATEAU_BUILDINGS.map((b) => ({ spec: b, baseY: (plateauTopAt(b.x, b.z) ?? 0) - 0.5 })), [])
  const slabs = useMemo(() => SLABS.filter(([x, z]) => plateauTopAt(x, z) === null), [])

  return (
    <group>
      {TOWERS.map((t, i) => (
        <Building
          key={i}
          index={i}
          spec={t}
          baseY={towerBase[i]}
          state={t.project === undefined ? 'idle' : selected === t.project ? 'selected' : hovered === t.project ? 'hover' : 'idle'}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
      {headland.map((h, i) => (
        <Building key={`h${i}`} index={100 + i} spec={h.spec} baseY={h.baseY} state="idle" onHover={onHover} onSelect={onSelect} />
      ))}
      {plateau.map((p, i) => (
        <Building key={`p${i}`} index={200 + i} spec={p.spec} baseY={p.baseY} state="idle" onHover={onHover} onSelect={onSelect} />
      ))}
      {slabs.map(([x, z, w, h, d, ry, rz], i) => (
        <mesh key={`s${i}`} material={materials.concrete} position={[x, h * 0.2, z]} rotation={[0, ry, rz]}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      ))}
    </group>
  )
}
