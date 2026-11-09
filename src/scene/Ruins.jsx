import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fogGLSL } from './glsl'
import { mergeStatic } from './mergeStatic'
import { headlandTopFn } from './ScannedRocks'
import { buildTower, buildingMaterial } from './ruins/buildings'
import { HEADLAND_BUILDINGS, PLATEAU_BUILDINGS, SLABS, TOWERS } from './ruins/layout'
import { seeded } from './ruins/noise3'
import { cullHidden } from './visibility'
import { color, shared } from './world'
import { lookNew } from '../quality'
import { focus, isVisited } from '../focus'
import Facade from './Facade'
import { inProjects } from './projectsGate'

export { TOWERS }

// One material per masonry style, shared by every building of that style.
const materials = {
  concrete: buildingMaterial('concrete'),
  brick: buildingMaterial('brick'),
  stone: buildingMaterial('stone'),
}

// Project tower windows: dim until hovered, bright when selected.
const windowVertex = /* glsl */ `
attribute float aWarm;
varying vec3 vWorld;
varying float vWarm;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vWarm = aWarm;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const windowFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uShare;
varying vec3 vWorld;
varying float vWarm;
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  // New look: some windows lit warm (lived in), so the project towers stand apart; more of
  // them on towers this visitor has walked up to.
  vec3 col = max(uColor, WARM * step(vWarm, uShare));
  gl_FragColor = vec4(applyFog(col, dist, toP / dist), 1.0);
}
`
// WebGL window material; userData.color is what Building animates (the WebGPU path passes
// its own factory with the same contract).
// Warm window light (new look); a quarter of the project towers' windows, picked per window.
export const WARM = new THREE.Color(1.5, 0.92, 0.52)
function windowMaterial() {
  const m = new THREE.ShaderMaterial({
    vertexShader: windowVertex,
    fragmentShader: windowFragment.replace('WARM', `vec3(${WARM.r}, ${WARM.g}, ${WARM.b})`),
    uniforms: { ...shared, uColor: { value: DIM.clone() }, uShare: { value: 0 } },
  })
  m.userData.color = m.uniforms.uColor.value
  m.userData.share = m.uniforms.uShare
  return m
}
export const DIM = color('#1c2350')

// Fallen slab: a box tagged as wall (aKind 0) for the building shader.
function slabGeometry(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1))
  return g
}
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
  // Per window (4 vertices each): a fixed random rank; windows ranked under the tower's
  // share are lit warm (the same ones on every visit).
  const warm = new Float32Array(pos.length / 3)
  const rand = seeded(77)
  for (let i = 0; i < warm.length; i += 4) warm.fill(rand() + 1e-3, i, i + 4)
  out.setAttribute('aWarm', new THREE.Float32BufferAttribute(warm, 1))
  return out
}

// Hover and click on a project tower test its bounding box rather than its every triangle:
// a pointer move otherwise walked the whole merged building (tens of thousands of faces)
// for each tower under the cursor.
const _inv = new THREE.Matrix4()
const _ray = new THREE.Ray()
const _hit = new THREE.Vector3()
// Towers answer the pointer only in the Projects view (projectsGate.js), and not while the
// camera is at a tower (its opening and bright window take the clicks then).
export { inProjects }
function boxRaycast(raycaster, intersects) {
  if (!inProjects() || focus.project !== null) return
  const g = this.geometry
  if (!g.boundingBox) g.computeBoundingBox()
  _inv.copy(this.matrixWorld).invert()
  _ray.copy(raycaster.ray).applyMatrix4(_inv)
  if (!_ray.intersectBox(g.boundingBox, _hit)) return
  _hit.applyMatrix4(this.matrixWorld)
  const distance = raycaster.ray.origin.distanceTo(_hit)
  if (distance >= raycaster.near && distance <= raycaster.far) intersects.push({ distance, point: _hit.clone(), object: this })
}

