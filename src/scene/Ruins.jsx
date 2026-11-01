import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { color, palette } from './world'

// Towers out on the water. `project` links a tower to an entry in content.projects.
export const TOWERS = [
  { x: -12.6, z: -191, w: 6, d: 6, h: 35, broken: true },
  { x: 79, z: -221, w: 9, d: 8, h: 21, project: 0 },
  { x: 88.5, z: -226, w: 6, d: 6, h: 15, project: 1 },
  { x: 97.5, z: -219, w: 8, d: 7, h: 24, project: 2 },
  { x: 107, z: -224, w: 6, d: 6, h: 17, project: 3 },
  { x: 132, z: -211, w: 5, d: 5, h: 12 },
  { x: 148, z: -213, w: 8, d: 7, h: 17 },
]

const ruinMat = new THREE.MeshStandardMaterial({ color: color(palette.ruin), roughness: 1, metalness: 0 })
const DIM = color('#26306e')
const LIT = new THREE.Color(3.2, 2.2, 2.4)
const HOVER = new THREE.Color(1.5, 1.1, 1.3)

function rand(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function Tower({ tower, index, state, onHover, onSelect }) {
  const windowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: DIM.clone(), toneMapped: false }), [])
  const windows = useMemo(() => {
    const r = rand(index * 97 + 13)
    const list = []
    const cols = Math.max(2, Math.floor(tower.w / 2.2))
    const rows = Math.floor((tower.h * (tower.broken ? 0.75 : 0.92)) / 2.6)
    for (let row = 1; row < rows; row++) {
      for (let c = 0; c < cols; c++) {
        if (r() < (tower.project !== undefined ? 0.2 : 0.55)) continue
        const x = -tower.w / 2 + (c + 0.5) * (tower.w / cols)
        list.push([x, row * 2.6, tower.d / 2 + 0.05])
      }
    }
    return list
  }, [tower, index])

  const windowGeo = useMemo(() => {
    const geos = windows.map(([x, y, z]) => new THREE.PlaneGeometry(1.0, 1.1).translate(x, y, z))
    if (!geos.length) return null
    const merged = mergeGeometries(geos)
    geos.forEach((g) => g.dispose())
    return merged
  }, [windows])

  const level = useRef(0)
  useFrame((_, dt) => {
    const target = state === 'selected' ? 1 : state === 'hover' ? 0.6 : 0
    level.current += (target - level.current) * Math.min(1, dt * 5)
    const l = level.current
    windowMat.color.copy(DIM).lerp(l > 0.6 ? LIT : HOVER, Math.min(1, l / (l > 0.6 ? 1 : 0.6)))
  })

  const interactive = tower.project !== undefined
  const handlers = interactive
    ? {
        onPointerOver: (e) => {
          e.stopPropagation()
          onHover(tower.project)
        },
        onPointerOut: () => onHover(null),
        onClick: (e) => {
          e.stopPropagation()
          onSelect(tower.project)
        },
      }
    : {}

  return (
    <group position={[tower.x, 0, tower.z]}>
      <mesh material={ruinMat} position={[0, tower.h / 2 - 1, 0]} {...handlers}>
        <boxGeometry args={[tower.w, tower.h + 2, tower.d]} />
      </mesh>
      {tower.broken && (
        <mesh material={ruinMat} position={[tower.w * 0.15, tower.h + 2.5, 0]} rotation={[0, 0, -0.35]}>
          <boxGeometry args={[tower.w * 0.45, 9, tower.d * 0.8]} />
        </mesh>
      )}
      {!tower.broken && (
        <mesh material={ruinMat} position={[-tower.w * 0.2, tower.h + 0.8, 0]}>
          <boxGeometry args={[tower.w * 0.5, 1.8, tower.d * 0.9]} />
        </mesh>
      )}
      {windowGeo && <mesh geometry={windowGeo} material={windowMat} />}
    </group>
  )
}

// Minimal merge for non-indexed plane geometries (avoids pulling in the examples addon).
function mergeGeometries(geos) {
  const positions = []
  const indices = []
  let offset = 0
  for (const g of geos) {
    const p = g.attributes.position.array
    positions.push(...p)
    for (const i of g.index.array) indices.push(i + offset)
    offset += p.length / 3
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setIndex(indices)
  return out
}

function Headland() {
  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 4)
    const pos = g.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const n = Math.sin(v.x * 4.1 + v.z * 2.3) * 0.12 + Math.sin(v.y * 7.3 + v.x * 3.1) * 0.06
      v.multiplyScalar(1 + n)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    g.computeVertexNormals()
    return g
  }, [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: color(palette.headland), roughness: 1 }), [])
  return (
    <group position={[225, 0, -250]}>
      <mesh geometry={geometry} material={mat} scale={[80, 30, 50]} position={[0, -6, 0]} />
      <mesh geometry={geometry} material={mat} scale={[40, 22, 30]} position={[-50, -8, 20]} />
      <mesh material={ruinMat} position={[-14, 30, 5]}>
        <boxGeometry args={[7, 16, 7]} />
      </mesh>
      <mesh material={ruinMat} position={[2, 33, -4]}>
        <boxGeometry args={[9, 22, 8]} />
      </mesh>
      <mesh material={ruinMat} position={[18, 28, 0]}>
        <boxGeometry args={[5, 12, 5]} />
      </mesh>
    </group>
  )
}

export default function Ruins({ hovered, selected, onHover, onSelect }) {
  return (
    <group>
      {TOWERS.map((t, i) => (
        <Tower
          key={i}
          index={i}
          tower={t}
          state={t.project === undefined ? 'idle' : selected === t.project ? 'selected' : hovered === t.project ? 'hover' : 'idle'}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
      <Headland />
    </group>
  )
}
