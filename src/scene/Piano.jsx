import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PIANO_POS, palette, shared } from './world'

const HALF = 0.725 // half the case width (m)
const RIM_BOTTOM = 0.66
const RIM_HEIGHT = 0.3
const RIM_TOP = RIM_BOTTOM + RIM_HEIGHT
const LID_ANGLE = 0.5

// Grand piano outline seen from above, in (x along the length, s across the width).
// s = 0 is the straight spine (bass side), s = 1.45 the curved bentside.
function caseShape(scale = 1) {
  const cx = 1.15
  const P = (x, s) => [cx + (x - cx) * scale, (HALF - s) * scale]
  const shape = new THREE.Shape()
  shape.moveTo(...P(0, 0))
  shape.lineTo(...P(0, 1.45))
  shape.lineTo(...P(0.6, 1.45))
  shape.bezierCurveTo(...P(1.0, 1.45), ...P(1.1, 0.95), ...P(1.5, 0.82))
  shape.bezierCurveTo(...P(1.95, 0.68), ...P(2.3, 0.62), ...P(2.3, 0.3))
  shape.quadraticCurveTo(...P(2.3, 0.0), ...P(2.0, 0))
  shape.lineTo(...P(0, 0))
  return shape
}

function extruded(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 32,
  })
  g.rotateX(-Math.PI / 2) // shape y -> world -z, extrusion -> world +y
  return g
}

export default function Piano() {
  const mats = useMemo(
    () => ({
      lacquer: new THREE.MeshPhysicalMaterial({ color: '#ece8f5', roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06 }),
      dark: new THREE.MeshStandardMaterial({ color: '#1a1638', roughness: 0.35 }),
      white: new THREE.MeshStandardMaterial({ color: '#f3f1f8', roughness: 0.45 }),
      black: new THREE.MeshStandardMaterial({ color: '#0d0b18', roughness: 0.3 }),
      gold: new THREE.MeshStandardMaterial({ color: '#b89566', roughness: 0.35, metalness: 0.85 }),
      cushion: new THREE.MeshStandardMaterial({ color: '#3a3270', roughness: 0.9 }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.pianoGlow), toneMapped: false }),
    }),
    [],
  )

  const geo = useMemo(() => {
    const body = extruded(caseShape(), RIM_HEIGHT, 0.015)
    body.translate(0, RIM_BOTTOM, 0)
    const plate = new THREE.ShapeGeometry(caseShape(0.92), 32)
    plate.rotateX(-Math.PI / 2)
    plate.translate(0, RIM_TOP + 0.017, 0)
    const lid = extruded(caseShape(), 0.025, 0.006)
    lid.translate(0, 0, HALF) // hinge (spine) at the group origin
    const outline = caseShape()
      .getSpacedPoints(160)
      .map((p) => new THREE.Vector3(p.x, RIM_BOTTOM - 0.005, -p.y))
    const trim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 240, 0.009, 6, true)
    return { body, plate, lid, trim }
  }, [])

  const blackKeys = useMemo(() => {
    const keyW = 1.22 / 52
    const list = []
    for (let i = 0; i < 51; i++) {
      const letter = 'ABCDEFG'[i % 7]
      if ('ACDFG'.includes(letter)) list.push(-0.61 + (i + 1) * keyW)
    }
    return list
  }, [])

  useFrame(() => {
    const p = shared.uGlowPulse.value
    mats.glow.color.setRGB(0.35 * p * 2.2, 0.55 * p * 2.2, 1.6 * p * 2.2)
  })

  // Prop stick reaches the lid 0.9 m from the hinge.
  const propR = 0.9
  const propH = propR * Math.sin(LID_ANGLE)
  const propZ = -HALF + propR * Math.cos(LID_ANGLE)

  return (
    <group position={PIANO_POS}>
      {/* Case, soundboard plate, raised lid, prop */}
      <mesh geometry={geo.body} material={mats.lacquer} />
      <mesh geometry={geo.plate} material={mats.gold} />
      <group position={[0, RIM_TOP + 0.015, -HALF]} rotation-x={-LID_ANGLE}>
        <mesh geometry={geo.lid} material={mats.lacquer} />
      </group>
      <mesh material={mats.dark} position={[1.15, RIM_TOP + propH / 2, propZ]}>
        <cylinderGeometry args={[0.012, 0.012, propH, 8]} />
      </mesh>
      <mesh geometry={geo.trim} material={mats.glow} />

      {/* Keyboard */}
      <mesh material={mats.lacquer} position={[-0.15, 0.73, 0]}>
        <boxGeometry args={[0.32, 0.06, 1.42]} />
      </mesh>
      <mesh material={mats.white} position={[-0.155, 0.772, 0]}>
        <boxGeometry args={[0.26, 0.024, 1.22]} />
      </mesh>
      {blackKeys.map((z, i) => (
        <mesh key={i} material={mats.black} position={[-0.1, 0.795, z]}>
          <boxGeometry args={[0.15, 0.026, 0.011]} />
        </mesh>
      ))}
      {[-0.67, 0.67].map((z) => (
        <mesh key={z} material={mats.lacquer} position={[-0.15, 0.8, z]}>
          <boxGeometry args={[0.3, 0.1, 0.07]} />
        </mesh>
      ))}
      <mesh material={mats.lacquer} position={[0.02, 0.83, 0]}>
        <boxGeometry args={[0.06, 0.14, 1.3]} />
      </mesh>

      {/* Music stand */}
      <mesh material={mats.dark} position={[0.2, 1.1, 0]} rotation-z={-0.25}>
        <boxGeometry args={[0.02, 0.28, 0.82]} />
      </mesh>

      {/* Legs and pedal lyre */}
      {[
        [0.2, -0.55],
        [0.2, 0.55],
        [2.0, 0.2],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} material={mats.dark} position={[x, RIM_BOTTOM / 2, z]}>
          <cylinderGeometry args={[0.065, 0.048, RIM_BOTTOM, 12]} />
        </mesh>
      ))}
      <mesh material={mats.dark} position={[0.25, 0.32, 0]}>
        <boxGeometry args={[0.05, 0.56, 0.18]} />
      </mesh>
      {[-0.06, 0, 0.06].map((z) => (
        <mesh key={z} material={mats.gold} position={[0.18, 0.06, z]}>
          <boxGeometry args={[0.12, 0.015, 0.035]} />
        </mesh>
      ))}

      {/* The empty bench */}
      <group position={[-0.78, 0, 0]}>
        <mesh material={mats.dark} position={[0, 0.5, 0]}>
          <boxGeometry args={[0.38, 0.07, 0.85]} />
        </mesh>
        <mesh material={mats.cushion} position={[0, 0.555, 0]}>
          <boxGeometry args={[0.36, 0.045, 0.83]} />
        </mesh>
        {[
          [-0.15, -0.38],
          [-0.15, 0.38],
          [0.15, -0.38],
          [0.15, 0.38],
        ].map(([x, z]) => (
          <mesh key={`${x}${z}`} material={mats.dark} position={[x, 0.235, z]}>
            <boxGeometry args={[0.045, 0.47, 0.045]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
