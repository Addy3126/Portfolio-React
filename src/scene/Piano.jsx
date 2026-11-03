import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BLACK_MIDI, WHITE_MIDI, keys, noteOff, noteOn, piano } from '../piano/engine'
import { SHADOW_LAYER } from './PianoShadow'
import Bench from './piano/Bench'
import { design } from './piano/designs'
import { noiseBump, spruceTextures } from './piano/textures'
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
import { debug } from '../quality'
import { PIANO_CENTRE, PIANO_POS, palette, shared } from './world'

const LID_ANGLE = 0.58
const FLAP_X = 0.37 // where the front lid flap hinges
const KEY_W = 1.22 / 52
const KEY_Z0 = -0.61

// Roughness stays >= 0.1: below that, a sun highlight overflows the half-float frame
// buffer (max 65504) and turns into an infinite pixel (black specks / bloom flicker).
const FINISHES = {
  white: { color: '#f1eef6', roughness: 0.14 },
  black: { color: '#0b0a10', roughness: 0.12 },
  pearl: { color: '#ebe8f8', roughness: 0.12 },
}

export function pianoMaterials(d) {
  const lacquer = new THREE.MeshPhysicalMaterial({
    ...FINISHES[d.finish],
    clearcoat: 1,
    // No clearcoat normal map: three.js derives its tangent frame from screen-space
    // derivatives, which degenerate on some edge pixels and produce NaN (black specks).
    clearcoatRoughness: 0.11,
  })
  const spruce = spruceTextures()
  const hammertone = noiseBump({ seed: 3, dots: 3400, repeat: [5, 5] })
  const felt = noiseBump({ seed: 5, dots: 5000, minR: 0.4, maxR: 1.2, repeat: [1, 1] })
  return {
    lacquer,
    brass: new THREE.MeshStandardMaterial({ color: '#caa45a', metalness: 1, roughness: 0.28 }),
    plate: new THREE.MeshStandardMaterial({ color: '#b48e48', metalness: 0.85, roughness: 0.42, bumpMap: hammertone, bumpScale: 1.4 }),
    soundboard: new THREE.MeshStandardMaterial({ map: spruce.map, bumpMap: spruce.bump, bumpScale: 0.6, roughness: 0.55 }),
    bridge: new THREE.MeshStandardMaterial({ color: '#7a5332', map: spruce.map, roughness: 0.5 }),
    hammerFelt: new THREE.MeshStandardMaterial({ color: '#e9e2d2', roughness: 1, bumpMap: felt, bumpScale: 0.8 }),
    bolt: new THREE.MeshStandardMaterial({ color: '#8d7440', metalness: 0.9, roughness: 0.35 }),
    underside: new THREE.MeshStandardMaterial({ color: '#17141c', roughness: 0.85 }),
    ivory: new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.32 }),
    ebony: new THREE.MeshPhysicalMaterial({ color: '#08080b', roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.12 }),
    redFelt: new THREE.MeshStandardMaterial({ color: '#6e1424', roughness: 1 }),
    sheet: new THREE.MeshStandardMaterial({ map: sheetTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    blackFelt: new THREE.MeshStandardMaterial({ color: '#121016', roughness: 1, bumpMap: felt, bumpScale: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: '#d8dbe4', metalness: 1, roughness: 0.3 }),
    string: new THREE.LineBasicMaterial({ color: '#8e92a3' }),
    bassString: new THREE.LineBasicMaterial({ color: '#8a6440' }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.pianoGlow), toneMapped: false }),
  }
}

// Black key: a box whose top is narrower than its base and whose front slopes back.
function blackKeyGeometry() {
  const g = new THREE.BoxGeometry(0.092, 0.016, 0.0115, 1, 1, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setZ(i, p.getZ(i) * 0.7)
      if (p.getX(i) < 0) p.setX(i, p.getX(i) + 0.012)
    }
  }
  g.computeVertexNormals()
  return g
}

