import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from '../glsl'
import { surfaceUniforms } from '../surfaces'
import { color, shared } from '../world'

// Part kinds, stored per vertex so one material can shade a whole building.
export const KIND = { wall: 0, slab: 1, column: 2, core: 3, rebar: 4, vine: 5, trim: 6 }

const STYLES = {
  concrete: { floor: 3.0, winH: 0.5, sills: false, lintel: false, balconies: true },
  brick: { floor: 3.3, winH: 0.55, sills: true, lintel: false, balconies: true },
  stone: { floor: 3.6, winH: 0.5, sills: true, lintel: true, balconies: false },
}

// The broken-out opening in a project tower's front face (spec.project set): the middle
// three columns (all of them on a three-column face) over the third and fourth floors. Its
// wall is knocked through, the floor slab between is broken back, and a preview of the
// project shows in the gap (src/scene/Facade.jsx).
export const OPENING_FLOORS = [2, 3]
export const OPENING_DEPTH = 0.38 // the preview screen's depth behind the face

// Builds one building as a single merged geometry (position, normal, aKind) plus the
// centres of its front-facing windows (for the lit project towers) and, for project towers,
// the front face's window grid and opening (`facade`, in building space).
export function buildTower(spec, rand) {
  const st = STYLES[spec.style] || STYLES.concrete
  const { w, d } = spec
  const fh = st.floor
  const n = Math.max(2, Math.floor(spec.h / fh))
  const t = 0.3 // wall thickness
  const pos = []
  const nor = []
  const kind = []
  const windows = []
  const tmp = new THREE.Matrix4()
  const rot = new THREE.Euler()

  const box = (cx, cy, cz, sx, sy, sz, k, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed()
    rot.set(rx, ry, rz)
    tmp.makeRotationFromEuler(rot).setPosition(cx, cy, cz)
    g.applyMatrix4(tmp)
    pos.push(...g.attributes.position.array)
    nor.push(...g.attributes.normal.array)
    for (let i = 0; i < g.attributes.position.count; i++) kind.push(k)
    g.dispose()
  }

  // The four faces: map (along-face u, height y, outward offset o) to building space.
  const sides = [
    { len: w, place: (u, o) => [u, d / 2 - o], sx: (s, th) => [s, th], front: true },
    { len: w, place: (u, o) => [-u, -d / 2 + o], sx: (s, th) => [s, th] },
    { len: d, place: (u, o) => [w / 2 - o, -u], sx: (s, th) => [th, s] },
    { len: d, place: (u, o) => [-w / 2 + o, u], sx: (s, th) => [th, s] },
  ]
  const faceBox = (side, u, y, along, height, thick, out, k, rz = 0) => {
    const [x, z] = side.place(u, out)
    const [sx, sz] = side.sx(along, thick)
    box(x, y, z, sx, height, sz, k, 0, 0, rz)
  }

  // How high each column of each face still stands (broken towers have jagged tops).
  const tops = sides.map((side) => {
    const cols = Math.max(2, Math.round(side.len / 2.6))
    return Array.from({ length: cols }, () =>
      spec.broken ? n - 1 - Math.floor(rand() * rand() * Math.min(5, n - 1)) : rand() < 0.08 ? n - 2 : n - 1,
    )
  })
  const minTop = Math.min(...tops.flat())

  // Project towers: which front columns and floors the opening spans.
  const frontCols = tops[0].length
  const open = spec.project !== undefined && {
    c0: frontCols >= 5 ? 1 : 0,
    c1: frontCols >= 5 ? frontCols - 2 : frontCols - 1,
    f0: OPENING_FLOORS[0],
    f1: OPENING_FLOORS[1],
  }
  const skip = () => {}

  sides.forEach((side, si) => {
    const cols = tops[si].length
    const cw = side.len / cols
    for (let c = 0; c < cols; c++) {
      const u0 = -side.len / 2 + (c + 0.5) * cw
      const ww = cw * 0.52
      const pw = (cw - ww) / 2
      for (let f = 0; f <= tops[si][c]; f++) {
        const y0 = f * fh
        const wh = fh * st.winH
        const sill = y0 + fh * 0.3
        if (f > 0 && rand() < 0.035 && !(open && si === 0)) continue // a missing panel, open to the interior
        // Inside the opening: no piers, sills or lintels between its windows.
        const inOpen = open && si === 0 && c >= open.c0 && c <= open.c1 && f >= open.f0 && f <= open.f1
        const fb = inOpen ? skip : faceBox
        // Piers: full height, or inside the opening only the parts below and above it.
        const pier = (u, inner) => {
          if (!(inOpen && inner)) return faceBox(side, u, y0 + fh / 2, pw, fh, t, t / 2, KIND.wall)
          if (f === open.f0) faceBox(side, u, y0 + fh * 0.15, pw, fh * 0.3, t, t / 2, KIND.wall)
          const top = fh - fh * 0.3 - wh
          if (f === open.f1) faceBox(side, u, y0 + fh - top / 2, pw, top, t, t / 2, KIND.wall)
        }
        pier(u0 - cw / 2 + pw / 2, open && c > open.c0)
        pier(u0 + cw / 2 - pw / 2, open && c < open.c1)
        ;(inOpen && f > open.f0 ? skip : faceBox)(side, u0, y0 + fh * 0.15, ww, fh * 0.3, t, t / 2, KIND.wall)
        const above = fh - fh * 0.3 - wh
        ;(inOpen && f < open.f1 ? skip : faceBox)(side, u0, sill + wh + above / 2, ww, above, t, t / 2, KIND.wall)
        if (st.sills) fb(side, u0, sill - 0.04, ww + 0.2, 0.1, t + 0.16, t / 2 - 0.06, KIND.trim)
        if (st.lintel) fb(side, u0, sill + wh + 0.12, ww + 0.3, 0.24, t + 0.1, t / 2 - 0.04, KIND.trim)
        if (side.front && !inOpen) {
          const [x, z] = side.place(u0, t + 0.04)
          windows.push({ x, y: sill + wh / 2, z, w: ww * 0.94, h: wh * 0.94, col: c, floor: f })
        }
        // What's left of a window frame: a mullion and a transom, some missing or bent.
        if (!side.front && rand() < 0.45) {
          const bent = rand() < 0.3 ? (rand() - 0.5) * 0.5 : 0
          faceBox(side, u0, sill + wh / 2, 0.06, wh, 0.08, t * 0.6, KIND.rebar, bent)
          if (rand() < 0.6) faceBox(side, u0, sill + wh * 0.66, ww, 0.05, 0.08, t * 0.6, KIND.rebar)
        }
        // Balconies on the brick and concrete blocks, some cracked off at an angle (none on
        // a project tower's front, where they would hang over its windows).
        if (st.balconies && f > 0 && f < tops[si][c] && rand() < 0.16 && !(open && si === 0)) {
          const drop = rand() < 0.3
          const out = -0.55
          faceBox(side, u0, y0 + 0.1, ww + 0.4, 0.16, 1.1, out, KIND.slab, drop ? (rand() < 0.5 ? -1 : 1) * (0.12 + rand() * 0.2) : 0)
          if (!drop) {
            faceBox(side, u0, y0 + 0.62, ww + 0.4, 0.06, 0.06, -1.06, KIND.rebar)
            for (let r = -2; r <= 2; r++) faceBox(side, u0 + (r * (ww + 0.3)) / 4, y0 + 0.4, 0.04, 0.5, 0.04, -1.06, KIND.rebar)
          }
        }
      }
      // Broken columns: a ragged chunk of wall and exposed rebar above the last floor.
      if (tops[si][c] < n - 1 || spec.broken) {
        const yTop = (tops[si][c] + 1) * fh
        if (spec.broken) faceBox(side, u0 + (rand() - 0.5) * cw * 0.4, yTop + 0.35, cw * (0.3 + rand() * 0.4), 0.5 + rand() * 0.9, t, t / 2, KIND.wall, (rand() - 0.5) * 0.6)
        for (let b = 0; b < 2; b++) {
          const len = 0.7 + rand() * 1.1
          const [x, z] = side.place(u0 + (b - 0.5) * cw * 0.6, t / 2)
          box(x, yTop + len / 2, z, 0.05, len, 0.05, KIND.rebar, (rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.8)
        }
      }
    }
  })

  // Floor slabs (protruding slightly) up to the intact part, dark core behind the openings,
  // corner columns.
  for (let f = 1; f <= minTop + 1; f++) {
    // A slab crossing the opening is broken back from the face, behind the preview.
    if (open && f > open.f0 && f <= open.f1) box(0, f * fh - 0.15, -0.45, w + 0.2, 0.3, d + 0.2 - 0.9, KIND.slab)
    else box(0, f * fh - 0.15, 0, w + 0.2, 0.3, d + 0.2, KIND.slab)
  }
  // Above the intact part, broken floors: a slab snapped at the wall and hanging from its
  // rebar, tilted down and out from the face.
  if (spec.broken) {
    const hangs = 1 + Math.floor(rand() * 2)
    for (let hI = 0; hI < hangs; hI++) {
      const f = minTop + 1 + Math.floor(rand() * 2)
      const side = sides[Math.floor(rand() * 4)]
      const u = (rand() - 0.5) * side.len * 0.5
      const len = 1.4 + rand() * 1.2
      const ang = 0.7 + rand() * 0.5 // from horizontal, hinged at the wall
      const width = side.len * (0.25 + rand() * 0.2)
      const yHinge = f * fh - 0.15
      // Slab built flat in face space (x along the face, z outward), rotated about the
      // hinge line, then mapped onto the face with the same place() as everything else.
      const g = new THREE.BoxGeometry(width, 0.25, len).translate(0, 0, len / 2)
      g.rotateX(ang)
      const [hx, hz] = side.place(u, 0)
      const [ox, oz] = side.place(u, -1)
      const outX = ox - hx
      const outZ = oz - hz
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(outZ, 0, -outX), new THREE.Vector3(0, 1, 0), new THREE.Vector3(outX, 0, outZ)).setPosition(hx, yHinge, hz)
      const ng = g.toNonIndexed()
      g.dispose()
      ng.applyMatrix4(m)
      pos.push(...ng.attributes.position.array)
      nor.push(...ng.attributes.normal.array)
      for (let i = 0; i < ng.attributes.position.count; i++) kind.push(KIND.slab)
      ng.dispose()
      for (let r = 0; r < 4; r++) {
        const [rx, rz] = side.place(u + (r - 1.5) * width * 0.25, -0.05)
        box(rx, yHinge + 0.05, rz, 0.04, 0.45, 0.04, KIND.rebar, (rand() - 0.5) * 0.8, 0, (rand() - 0.5) * 0.8)
      }
    }
  }
  // Debris heaped inside the ground floor, seen through the openings.
  for (let i = 0; i < 6; i++) {
    const sx = 0.4 + rand() * 1.1
    box((rand() - 0.5) * (w - 1.2), 0.15 + rand() * 0.25, (rand() - 0.5) * (d - 1.2), sx, 0.3 + rand() * 0.4, sx * (0.6 + rand() * 0.6), KIND.slab, (rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6)
  }
  const coreH = (minTop + 1) * fh
  box(0, coreH / 2, 0, w - 2 * t - 0.3, coreH, d - 2 * t - 0.3, KIND.core)
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box((cx * w) / 2, coreH / 2, (cz * d) / 2, 0.5, coreH, 0.5, KIND.column)

  // Intact buildings keep a cornice and parapet.
  if (!spec.broken && minTop === n - 1) {
    box(0, n * fh + 0.2, 0, w + 0.6, 0.45, d + 0.6, KIND.trim)
    box(0, n * fh + 0.75, 0, w + 0.1, 0.7, d + 0.1, KIND.wall)
  }

  // Ivy: stems climb from the ground and spread across the wall, branching as they go,
  // with leaves (small tilted quads) clustered along them; plus a few vines trailing down
  // from broken tops. Leaves are thin boxes in the vine colour, so one material covers it.
  const leaf = (side, u, y, size, out) => faceBox(side, u, y, size, size * (0.75 + rand() * 0.4), 0.03, out, KIND.vine, (rand() - 0.5) * 1.6)
  const climbers = 2 + Math.floor(rand() * 4)
  for (let v = 0; v < climbers; v++) {
    const si = Math.floor(rand() * 4)
    if (open && si === 0) continue // a project tower's front stays clear for its windows
    const side = sides[si]
    const maxY = Math.min((Math.min(...tops[si]) + 1) * fh - 0.3, 3 + rand() * 9)
    const grow = (u, y, dirU, len, depth) => {
      const steps = Math.ceil(len / 0.35)
      for (let k = 0; k < steps && y < maxY && Math.abs(u) < side.len / 2 - 0.2; k++) {
        u += dirU * 0.35 + (rand() - 0.5) * 0.12
        y += 0.3 * (0.6 + rand() * 0.5)
        faceBox(side, u, y, 0.05, 0.36, 0.04, -0.03, KIND.vine, (rand() - 0.5) * 0.6)
        const n = 3 + Math.floor(rand() * 3)
        for (let l = 0; l < n; l++) leaf(side, u + (rand() - 0.5) * 0.5, y + (rand() - 0.5) * 0.35, 0.16 + rand() * 0.14, -0.05 - rand() * 0.07)
        if (depth < 2 && rand() < 0.16) grow(u, y, (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.6), len * 0.5, depth + 1)
      }
    }
    grow((rand() - 0.5) * side.len * 0.8, 0, (rand() - 0.5) * 0.8, 3 + rand() * 9, 0)
  }
  const vines = 3 + Math.floor(rand() * 3)
  for (let v = 0; v < vines; v++) {
    const si = Math.floor(rand() * 4)
    if (open && si === 0) continue
    const side = sides[si]
    const cols = tops[si].length
    const c = Math.floor(rand() * cols)
    const yStart = (tops[si][c] + 1) * fh - 0.2
    const len = Math.min(yStart - 0.5, 3 + rand() * 6)
    if (len < 1.5) continue
    let u = -side.len / 2 + (c + 0.15 + rand() * 0.7) * (side.len / cols)
    for (let y = yStart; y > yStart - len; y -= 0.32) {
      u += (rand() - 0.5) * 0.1
      faceBox(side, u, y, 0.04, 0.34, 0.04, -0.03, KIND.vine)
      for (let l = 0; l < 2; l++) leaf(side, u + (rand() - 0.5) * 0.35, y + (rand() - 0.5) * 0.3, 0.14 + rand() * 0.12, -0.05 - rand() * 0.05)
    }
  }

  // The opening's broken edge: chunks of wall hanging into the gap and bent rebar.
  let facade = null
  if (open) {
    const cw = w / frontCols
    const ww = cw * 0.52
    const wh = fh * st.winH
    const front = sides[0]
    const x0 = -w / 2 + (open.c0 + 0.5) * cw - ww / 2
    const x1 = -w / 2 + (open.c1 + 0.5) * cw + ww / 2
    const y0 = open.f0 * fh + fh * 0.3
    const y1 = open.f1 * fh + fh * 0.3 + wh
    const edge = (u, y, horizontal) => {
      const s0 = 0.25 + rand() * 0.45
      const along = horizontal ? s0 * (1.2 + rand()) : s0
      const across = horizontal ? s0 : s0 * (1.2 + rand())
      faceBox(front, u, y, along, across, t * (0.7 + rand() * 0.6), t / 2 + (rand() - 0.5) * 0.12, KIND.wall, (rand() - 0.5) * 0.9)
    }
    for (let u = x0 + 0.2; u < x1; u += 0.45 + rand() * 0.5) {
      edge(u, y1 + 0.05 - rand() * 0.25, true)
      edge(u + 0.2, y0 - 0.05 + rand() * 0.25, true)
    }
    for (let y = y0 + 0.2; y < y1; y += 0.45 + rand() * 0.5) {
      edge(x0 - 0.05 + rand() * 0.22, y, false)
      edge(x1 + 0.05 - rand() * 0.22, y, false)
    }
    for (let r = 0; r < 7; r++) {
      const u = x0 + rand() * (x1 - x0)
      const len = 0.35 + rand() * 0.6
      const top = rand() < 0.6
      const [x, z] = front.place(u, t / 2)
      box(x, top ? y1 - len / 2 : y0 + len / 2, z, 0.04, len, 0.04, KIND.rebar, (rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.9)
    }
    facade = {
      cols: Array.from({ length: frontCols }, (_, c) => -w / 2 + (c + 0.5) * cw),
      floorY: (f) => f * fh + fh * 0.3 + wh / 2,
      tops: tops[0],
      winW: ww * 0.94,
      winH: wh * 0.94,
      frontZ: d / 2,
      paneZ: d / 2 - (t + 0.02),
      open: { ...open, x0, x1, y0, y1, z: d / 2 - OPENING_DEPTH },
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1))
  g.computeBoundingSphere()
  return { geometry: g, windows, height: n * fh, facade }
}

const vertex = /* glsl */ `
attribute float aKind;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vKind;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform sampler2D tWallS, tWallN, tPlasterS, tPlasterN;
uniform vec3 cWall, cWall2, cMortar, cSlab, cCore, cRebar, cVine, cTrim, cFrostB, cWetB, cSaltB, cAlgae, cSkyB, cGroundB, cSunB;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vKind;
${noiseGLSL}
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormalW + vec3(0.0, 1e-5, 0.0));
  float k = floor(vKind + 0.5);
  float y = vWorld.y;
  // Coordinate along the face, for patterns and streaks.
  float u = abs(N.x) > abs(N.z) ? vWorld.z : vWorld.x;
  float detail = 1.0 - smoothstep(50.0, 140.0, dist);

  // Photo-scanned masonry mapped along the face (concrete, mixed brick or rustic stone),
  // with patches of damaged plaster on concrete.
  bool flatFace = abs(N.y) > 0.7;
  vec2 tuv = (flatFace ? vWorld.xz : vec2(u, y)) / TEX_SIZE;
  vec3 ws = texture2D(tWallS, tuv).rgb;
  vec2 wn = texture2D(tWallN, tuv).xy;
  #if STYLE == 0
    float plasterMask = smoothstep(0.55, 0.7, vnoise(vec2(u, y) * 0.18 + vec2(3.1, 7.7)));
    vec3 ps = texture2D(tPlasterS, tuv * 1.3).rgb;
    ws = mix(ws, ps, plasterMask);
    wn = mix(wn, texture2D(tPlasterN, tuv * 1.3).xy, plasterMask);
  #endif
  float lum = ws.r;
  bool masonry = k < 2.5 || abs(k - 6.0) < 0.5;
  if (masonry) {
    vec2 tn = (wn * 2.0 - 1.0) * detail;
    vec3 T = flatFace ? vec3(1.0, 0.0, 0.0) : (abs(N.x) > abs(N.z) ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
    vec3 B = flatFace ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    N = normalize(N + T * tn.x + B * tn.y);
  }
  float aoTex = masonry ? mix(1.0, ws.b, detail) : 1.0;

  vec3 albedo = cWall;
  if (k < 0.5 || abs(k - 2.0) < 0.5) {
    albedo = mix(cWall, cWall2, vnoise(vec2(u * 0.35, y * 0.25))) * (lum * 1.1 + 0.45);
    if (abs(k - 2.0) < 0.5) albedo *= 0.9;
  }
  if (abs(k - 1.0) < 0.5) albedo = cSlab * (lum * 0.8 + 0.6);
  if (abs(k - 3.0) < 0.5) albedo = cCore;
  if (abs(k - 4.0) < 0.5) albedo = cRebar;
  if (abs(k - 5.0) < 0.5) albedo = cVine * (0.7 + 0.6 * vnoise(vWorld.xy * 3.0 + vWorld.z));
  if (abs(k - 6.0) < 0.5) albedo = cTrim * (lum * 0.8 + 0.6);

  // Light weathering on masonry: rain streaks, grime low down, waterline staining, frost on ledges.
  if (k < 2.5 || abs(k - 6.0) < 0.5) {
    float vertical = 1.0 - smoothstep(0.2, 0.5, abs(N.y));
    float streak = smoothstep(0.62, 0.9, vnoise(vec2(u * 5.0, y * 0.22))) * vertical;
    albedo *= 1.0 - 0.28 * streak;
    albedo *= mix(0.72, 1.0, smoothstep(0.0, 5.0, y));
    albedo = mix(albedo, cWetB, 1.0 - smoothstep(0.1, 0.7, y));
    // Rising damp: water wicks up the masonry from the sea, leaving a darker band with an
    // irregular tide-mark edge, algae near the bottom, and white salt bloom (efflorescence)
    // where it dries along the top edge.
    float dampTop = 1.6 + 1.4 * vnoise(vec2(u * 0.35, 1.0)) + 0.4 * vnoise(vec2(u * 2.0, 3.0));
    float damp = 1.0 - smoothstep(dampTop - 0.5, dampTop, y);
    albedo *= 1.0 - 0.32 * damp * vertical;
    albedo = mix(albedo, cAlgae, (1.0 - smoothstep(0.4, 1.4, y)) * smoothstep(0.35, 0.65, vnoise(vec2(u * 1.6, y * 2.0))) * 0.55 * vertical);
    float bloom = (1.0 - smoothstep(0.0, 0.25, abs(y - dampTop + 0.15))) * smoothstep(0.45, 0.75, vnoise(vec2(u * 4.0, y * 6.0)));
    albedo = mix(albedo, cSaltB, bloom * 0.4 * vertical);
    float salt = smoothstep(0.7, 0.9, y) * (1.0 - smoothstep(1.1, 1.7, y)) * smoothstep(0.45, 0.7, vnoise(vec2(u * 2.0, y * 3.0)));
    albedo = mix(albedo, cSaltB, salt * 0.3);
    float up = smoothstep(0.6, 0.9, N.y) * smoothstep(0.4, 0.65, vnoise(vWorld.xz * 1.3));
    albedo = mix(albedo, cFrostB, up * 0.6);
  }

  vec3 ambient = mix(cGroundB, cSkyB, N.y * 0.5 + 0.5) * aoTex;
  float wrap = max((dot(N, uSunDir) + 0.3) / 1.3, 0.0);
  float rim = pow(max(1.0 - abs(dot(N, -V)), 0.0), 3.0) * pow(max(dot(V, uSunDir), 0.0), 3.0);
  vec3 col = albedo * (ambient + cSunB * wrap * 0.45) + cSunB * rim * 0.3;
  if (abs(k - 3.0) < 0.5) col = albedo * ambient * 0.35; // dark interiors
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

const PALETTES = {
  concrete: { wall: '#3a3652', wall2: '#2e2b45', mortar: '#4a4664', trim: '#46425f', tex: 'concrete_wall_008', size: 3.0 },
  brick: { wall: '#4a2f40', wall2: '#3a2536', mortar: '#6a6080', trim: '#5a5270', tex: 'mixed_brick_wall', size: 2.0 },
  stone: { wall: '#4a4660', wall2: '#3c3852', mortar: '#2a273d', trim: '#575270', tex: 'rustic_stone_wall', size: 2.6 },
}

export function buildingMaterial(style) {
  const p = PALETTES[style] || PALETTES.concrete
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: { STYLE: style === 'brick' ? 1 : style === 'stone' ? 2 : 0, TEX_SIZE: p.size.toFixed(1) },
    uniforms: {
      ...shared,
      ...surfaceUniforms(p.tex, 'tWall'),
      ...surfaceUniforms('damaged_plaster', 'tPlaster'),
      cWall: { value: color(p.wall) },
      cWall2: { value: color(p.wall2) },
      cMortar: { value: color(p.mortar) },
      cTrim: { value: color(p.trim) },
      cSlab: { value: color('#2f2c46') },
      cCore: { value: color('#07060e') },
      cRebar: { value: color('#3a2420') },
      cVine: { value: color('#2c4352') },
      cFrostB: { value: color('#8f88c4') },
      cWetB: { value: color('#141633') },
      cSaltB: { value: color('#b9b2d6') },
      cAlgae: { value: color('#1f3a44') },
      cSkyB: { value: color('#7d74c4') },
      cGroundB: { value: color('#1a1d4a') },
      cSunB: { value: color('#f5c8d0') },
    },
  })
}
