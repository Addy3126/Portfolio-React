import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SHADOW_LAYER } from './PianoShadow'
import Bench from './piano/Bench'
import { design } from './piano/designs'
import {
  HALF,
  RIM_BOTTOM,
  RIM_H,
  RIM_TOP,
  W,
  WALL,
  bentsideAt,
  ellipse,
  extrudeUp,
  inside,
  lathe,
  offset,
  outline,
} from './piano/geometry'
import { PIANO_POS, palette, shared } from './world'

const LID_ANGLE = 0.58
const FLAP_X = 0.37 // where the front lid flap hinges
const KEY_W = 1.22 / 52
const KEY_Z0 = -0.61

const FINISHES = {
  white: { color: '#f1eef6', roughness: 0.12 },
  black: { color: '#0b0a10', roughness: 0.07 },
  pearl: { color: '#ebe8f8', roughness: 0.1, iridescence: 0.4, iridescenceIOR: 1.3 },
}

export function pianoMaterials(d) {
  const lacquer = new THREE.MeshPhysicalMaterial({ ...FINISHES[d.finish], clearcoat: 1, clearcoatRoughness: 0.03 })
  return {
    lacquer,
    brass: new THREE.MeshStandardMaterial({ color: '#caa45a', metalness: 1, roughness: 0.28 }),
    plate: new THREE.MeshStandardMaterial({ color: '#b48e48', metalness: 0.85, roughness: 0.38 }),
    soundboard: new THREE.MeshStandardMaterial({ color: '#b88d55', roughness: 0.55 }),
    underside: new THREE.MeshStandardMaterial({ color: '#17141c', roughness: 0.85 }),
    ivory: new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.32 }),
    ebony: new THREE.MeshPhysicalMaterial({ color: '#08080b', roughness: 0.22, clearcoat: 0.6 }),
    redFelt: new THREE.MeshStandardMaterial({ color: '#6e1424', roughness: 1 }),
    blackFelt: new THREE.MeshStandardMaterial({ color: '#121016', roughness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: '#d8dbe4', metalness: 1, roughness: 0.3 }),
    string: new THREE.LineBasicMaterial({ color: '#8e92a3' }),
    bassString: new THREE.LineBasicMaterial({ color: '#8a6440' }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.pianoGlow), toneMapped: false }),
  }
}

// Instanced boxes from a list of [x, y, z, sx, sy, sz, rotZ?].
function boxes(list, material) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  list.forEach(([x, y, z, sx, sy, sz, rz = 0], i) => {
    q.setFromEuler(new THREE.Euler(0, 0, rz))
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
    mesh.setMatrixAt(i, m)
  })
  return mesh
}