// Pedal seen from above: a narrow shank widening into a rounded foot (x toward the player).
function pedalGeometry() {
  const s = new THREE.Shape()
  s.moveTo(0.06, -0.008)
  s.lineTo(-0.02, -0.012)
  s.quadraticCurveTo(-0.075, -0.02, -0.075, 0)
  s.quadraticCurveTo(-0.075, 0.02, -0.02, 0.012)
  s.lineTo(0.06, 0.008)
  s.lineTo(0.06, -0.008)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 8 })
  g.rotateX(Math.PI / 2) // lie flat: shape in x-z, thickness along y
  g.translate(0, 0.004, 0)
  return g
}

// Printed music for the desk: staves and notes on cream paper (one page; the other mirrors).
function sheetTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 340
  const g = c.getContext('2d')
  g.fillStyle = '#ece4d2'
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = 'rgba(40, 34, 48, 0.75)'
  g.fillStyle = 'rgba(30, 26, 40, 0.85)'
  g.lineWidth = 1
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  g.fillRect(70, 18, 116, 5) // title
  for (let st = 0; st < 9; st++) {
    const y0 = 42 + st * 32
    for (let l = 0; l < 5; l++) {
      g.beginPath()
      g.moveTo(16, y0 + l * 4)
      g.lineTo(240, y0 + l * 4)
      g.stroke()
    }
    for (let x = 30; x < 236; x += 9 + rnd() * 10) {
      const y = y0 + Math.floor(rnd() * 9) * 2
      g.beginPath()
      g.ellipse(x, y, 2.6, 1.8, -0.4, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.moveTo(x + 2.4, y)
      g.lineTo(x + 2.4, y - 11)
      g.stroke()
    }
    g.beginPath()
    g.moveTo(16, y0)
    g.lineTo(16, y0 + 16)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
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

function instanced(geometry, material, points) {
  const mesh = new THREE.InstancedMesh(geometry, material, points.length)
  const m = new THREE.Matrix4()
  points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])))
  return mesh
}

