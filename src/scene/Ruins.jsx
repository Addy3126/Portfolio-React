import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fogGLSL } from './glsl'
import { color, palette, shared } from './world'

// Towers out on the water. `project` links a tower to an entry in content.projects.
// tilt: lean in radians (z, x); broken: jagged top; sunk: metres below the waterline.
export const TOWERS = [
  // Project towers, spread across the horizon right of the sun.
  { x: 68, z: -218, w: 8, d: 7, h: 22, project: 0 },
  { x: 98, z: -244, w: 7, d: 7, h: 18, project: 1 },
  { x: 128, z: -212, w: 9, d: 8, h: 26, project: 2 },
  { x: 162, z: -238, w: 6, d: 6, h: 17, project: 3 },

  // Left of the sun: the broken spire and a loose, uneven skyline.
  { x: -12.6, z: -191, w: 6, d: 6, h: 35, broken: true },
  { x: -30, z: -150, w: 5, d: 5, h: 11, broken: true, tilt: [0.05, 0] },
  { x: -48, z: -232, w: 8, d: 7, h: 22, tilt: [0.07, 0.02] },
  { x: -74, z: -265, w: 6, d: 6, h: 31, broken: true },
  { x: -98, z: -214, w: 11, d: 8, h: 13, broken: true, sunk: 3 },
  { x: -132, z: -252, w: 7, d: 7, h: 25, tilt: [-0.09, 0] },
  { x: -168, z: -205, w: 13, d: 10, h: 9, broken: true },
  { x: -24, z: -430, w: 12, d: 10, h: 46, broken: true }, // far, mostly lost in haze

  // Right side, between the project towers and the headland.
  { x: -60, z: -168, w: 4, d: 4, h: 8, broken: true, tilt: [0.12, 0.05] },
  { x: 196, z: -206, w: 6, d: 6, h: 14, broken: true },
  { x: 145, z: -320, w: 9, d: 9, h: 30, broken: true },
]

// Fallen slabs lying in the water: [x, z, width, height, depth, rotY, rotZ]
const SLABS = [
  [-36, -205, 14, 2.4, 5, 0.4, 0.12],
  [84, -205, 10, 1.8, 4, -0.3, -0.08],
  [-118, -236, 16, 3, 6, 0.9, 0.05],
]

// Silhouettes with soft sky light, a faint sun rim, distance fog and low mist over the water.
const ruinVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const ruinFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 cSkyR;
varying vec3 vWorld;
varying vec3 vNormalW;
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormalW);
  vec3 col = uColor * (0.55 + 0.45 * (N.y * 0.5 + 0.5)) + cSkyR * max(N.y, 0.0) * 0.08;
  float rim = pow(max(1.0 - abs(dot(N, -V)), 0.0), 3.0) * pow(max(dot(V, uSunDir), 0.0), 4.0);
  col += uFogGlow * rim * 0.35;
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`
const ruinMaterial = (hex) =>
  new THREE.ShaderMaterial({
    vertexShader: ruinVertex,
    fragmentShader: ruinFragment,
    uniforms: { ...shared, uColor: { value: color(hex) }, cSkyR: { value: color('#8a80d0') } },
  })
const ruinMat = ruinMaterial(palette.ruin)

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
  vec3 V = toP / dist;
  gl_FragColor = vec4(applyFog(uColor, dist, V), 1.0);
}
`
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
  const windowMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: windowVertex, fragmentShader: windowFragment, uniforms: { ...shared, uColor: { value: DIM.clone() } } }),
    [],
  )
  const windows = useMemo(() => {
    const r = rand(index * 97 + 13)
    const list = []
    const cols = Math.max(2, Math.floor(tower.w / 2.2))
    const rows = Math.floor((tower.h * (tower.broken ? 0.75 : 0.92)) / 2.6)
    for (let row = 1; row < rows; row++) {
      for (let c = 0; c < cols; c++) {
        if (r() < (tower.project !== undefined ? 0.2 : 0.7)) continue
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
    windowMat.uniforms.uColor.value.copy(DIM).lerp(l > 0.6 ? LIT : HOVER, Math.min(1, l / (l > 0.6 ? 1 : 0.6)))
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

  const [tz = 0, tx = 0] = tower.tilt || []
  const y0 = -(tower.sunk || 0)
  return (
    <group position={[tower.x, y0, tower.z]} rotation={[tx, 0, tz]}>
      <mesh material={ruinMat} position={[0, tower.h / 2 - 1, 0]} {...handlers}>
        <boxGeometry args={[tower.w, tower.h + 2, tower.d]} />
      </mesh>
      {tower.broken ? (
        <>
          <mesh material={ruinMat} position={[tower.w * 0.18, tower.h + 2.2, 0]} rotation={[0, 0, -0.35]}>
            <boxGeometry args={[tower.w * 0.42, Math.min(9, tower.h * 0.3), tower.d * 0.8]} />
          </mesh>
          <mesh material={ruinMat} position={[-tower.w * 0.3, tower.h + 0.9, tower.d * 0.1]} rotation={[0.1, 0, 0.2]}>
            <boxGeometry args={[tower.w * 0.35, Math.min(4, tower.h * 0.15), tower.d * 0.6]} />
          </mesh>
        </>
      ) : (
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
  const mat = useMemo(() => ruinMaterial(palette.headland), [])
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
      {SLABS.map(([x, z, w, h, d, ry, rz], i) => (
        <mesh key={i} material={ruinMat} position={[x, h * 0.2, z]} rotation={[0, ry, rz]}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      ))}
      <Headland />
    </group>
  )
}
