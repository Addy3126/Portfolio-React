import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from '../glsl'
import { color, shared } from '../world'

// Part kinds, stored per vertex so one material can shade a whole building.
export const KIND = { wall: 0, slab: 1, column: 2, core: 3, rebar: 4, vine: 5, trim: 6 }

const STYLES = {
  concrete: { floor: 3.0, winH: 0.5, sills: false, lintel: false },
  brick: { floor: 3.3, winH: 0.55, sills: true, lintel: false },
  stone: { floor: 3.6, winH: 0.5, sills: true, lintel: true },
}

// Builds one building as a single merged geometry (position, normal, aKind) plus the
// centres of its front-facing windows (for the lit project towers).
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
        if (f > 0 && rand() < 0.035) continue // a missing panel, open to the interior
        faceBox(side, u0 - cw / 2 + pw / 2, y0 + fh / 2, pw, fh, t, t / 2, KIND.wall)
        faceBox(side, u0 + cw / 2 - pw / 2, y0 + fh / 2, pw, fh, t, t / 2, KIND.wall)
        faceBox(side, u0, y0 + fh * 0.15, ww, fh * 0.3, t, t / 2, KIND.wall)
        const above = fh - fh * 0.3 - wh
        faceBox(side, u0, sill + wh + above / 2, ww, above, t, t / 2, KIND.wall)
        if (st.sills) faceBox(side, u0, sill - 0.04, ww + 0.2, 0.1, t + 0.16, t / 2 - 0.06, KIND.trim)
        if (st.lintel) faceBox(side, u0, sill + wh + 0.12, ww + 0.3, 0.24, t + 0.1, t / 2 - 0.04, KIND.trim)
        if (side.front) {
          const [x, z] = side.place(u0, t + 0.04)
          windows.push({ x, y: sill + wh / 2, z, w: ww * 0.94, h: wh * 0.94 })
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
  for (let f = 1; f <= minTop + 1; f++) box(0, f * fh - 0.15, 0, w + 0.2, 0.3, d + 0.2, KIND.slab)
  const coreH = (minTop + 1) * fh
  box(0, coreH / 2, 0, w - 2 * t - 0.3, coreH, d - 2 * t - 0.3, KIND.core)
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box((cx * w) / 2, coreH / 2, (cz * d) / 2, 0.5, coreH, 0.5, KIND.column)

  // Intact buildings keep a cornice and parapet.
  if (!spec.broken && minTop === n - 1) {
    box(0, n * fh + 0.2, 0, w + 0.6, 0.45, d + 0.6, KIND.trim)
    box(0, n * fh + 0.75, 0, w + 0.1, 0.7, d + 0.1, KIND.wall)
  }

  // Vines trailing down the walls and over ledges.
  const vines = 5 + Math.floor(rand() * 5)
  for (let v = 0; v < vines; v++) {
    const si = Math.floor(rand() * 4)
    const side = sides[si]
    const cols = tops[si].length
    const c = Math.floor(rand() * cols)
    const yStart = (tops[si][c] + 1) * fh - 0.2
    const len = Math.min(yStart - 0.5, 4 + rand() * 8)
    if (len < 1.5) continue
    const u = -side.len / 2 + (c + 0.15 + rand() * 0.7) * (side.len / cols)
    const segs = 6
    let drift = 0
    for (let sgm = 0; sgm < segs; sgm++) {
      const segLen = len / segs
      const yc = yStart - segLen * (sgm + 0.5)
      drift += (rand() - 0.5) * 0.35
      const taper = 1 - (sgm / segs) * 0.5
      faceBox(side, u + drift, yc, (0.25 + rand() * 0.2) * taper, segLen * 1.05, 0.06, -0.05, KIND.vine)
      for (let l = 0; l < 2; l++)
        faceBox(side, u + drift + (rand() - 0.5) * 0.9 * taper, yc + (rand() - 0.5) * segLen, (0.6 + rand() * 0.5) * taper, 0.4 + rand() * 0.35, 0.1, -0.09, KIND.vine, (rand() - 0.5) * 0.9)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1))
  g.computeBoundingSphere()
  return { geometry: g, windows, height: n * fh }
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

  vec3 albedo = cWall;
  if (k < 0.5 || abs(k - 2.0) < 0.5) {
    albedo = mix(cWall, cWall2, vnoise(vec2(u * 0.35, y * 0.25)));
    #if STYLE == 1
      // Brick courses with staggered joints.
      float row = floor(y / 0.22);
      float bu = fract((u + mod(row, 2.0) * 0.25) / 0.5);
      float bv = fract(y / 0.22);
      float joint = max(1.0 - smoothstep(0.0, 0.07, bu), 1.0 - smoothstep(0.0, 0.12, bv));
      albedo *= 0.85 + 0.3 * hash12(vec2(floor((u + mod(row, 2.0) * 0.25) / 0.5), row));
      albedo = mix(albedo, cMortar, joint * detail * 0.8);
    #elif STYLE == 2
      // Dressed stone blocks.
      float row = floor(y / 0.45);
      float bu = fract((u + mod(row, 2.0) * 0.45) / 0.9);
      float bv = fract(y / 0.45);
      float joint = max(1.0 - smoothstep(0.0, 0.035, bu), 1.0 - smoothstep(0.0, 0.07, bv));
      albedo *= 0.88 + 0.24 * hash12(vec2(floor((u + mod(row, 2.0) * 0.45) / 0.9), row));
      albedo = mix(albedo, cMortar, joint * detail * 0.7);
    #else
      // Cast concrete panels with thin seams.
      float seam = min(min(fract(u / 1.5), 1.0 - fract(u / 1.5)), min(fract(y / 3.0), 1.0 - fract(y / 3.0)));
      albedo *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.025, seam)) * detail;
    #endif
    if (abs(k - 2.0) < 0.5) albedo *= 0.9;
  }
  if (abs(k - 1.0) < 0.5) albedo = cSlab;
  if (abs(k - 3.0) < 0.5) albedo = cCore;
  if (abs(k - 4.0) < 0.5) albedo = cRebar;
  if (abs(k - 5.0) < 0.5) albedo = cVine * (0.7 + 0.6 * vnoise(vWorld.xy * 3.0 + vWorld.z));
  if (abs(k - 6.0) < 0.5) albedo = cTrim;

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

  vec3 ambient = mix(cGroundB, cSkyB, N.y * 0.5 + 0.5);
  float wrap = max((dot(N, uSunDir) + 0.3) / 1.3, 0.0);
  float rim = pow(max(1.0 - abs(dot(N, -V)), 0.0), 3.0) * pow(max(dot(V, uSunDir), 0.0), 3.0);
  vec3 col = albedo * (ambient + cSunB * wrap * 0.45) + cSunB * rim * 0.3;
  if (abs(k - 3.0) < 0.5) col = albedo * ambient * 0.35; // dark interiors
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

const PALETTES = {
  concrete: { wall: '#3a3652', wall2: '#2e2b45', mortar: '#4a4664', trim: '#46425f' },
  brick: { wall: '#4a2f40', wall2: '#3a2536', mortar: '#6a6080', trim: '#5a5270' },
  stone: { wall: '#4a4660', wall2: '#3c3852', mortar: '#2a273d', trim: '#575270' },
}

export function buildingMaterial(style) {
  const p = PALETTES[style] || PALETTES.concrete
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: { STYLE: style === 'brick' ? 1 : style === 'stone' ? 2 : 0 },
    uniforms: {
      ...shared,
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