function buildPiano(d, mats) {
  const L = d.length
  const pts = outline(L)
  const inner = offset(pts, WALL)
  const parts = []
  const add = (geometry, material, position, rotation) => {
    const mesh = new THREE.Mesh(geometry, material)
    if (position) mesh.position.set(...position)
    if (rotation) mesh.rotation.set(...rotation)
    parts.push(mesh)
    return mesh
  }

  // --- Case: hollow rim, moldings, bottom, soundboard, plate.
  add(extrudeUp(pts, RIM_H, RIM_BOTTOM, 0.004, [inner]), mats.lacquer)
  add(extrudeUp(offset(pts, -0.009), 0.016, RIM_TOP - 0.012, 0.003, [offset(pts, WALL - 0.006)]), mats.lacquer) // top molding
  add(extrudeUp(offset(pts, -0.013), 0.028, RIM_BOTTOM - 0.004, 0.004, [offset(pts, 0.03)]), mats.lacquer) // bottom molding
  add(extrudeUp(pts, 0.02, RIM_BOTTOM), mats.underside) // bottom board
  add(extrudeUp(inner, 0.012, RIM_BOTTOM + 0.07), mats.soundboard)

  const platePts = offset(pts, WALL + 0.025)
  const holes = [
    [0.3, 0.62, 0.09, 0.07],
    [0.44, 0.47, 0.1, 0.08],
    [0.58, 0.35, 0.085, 0.07],
    [0.72, 0.26, 0.065, 0.055],
    [0.3, 0.28, 0.1, 0.08],
  ]
    .map(([fx, fs, rx, rs]) => ellipse(fx * L, fs * W, rx, rs))
    .filter((h) => h.every((p) => inside(offset(platePts, 0.02), p.x, p.y)))
  const plateY = RIM_BOTTOM + 0.15
  add(extrudeUp(platePts, 0.022, plateY, 0.004, holes), mats.plate)

  // --- Strings: march from the pin block toward the tail until they reach the rim.
  const stringArea = offset(pts, WALL + 0.05)
  const treble = []
  const bass = []
  const pins = []
  const dampers = []
  const N = 64
  const sy = plateY + 0.034
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1)
    const s0 = 0.08 * W + 0.86 * W * u
    const x0 = 0.13
    const isBass = u < 0.3
    const dir = new THREE.Vector2(1, isBass ? -0.11 * (1 - u / 0.3) - 0.02 : -0.015).normalize()
    let x = x0
    let s = s0
    while (inside(stringArea, x + dir.x * 0.02, s + dir.y * 0.02) && x < L) {
      x += dir.x * 0.02
      s += dir.y * 0.02
    }
    if (x - x0 < 0.12) continue
    const y = sy + (isBass ? 0.012 : 0)
    ;(isBass ? bass : treble).push(x0, y, s0 - HALF, x, y, s - HALF)
    pins.push([x0 - 0.035 - (i % 2) * 0.022, plateY + 0.04, s0 - HALF, 0.009, 0.035, 0.009])
    if (u < 0.86) dampers.push([0.24, sy + 0.03, s0 - HALF, 0.04, 0.028, ((0.86 * W) / N) * 0.85])
  }
  const lines = (arr, mat) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    const l = new THREE.LineSegments(g, mat)
    parts.push(l)
  }
  lines(treble, mats.string)
  lines(bass, mats.bassString)
  parts.push(boxes(pins, mats.steel))
  parts.push(boxes(dampers, mats.blackFelt))
  // Pressure bar across the strings.
  add(new THREE.BoxGeometry(0.014, 0.012, 0.88 * W), mats.brass, [0.16, sy + 0.012, 0.5 * W - HALF])

  // --- Keyboard: keybed, key slip, 52 white and 36 black keys, felt strip, fallboard, cheek blocks.
  add(new THREE.BoxGeometry(0.2, 0.065, 1.38), mats.lacquer, [-0.1, 0.7225, 0])
  add(new THREE.BoxGeometry(0.02, 0.072, 1.38), mats.lacquer, [-0.196, 0.735, 0])
  const whites = []
  for (let i = 0; i < 52; i++) whites.push([-0.105, 0.766, KEY_Z0 + (i + 0.5) * KEY_W, 0.148, 0.02, KEY_W - 0.0012])
  parts.push(boxes(whites, mats.ivory))
  const blacks = []
  for (let i = 0; i < 51; i++) {
    if ('ACDFG'.includes('ABCDEFG'[i % 7])) blacks.push([-0.064, 0.783, KEY_Z0 + (i + 1) * KEY_W, 0.092, 0.016, 0.0115])
  }
  parts.push(boxes(blacks, mats.ebony))
  add(new THREE.BoxGeometry(0.006, 0.007, 1.24), mats.redFelt, [-0.026, 0.779, 0])
  add(new THREE.BoxGeometry(0.045, 0.1, 1.25), mats.lacquer, [0.005, 0.81, 0], [0, 0, 0.18])
  const cheek = new THREE.Shape()
  cheek.moveTo(-0.205, 0.69)
  cheek.lineTo(0.03, 0.69)
  cheek.lineTo(0.03, 0.845)
  cheek.lineTo(-0.07, 0.845)
  cheek.quadraticCurveTo(-0.205, 0.845, -0.205, 0.772)
  cheek.lineTo(-0.205, 0.69)
  const cheekGeo = new THREE.ExtrudeGeometry(cheek, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 })
  add(cheekGeo, mats.lacquer, [0, 0, 0.615])
  add(cheekGeo, mats.lacquer, [0, 0, -0.685])

  // --- Music desk on the front of the case.
  const desk = new THREE.Shape()
  desk.moveTo(-0.42, 0)
  desk.lineTo(0.42, 0)
  desk.lineTo(0.42, 0.3)
  desk.lineTo(-0.42, 0.3)
  desk.lineTo(-0.42, 0)
  if (d.desk === 'fretwork') {
    for (let k = 0; k < 7; k++) {
      const zc = -0.33 + k * 0.11
      const h = new THREE.Path()
      h.moveTo(zc - 0.032, 0.07)
      h.lineTo(zc - 0.032, 0.19)
      h.quadraticCurveTo(zc - 0.032, 0.245, zc, 0.258)
      h.quadraticCurveTo(zc + 0.032, 0.245, zc + 0.032, 0.19)
      h.lineTo(zc + 0.032, 0.07)
      h.lineTo(zc - 0.032, 0.07)
      desk.holes.push(h)
    }
  } else if (d.desk === 'slots') {
    for (let k = 0; k < 11; k++) {
      const zc = -0.35 + k * 0.07
      const h = new THREE.Path()
      h.moveTo(zc - 0.012, 0.06)
      h.lineTo(zc + 0.012, 0.06)
      h.lineTo(zc + 0.012, 0.24)
      h.lineTo(zc - 0.012, 0.24)
      h.lineTo(zc - 0.012, 0.06)
      desk.holes.push(h)
    }
  }
  const deskGeo = new THREE.ExtrudeGeometry(desk, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 })
  deskGeo.rotateY(-Math.PI / 2)
  const deskGroup = new THREE.Group()
  deskGroup.position.set(0.3, RIM_TOP - 0.005, 0)
  deskGroup.rotation.z = -0.22
  deskGroup.add(new THREE.Mesh(deskGeo, mats.lacquer))
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.86), mats.lacquer)
  ledge.position.set(-0.03, 0.01, 0)
  deskGroup.add(ledge)
  parts.push(deskGroup)

  // --- Lid: main lid raised on the spine hinges, front flap folded back on top of it.
  const lidPts = [new THREE.Vector2(FLAP_X, W), ...pts.filter((p) => p.x > FLAP_X), new THREE.Vector2(FLAP_X, 0)]
  const lidGeo = extrudeUp(lidPts, 0.022, 0, 0.004)
  lidGeo.translate(0, 0, HALF)
  const lid = new THREE.Group()
  lid.position.set(0, RIM_TOP + 0.01, -HALF)
  lid.rotation.x = -LID_ANGLE
  lid.add(new THREE.Mesh(lidGeo, mats.lacquer))
  const flapW = Math.min(W, bentsideAt(pts, FLAP_X * 2) || W)
  const flap = new THREE.Mesh(new THREE.BoxGeometry(FLAP_X - 0.01, 0.02, flapW - 0.01), mats.lacquer)
  flap.position.set(FLAP_X * 1.5, 0.034, flapW / 2)
  lid.add(flap)
  const flapHinge = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, flapW - 0.02, 8), mats.brass)
  flapHinge.rotation.x = Math.PI / 2
  flapHinge.position.set(FLAP_X, 0.026, flapW / 2)
  lid.add(flapHinge)
  for (const f of [0.3, 0.55, 0.8]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.014, 0.03), mats.brass)
    h.position.set(f * L, 0.004, -0.004)
    lid.add(h)
  }
  parts.push(lid)

  // Prop stick resting on the bentside rim.
  const xp = 0.52 * L
  const sRim = bentsideAt(pts, xp) - 0.05
  const r = sRim / Math.cos(LID_ANGLE)
  const propH = r * Math.sin(LID_ANGLE)
  add(new THREE.CylinderGeometry(0.011, 0.013, propH, 10), mats.lacquer, [xp, RIM_TOP + propH / 2, sRim - HALF])
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14), mats.brass, [xp, RIM_TOP + 0.006, sRim - HALF])

  // --- Legs with casters or ferrules.
  const legSpots = [
    [0.2, 0.12 * W],
    [0.2, 0.88 * W],
    [0.78 * L, 0.2 * W],
  ]
  const legGeo =
    d.legs === 'turned'
      ? lathe([[0, 0.06], [0.05, 0.06], [0.058, 0.09], [0.045, 0.13], [0.04, 0.2], [0.042, 0.35], [0.05, 0.45], [0.062, 0.5], [0.054, 0.53], [0.06, 0.56], [0.066, 0.59], [0, 0.59]])
      : d.legs === 'slender'
        ? lathe([[0, 0.05], [0.026, 0.05], [0.024, 0.2], [0.03, 0.4], [0.044, 0.55], [0.05, 0.59], [0, 0.59]])
        : (() => {
            const g = new THREE.CylinderGeometry(0.075, 0.048, 0.53, 4)
            g.rotateY(Math.PI / 4)
            g.translate(0, 0.06 + 0.265, 0)
            return g
          })()
  for (const [x, s] of legSpots) {
    const z = s - HALF
    add(new THREE.BoxGeometry(0.13, 0.07, 0.13), mats.lacquer, [x, RIM_BOTTOM - 0.035, z])
    add(legGeo, mats.lacquer, [x, 0, z])
    if (d.legs === 'turned') {
      add(new THREE.CylinderGeometry(0.052, 0.046, 0.03, 18), mats.brass, [x, 0.075, z])
      const wheel = add(new THREE.CylinderGeometry(0.03, 0.03, 0.022, 18), mats.brass, [x, 0.031, z])
      wheel.rotation.x = Math.PI / 2
    } else if (d.legs === 'deco') {
      add(new THREE.CylinderGeometry(0.036, 0.032, 0.06, 4), mats.brass, [x, 0.03, z], [0, Math.PI / 4, 0])
    } else {
      add(new THREE.TorusGeometry(0.03, 0.005, 8, 24), mats.glow, [x, 0.12, z], [Math.PI / 2, 0, 0])
      add(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 18), mats.lacquer, [x, 0.025, z])
    }
  }

  // --- Pedal lyre: curved posts, pedal box, three brass pedals, braces back to the case.
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.3, RIM_BOTTOM, 0.06 * side),
      new THREE.Vector3(0.29, 0.44, 0.1 * side),
      new THREE.Vector3(0.27, 0.22, 0.085 * side),
      new THREE.Vector3(0.25, 0.1, 0.07 * side),
    ])
    add(new THREE.TubeGeometry(curve, 24, 0.014, 8), mats.lacquer)
    const brace = new THREE.CatmullRomCurve3([new THREE.Vector3(0.3, 0.09, 0.08 * side), new THREE.Vector3(0.78, RIM_BOTTOM, 0.13 * side)])
    add(new THREE.TubeGeometry(brace, 4, 0.008, 6), mats.lacquer)
  }
  add(new THREE.BoxGeometry(0.08, 0.04, 0.24), mats.lacquer, [0.3, RIM_BOTTOM - 0.02, 0])
  add(new THREE.BoxGeometry(0.12, 0.06, 0.24), mats.lacquer, [0.25, 0.07, 0])
  for (const z of [-0.065, 0, 0.065]) add(new THREE.BoxGeometry(0.13, 0.012, 0.034), mats.brass, [0.16, 0.058, z], [0, 0, 0.12])

  // --- Glowing inlay around the rim (Nocturne only).
  if (d.glow) {
    const ring = offset(pts, -0.004).map((p) => new THREE.Vector3(p.x, RIM_BOTTOM + 0.11, p.y - HALF))
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 320, 0.0045, 6, true), mats.glow)
  }

  return parts
}

export default function Piano() {
  const mats = useMemo(() => pianoMaterials(design), [])
  const parts = useMemo(() => buildPiano(design, mats), [mats])

  // Blue spill on the grass: full for the glowing design, faint otherwise.
  useEffect(() => {
    shared.uPianoGlow.value.set(palette.pianoGlow).multiplyScalar(design.glow ? 1 : 0.3)
  }, [])

  useFrame(() => {
    if (!design.glow) return
    const p = shared.uGlowPulse.value
    mats.glow.color.setRGB(0.35 * p * 2.2, 0.55 * p * 2.2, 1.6 * p * 2.2)
  })

  // Everything in the piano also renders into the shadow map.
  const group = useRef()
  useEffect(() => {
    group.current.traverse((o) => o.layers.enable(SHADOW_LAYER))
  }, [])

  return (
    <group ref={group} position={PIANO_POS}>
      {parts.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
      <Bench design={design} lacquer={mats.lacquer} brass={mats.brass} glow={mats.glow} />
    </group>
  )
}
