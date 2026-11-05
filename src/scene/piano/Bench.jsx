import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeStatic } from '../mergeStatic'
import { lathe, roundedRect } from './geometry'
import { noiseBump } from './textures'

const BENCH_X = -0.78 // bench centre, in front of the keyboard

function artistBench(m) {
  // Concert artist bench: tufted leather top, turned legs, height-adjust knobs.
  const parts = []
  const add = (g, mat, p, r) => {
    const mesh = new THREE.Mesh(g, mat)
    mesh.position.set(...p)
    if (r) mesh.rotation.set(...r)
    parts.push(mesh)
    return mesh
  }
  add(new THREE.BoxGeometry(0.34, 0.07, 0.58), m.lacquer, [0, 0.445, 0])
  const cushion = new THREE.ExtrudeGeometry(roundedRect(0.36, 0.6, 0.05), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.02, bevelSegments: 5, curveSegments: 10 })
  cushion.rotateX(-Math.PI / 2)
  add(cushion, m.leather, [0, 0.48, 0])
  const tufts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.009, 10, 6), m.tuft, 8)
  const mat = new THREE.Matrix4()
  let k = 0
  for (const x of [-0.08, 0.08]) for (const z of [-0.21, -0.07, 0.07, 0.21]) tufts.setMatrixAt(k++, mat.makeTranslation(x, 0.548, z))
  parts.push(tufts)
  const leg = lathe([[0, 0], [0.022, 0], [0.026, 0.03], [0.02, 0.08], [0.018, 0.2], [0.024, 0.3], [0.03, 0.38], [0.034, 0.41], [0, 0.41]], 18)
  for (const x of [-0.14, 0.14]) for (const z of [-0.25, 0.25]) add(leg, m.lacquer, [x, 0, z])
  for (const z of [-0.31, 0.31]) {
    add(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 20), m.lacquer, [0, 0.445, z], [Math.PI / 2, 0, 0])
    add(new THREE.TorusGeometry(0.034, 0.004, 6, 20), m.brass, [0, 0.445, z + Math.sign(z) * 0.015])
  }
  return parts
}

function duetBench(m) {
  // Art-deco duet bench: lacquered top with a storage-lid seam, tapered square legs.
  const parts = []
  const add = (g, mat, p, r) => {
    const mesh = new THREE.Mesh(g, mat)
    mesh.position.set(...p)
    if (r) mesh.rotation.set(...r)
    parts.push(mesh)
  }
  add(new THREE.BoxGeometry(0.38, 0.045, 0.92), m.lacquer, [0, 0.5, 0])
  add(new THREE.BoxGeometry(0.382, 0.004, 0.004), m.tuft, [0, 0.5, 0.0])
  add(new THREE.BoxGeometry(0.004, 0.004, 0.88), m.tuft, [-0.12, 0.5235, 0])
  add(new THREE.BoxGeometry(0.32, 0.07, 0.86), m.lacquer, [0, 0.44, 0])
  const leg = new THREE.CylinderGeometry(0.03, 0.021, 0.42, 4)
  leg.rotateY(Math.PI / 4)
  for (const x of [-0.13, 0.13])
    for (const z of [-0.38, 0.38]) {
      add(leg, m.lacquer, [x, 0.21, z])
      add(new THREE.CylinderGeometry(0.017, 0.015, 0.04, 4), m.brass, [x, 0.02, z], [0, Math.PI / 4, 0])
    }
  return parts
}

function curvedBench(m) {
  // Nocturne bench: a gently dipped velvet seat on a lacquer base, slender legs with glowing rings.
  const parts = []
  const add = (g, mat, p, r) => {
    const mesh = new THREE.Mesh(g, mat)
    mesh.position.set(...p)
    if (r) mesh.rotation.set(...r)
    parts.push(mesh)
  }
  const bent = (w, h, d, dip) => {
    const g = new THREE.BoxGeometry(w, h, d, 4, 2, 20)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) / (d / 2)
      pos.setY(i, pos.getY(i) + dip * z * z)
    }
    g.computeVertexNormals()
    return g
  }
  add(bent(0.36, 0.06, 0.7, 0.03), m.velvet, [0, 0.5, 0])
  add(bent(0.32, 0.03, 0.66, 0.03), m.lacquer, [0, 0.455, 0])
  const leg = lathe([[0, 0], [0.02, 0], [0.016, 0.15], [0.02, 0.3], [0.028, 0.44], [0, 0.44]], 16)
  for (const x of [-0.12, 0.12])
    for (const z of [-0.28, 0.28]) {
      add(leg, m.lacquer, [x, 0, z])
      add(new THREE.TorusGeometry(0.019, 0.004, 6, 18), m.glow, [x, 0.08, z], [Math.PI / 2, 0, 0])
    }
  return parts
}

export default function Bench({ design, lacquer, brass, glow }) {
  const parts = useMemo(() => {
    const m = {
      lacquer,
      brass,
      glow,
      leather: new THREE.MeshPhysicalMaterial({ color: '#141018', roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.4, bumpMap: noiseBump({ seed: 9, dots: 4200, minR: 0.5, maxR: 1.8, repeat: [3, 3] }), bumpScale: 0.6 }),
      tuft: new THREE.MeshStandardMaterial({ color: '#060508', roughness: 0.6 }),
      velvet: new THREE.MeshPhysicalMaterial({ color: '#2a2466', roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#7b6ae0'), sheenRoughness: 0.5, bumpMap: noiseBump({ seed: 11, dots: 6000, minR: 0.3, maxR: 0.9, repeat: [4, 4] }), bumpScale: 0.3 }),
    }
    const list = design.bench === 'artist' ? artistBench(m) : design.bench === 'duet' ? duetBench(m) : curvedBench(m)
    return [...list, ...mergeStatic(list)] // one draw per material (see mergeStatic)
  }, [design, lacquer, brass, glow])

  return (
    <group position={[BENCH_X, 0, 0]}>
      {parts.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
    </group>
  )
}