function Building({ spec, index, baseY = 0, state, hovered, onHover, onSelect, mats, makeWindow }) {
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
  const windowMat = useMemo(() => (interactive ? makeWindow() : null), [interactive, makeWindow])
  const windowGeo = useMemo(() => (interactive ? windowGeometry(built.windows) : null), [interactive, built])

  // A project tower's front: where it stands, and the top of it (for its name label).
  const origin = useMemo(() => new THREE.Vector3(spec.x, baseY - (spec.sunk || 0), spec.z), [spec, baseY])
  const towerTop = useMemo(() => new THREE.Vector3(spec.x, baseY + built.height, spec.z), [spec, baseY, built])

  const level = useRef(0)
  useFrame((_, dt) => {
    if (!windowMat) return
    windowMat.userData.share.value = lookNew ? (isVisited(spec.project) ? 0.55 : 0.25) : 0
    // At the tower its spare windows stay dark glass beside the lit ones.
    const target = focus.project === spec.project ? 0 : state === 'selected' ? 1 : state === 'hover' ? 0.6 : 0
    level.current += (target - level.current) * Math.min(1, dt * 5)
    const l = level.current
    windowMat.userData.color.copy(DIM).lerp(l > 0.6 ? LIT : HOVER, Math.min(1, l / (l > 0.6 ? 1 : 0.6)))
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
      <mesh geometry={built.geometry} material={mats[spec.style] || mats.concrete} {...handlers} {...(interactive && { raycast: boxRaycast })} />
      {windowGeo && <mesh geometry={windowGeo} material={windowMat} />}
      {built.facade && <Facade project={spec.project} fc={built.facade} origin={origin} towerTop={towerTop} hovered={hovered} />}
    </group>
  )
}

export default function Ruins({ hovered, selected, onHover, onSelect, mats = materials, makeWindow = windowMaterial }) {
  // Headland buildings stand on the scanned cliffs once those have loaded; sunk slightly so
  // they read as rooted.
  const [headland, setHeadland] = useState([])
  useEffect(() => {
    let live = true
    headlandTopFn().then((topAt) => live && setHeadland(HEADLAND_BUILDINGS.map((b) => ({ spec: b, baseY: (topAt(b.x, b.z) ?? 8) - 0.8 }))))
    return () => (live = false)
  }, [])
  // The smaller ruins on the left stand in the shallows, sunk a little so they read as rooted.
  const plateau = useMemo(() => PLATEAU_BUILDINGS.map((b) => ({ spec: b, baseY: -1 })), [])

  // Leaving the Projects section clears a hover or selection left behind.
  useFrame(() => {
    if (inProjects()) return
    if (hovered !== null && hovered !== undefined) onHover(null)
    if (selected !== null && selected !== undefined) onSelect(null)
  })

  // The ruins that aren't projects never change: merged per material, one set for each side
  // of the bay (so a side off screen is still skipped), instead of a draw call per building
  // in the scene and again in the sea's reflection. Redone when the headland ones arrive.
  const still = useRef()
  useEffect(() => {
    const g = still.current
    const roots = [...g.children].filter((c) => !c.userData.mergedFrom)
    const merged = [...mergeStatic(roots.filter((r) => r.position.x < 0)), ...mergeStatic(roots.filter((r) => r.position.x >= 0))]
    merged.forEach((m) => g.add(m))
    return () =>
      merged.forEach((m) => {
        g.remove(m)
        m.geometry.dispose()
        m.userData.mergedFrom.forEach((o) => (o.visible = true))
      })
  }, [headland])

  const idle = (spec, i, baseY) => <Building key={i} index={i} spec={spec} baseY={baseY} state="idle" onHover={onHover} onSelect={onSelect} mats={mats} makeWindow={makeWindow} />
  return (
    <group>
      {TOWERS.map(
        (t, i) =>
          t.project !== undefined && (
            <Building
              key={i}
              index={i}
              spec={t}
              baseY={0}
              state={selected === t.project ? 'selected' : hovered === t.project ? 'hover' : 'idle'}
              hovered={hovered}
              onHover={onHover}
              onSelect={onSelect}
              mats={mats}
              makeWindow={makeWindow}
            />
          ),
      )}
      <group ref={still}>
        {TOWERS.map((t, i) => t.project === undefined && idle(t, i, 0))}
        {headland.map((h, i) => idle(h.spec, 100 + i, h.baseY))}
        {plateau.map((p, i) => idle(p.spec, 200 + i, p.baseY))}
        {SLABS.map(([x, z, w, h, d, ry, rz], i) => (
          <mesh key={`s${i}`} geometry={slabGeometry(w, h, d)} material={mats.concrete} position={[x, h * 0.2, z]} rotation={[0, ry, rz]} />
        ))}
      </group>
    </group>
  )
}