// Replace zero-length or invalid normals (from degenerate edges in extruded outlines),
// which make the lacquer's lighting produce NaN pixels.
function fixNormals(g) {
  const n = g.attributes.normal
  if (!n) return 0
  let fixed = 0
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i)
    const y = n.getY(i)
    const z = n.getZ(i)
    const len = Math.hypot(x, y, z)
    if (!(len > 1e-6) || !Number.isFinite(len)) {
      n.setXYZ(i, 0, 1, 0)
      fixed++
    } else if (Math.abs(len - 1) > 1e-3) {
      n.setXYZ(i, x / len, y / len, z / len)
    }
  }
  if (fixed) n.needsUpdate = true
  return fixed
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

  // --- Strings, grouped per note like a real grand: one string for the lowest bass,
  // two through the bass, three from the tenor up. They run from the agraffes near the
  // keyboard over a curved bridge to hitch pins near the rim.
  const stringArea = offset(pts, WALL + 0.05)
  const treble = []
  const bass = []
  const pins = []
  const dampers = []
  const hammers = []
  const agraffes = []
  const hitch = []
  const bridgeTreble = []
  const bridgeBass = []
  const NOTES = 60
  const noteW = (0.86 * W) / NOTES
  const sy = plateY + 0.034
  for (let i = 0; i < NOTES; i++) {
    const u = i / (NOTES - 1)
    const sNote = 0.08 * W + 0.86 * W * u
    const x0 = 0.13
    const isBass = u < 0.3
    const unison = u < 0.12 ? 1 : u < 0.3 ? 2 : 3
    const dir = new THREE.Vector2(1, isBass ? -0.11 * (1 - u / 0.3) - 0.02 : -0.015).normalize()
    let x = x0
    let sEnd = sNote
    while (inside(stringArea, x + dir.x * 0.02, sEnd + dir.y * 0.02) && x < L) {
      x += dir.x * 0.02
      sEnd += dir.y * 0.02
    }
    if (x - x0 < 0.12) continue
    const y = sy + (isBass ? 0.012 : 0)
    for (let k = 0; k < unison; k++) {
      const ds = (k - (unison - 1) / 2) * 0.0036
      ;(isBass ? bass : treble).push(x0, y, sNote + ds - HALF, x, y, sEnd + ds - HALF)
      pins.push([x0 - 0.035 - ((i + k) % 2) * 0.022, plateY + 0.04, sNote + ds - HALF, 0.008, 0.035, 0.008])
    }
    const z0 = sNote - HALF
    agraffes.push([0.152, y + 0.004, z0, 0.012, 0.012, 0.004 * unison + 0.006])
    hammers.push([0.205, y - 0.032, z0, 0.024, 0.03, noteW * 0.82])
    if (u < 0.86) dampers.push([0.24, sy + 0.03, z0, 0.04, 0.028, noteW * 0.85])
    // Bridge sits under the strings ~88% of the way along; hitch pins at the far end.
    const f = 0.88
    ;(isBass ? bridgeBass : bridgeTreble).push(new THREE.Vector3(x0 + (x - x0) * f, y - 0.009, z0 + (sEnd - sNote) * f))
    hitch.push([x, y - 0.002, sEnd - HALF])
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
  parts.push(boxes(hammers, mats.hammerFelt))
  parts.push(boxes(agraffes, mats.brass))
  parts.push(instanced(new THREE.CylinderGeometry(0.003, 0.003, 0.016, 6), mats.steel, hitch))
  for (const pts3 of [bridgeTreble, bridgeBass]) {
    if (pts3.length < 2) continue
    const bridge = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3), Math.max(8, pts3.length * 2), 0.011, 4)
    add(bridge, mats.bridge)
  }

  // Plate bolts: around the plate edge and each cut-out.
  const bolts = []
  const boltRing = offset(platePts, 0.03)
  let acc = 0
  for (let i = 1; i < boltRing.length; i++) {
    acc += boltRing[i].distanceTo(boltRing[i - 1])
    if (acc > 0.17) {
      acc = 0
      bolts.push([boltRing[i].x, plateY + 0.024, boltRing[i].y - HALF])
    }
  }
  for (const h of holes)
    for (let k = 0; k < h.length; k += Math.floor(h.length / 6)) {
      const c = h.reduce((v, p) => v.add(p), new THREE.Vector2()).multiplyScalar(1 / h.length)
      const p = h[k].clone().sub(c).multiplyScalar(1.3).add(c)
      bolts.push([p.x, plateY + 0.024, p.y - HALF])
    }
  const boltGeo = new THREE.SphereGeometry(0.009, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  parts.push(instanced(boltGeo, mats.bolt, bolts))

  // Pressure bar across the strings.
  add(new THREE.BoxGeometry(0.014, 0.012, 0.88 * W), mats.brass, [0.16, sy + 0.012, 0.5 * W - HALF])

  // --- Keyboard: keybed, key slip, 52 white and 36 black keys, felt strip, fallboard, cheek blocks.
  add(new THREE.BoxGeometry(0.2, 0.065, 1.38), mats.lacquer, [-0.1, 0.7225, 0])
  add(new THREE.BoxGeometry(0.02, 0.072, 1.38), mats.lacquer, [-0.196, 0.735, 0])
  // White keys with softly rounded fronts and edges; black keys tapered (narrower on top,
  // with a sloped front), as real sharps are.
  const whites = []
  for (let i = 0; i < 52; i++) whites.push([-0.105, 0.766, KEY_Z0 + (i + 0.5) * KEY_W])
  const whiteMesh = instanced(new RoundedBoxGeometry(0.148, 0.02, KEY_W - 0.0012, 2, 0.0028), mats.ivory, whites)
  whiteMesh.userData.keys = { kind: 'white', points: whites }
  parts.push(whiteMesh)
  const blacks = []
  for (let i = 0; i < 51; i++) {
    if ('ACDFG'.includes('ABCDEFG'[i % 7])) blacks.push([-0.064, 0.783, KEY_Z0 + (i + 1) * KEY_W])
  }
  const blackMesh = instanced(blackKeyGeometry(), mats.ebony, blacks)
  blackMesh.userData.keys = { kind: 'black', points: blacks }
  parts.push(blackMesh)
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
  // Sheet music open on the desk: two slightly bowed pages.
  for (const side of [-1, 1]) {
    const page = new THREE.PlaneGeometry(0.21, 0.28, 8, 1)
    const pp = page.attributes.position
    for (let i = 0; i < pp.count; i++) {
      const u = pp.getX(i) / 0.105 // -1..1 across the page
      pp.setZ(i, 0.012 * (1 - u * u) + 0.006 * (side * u + 1)) // bowed, rising toward the spine
    }
    page.computeVertexNormals()
    const m = new THREE.Mesh(page, mats.sheet)
    m.rotation.y = -Math.PI / 2
    m.position.set(-0.012, 0.165, side * 0.1055)
    if (side < 0) m.scale.x = -1
    deskGroup.add(m)
  }
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

  // Prop stick: socket on the bentside rim, leaning inward to a cup under the lid.
  // The lid point it meets is measured along the tilted lid, so it always lands on the lid.
  const xp = 0.52 * L
  const edge = bentsideAt(pts, xp)
  const sBase = edge - 0.035
  const rLid = edge - 0.09 // distance from the hinge along the lid, safely inside its edge
  const base = new THREE.Vector3(xp, RIM_TOP, sBase - HALF)
  const top = new THREE.Vector3(xp, RIM_TOP + 0.01 + rLid * Math.sin(LID_ANGLE), rLid * Math.cos(LID_ANGLE) - HALF)
  const len = base.distanceTo(top)
  const stick = add(new THREE.CylinderGeometry(0.011, 0.013, len, 10), mats.lacquer)
  stick.position.copy(base).lerp(top, 0.5)
  stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(base).normalize())
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14), mats.brass, [xp, RIM_TOP + 0.006, sBase - HALF])
  add(new THREE.CylinderGeometry(0.02, 0.014, 0.018, 14), mats.brass, [top.x, top.y - 0.012, top.z])

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
  // Pedals: brass, a narrow shank widening to a rounded foot, with a rod up into the box.
  for (const z of [-0.065, 0, 0.065]) {
    const pedal = add(pedalGeometry(), mats.brass, [0.2, 0.058, z], [0, 0, 0.12])
    if (z > 0) pedal.userData.sustainPedal = true // the right pedal, on the player's right
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 8), mats.brass, [0.27, 0.085, z])
  }

  // --- Glowing inlay around the rim (Nocturne only).
  if (d.glow) {
    const ring = offset(pts, -0.004).map((p) => new THREE.Vector3(p.x, RIM_BOTTOM + 0.11, p.y - HALF))
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 320, 0.0045, 6, true), mats.glow)
  }

  return parts
}

// Cube capture of the surroundings, prefiltered for the lacquer (WebGL). The WebGPU path
// passes its own (node materials prefilter cube maps themselves).
function captureEnvGL(gl, scene, at) {
  const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType })
  const cam = new THREE.CubeCamera(0.3, 3000, rt)
  cam.position.copy(at)
  cam.update(gl, scene)
  const pmrem = new THREE.PMREMGenerator(gl)
  const env = pmrem.fromCubemap(rt.texture)
  pmrem.dispose()
  rt.dispose()
  return env
}

// Playable keys: each key dips about a pivot at its back end when held and springs back,
// with a blue glow plate over it that flares on the strike and fades; the right pedal goes
// down with the sustain. Clicking or tapping a key plays it (and dragging across keys plays
// a glissando) while in play mode.
const PRESS = { white: { pivot: 0.074, angle: 0.068, top: 0.0105, len: 0.148, wid: KEY_W - 0.004 }, black: { pivot: 0.046, angle: 0.08, top: 0.0085, len: 0.088, wid: 0.0095 } }
const GLOW = new THREE.Color(0.35, 0.6, 1.6)
function usePlayableKeys(parts) {
  const state = useMemo(() => {
    const white = parts.find((p) => p.userData.keys?.kind === 'white')
    const black = parts.find((p) => p.userData.keys?.kind === 'black')
    const rows = [
      ...white.userData.keys.points.map((pt, i) => ({ mesh: white, i, pt, midi: WHITE_MIDI[i], k: PRESS.white })),
      ...black.userData.keys.points.map((pt, i) => ({ mesh: black, i, pt, midi: BLACK_MIDI[i], k: PRESS.black })),
    ]
    const glowMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 'white', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      rows.length,
    )
    glowMesh.raycast = () => {} // clicks go to the keys underneath
    glowMesh.frustumCulled = false
    rows.forEach((r, j) => glowMesh.setColorAt(j, new THREE.Color(0, 0, 0)))
    const pedal = parts.find((p) => p.userData.sustainPedal)
    return { rows, glowMesh, depth: new Float32Array(rows.length).fill(-1), pedal, pedalRest: pedal?.rotation.z ?? 0 }
  }, [parts])

  const m4 = useMemo(() => new THREE.Matrix4(), [])
  const tmp = useMemo(() => ({ t: new THREE.Matrix4(), r: new THREE.Matrix4(), c: new THREE.Color() }), [])
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1)
    let dirty = false
    keys.energy *= Math.exp(-d * 2.5)
    state.rows.forEach((r, j) => {
      const target = keys.down[r.midi] ? 1 : 0
      const cur = state.depth[j]
      const next = cur < 0 ? target : cur + (target - cur) * (1 - Math.exp(-d * (target > cur ? 60 : 22)))
      if (keys.down[r.midi]) keys.glow[r.midi] = Math.max(keys.glow[r.midi], 0.55)
      else keys.glow[r.midi] *= Math.exp(-d * 3.2)
      const g = keys.glow[r.midi] < 0.003 ? 0 : keys.glow[r.midi]
      if (Math.abs(next - cur) < 1e-4 && g === 0 && cur >= 0 && !r.lit) return
      state.depth[j] = next
      r.lit = g > 0
      // Key: translate to its place, rotate about the back pivot.
      const a = next * r.k.angle
      m4.makeTranslation(r.pt[0], r.pt[1], r.pt[2])
      m4.multiply(tmp.t.makeTranslation(r.k.pivot, 0, 0)).multiply(tmp.r.makeRotationZ(a)).multiply(tmp.t.makeTranslation(-r.k.pivot, 0, 0))
      r.mesh.setMatrixAt(r.i, m4)
      r.mesh.instanceMatrix.needsUpdate = true
      // Glow plate on its top face (moves with it).
      const plate = m4.clone().multiply(tmp.t.makeTranslation(0, r.k.top, 0)).multiply(tmp.r.makeScale(r.k.len, 0.002, r.k.wid))
      state.glowMesh.setMatrixAt(j, plate)
      state.glowMesh.setColorAt(j, tmp.c.copy(GLOW).multiplyScalar(g * (r.k === PRESS.black ? 1.6 : 1)))
      dirty = true
    })
    if (dirty) {
      state.glowMesh.instanceMatrix.needsUpdate = true
      state.glowMesh.instanceColor.needsUpdate = true
    }
    if (state.pedal) {
      const want = state.pedalRest + (piano.sustain ? 0.11 : 0)
      state.pedal.rotation.z += (want - state.pedal.rotation.z) * (1 - Math.exp(-d * 18))
    }
  })

  const pointer = useRef({ midi: null })
  useEffect(() => {
    const up = () => {
      if (pointer.current.midi !== null) noteOff(pointer.current.midi)
      pointer.current.midi = null
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])
  const midiOf = (kind, id) => (kind === 'white' ? WHITE_MIDI : BLACK_MIDI)[id]
  const handlers = (kind) => ({
    onPointerDown: (e) => {
      if (!piano.playing || e.instanceId === undefined) return
      e.stopPropagation()
      const m = midiOf(kind, e.instanceId)
      pointer.current.midi = m
      noteOn(m, 0.62 + Math.random() * 0.12) // a little variation, like a real touch
    },
    onPointerMove: (e) => {
      const p = pointer.current
      if (!piano.playing || p.midi === null || e.instanceId === undefined) return
      e.stopPropagation()
      const m = midiOf(kind, e.instanceId)
      if (m !== p.midi) {
        noteOff(p.midi)
        noteOn(m, 0.6)
        p.midi = m
      }
    },
  })
  return { glowMesh: state.glowMesh, handlers }
}

export default function Piano({ captureEnv }) {
  const mats = useMemo(() => pianoMaterials(design), [])
  const parts = useMemo(() => {
    const list = buildPiano(design, mats)
    let fixed = 0
    for (const p of list) p.traverse((o) => o.geometry && (fixed += fixNormals(o.geometry)))
    if (fixed && import.meta.env.DEV) console.info('piano: repaired', fixed, 'normals')
    window.__pianoNormalsFixed = fixed
    return list
  }, [mats])

  // Blue spill on the grass: full for the glowing design, faint otherwise.
  useEffect(() => {
    shared.uPianoGlow.value.set(palette.pianoGlow).multiplyScalar(design.glow ? 1 : 0.3)
  }, [])

  useFrame(() => {
    if (!design.glow) return
    // The inlay also swells with what's being played.
    const p = shared.uGlowPulse.value * (1 + keys.energy * 0.9)
    mats.glow.color.setRGB(0.35 * p * 2.2, 0.55 * p * 2.2, 1.6 * p * 2.2)
  })

  const playable = usePlayableKeys(parts)

  const group = useRef()

  // One-off reflection capture: a cube view of the field and sky from the piano's
  // position (piano hidden), so the lacquer and brass reflect the real surroundings.
  const { gl, scene } = useThree()
  const capture = useRef({ frame: 0, done: false, rt: null, env: null })
  useFrame(() => {
    const c = capture.current
    if (c.done || !debug.envCapture || ++c.frame < 8) return // after the shadow map and grass have settled
    c.done = true
    const at = PIANO_CENTRE.clone().add(new THREE.Vector3(0, 0.5, 0))
    group.current.visible = false
    const env = (captureEnv ?? captureEnvGL)(gl, scene, at)
    group.current.visible = true
    for (const m of [mats.lacquer, mats.brass, mats.plate, mats.ebony, mats.steel, mats.bolt]) {
      m.envMap = env.texture
      m.envMapIntensity = m === mats.lacquer ? 1.35 : 1
      m.needsUpdate = true
    }
    c.env = env
  })
  useEffect(() => () => capture.current.env?.dispose(), [])

  // Everything in the piano also renders into the shadow map.
  useEffect(() => {
    group.current.traverse((o) => o.layers.enable(SHADOW_LAYER))
  }, [])

  return (
    <group ref={group} position={PIANO_POS}>
      {parts.map((p, i) =>
        p.userData.keys ? <primitive key={i} object={p} {...playable.handlers(p.userData.keys.kind)} /> : <primitive key={i} object={p} />,
      )}
      <Bench design={design} lacquer={mats.lacquer} brass={mats.brass} glow={mats.glow} />
      <primitive object={playable.glowMesh} />
    </group>
  )
}
