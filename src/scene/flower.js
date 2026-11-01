import * as THREE from 'three'

// Hybrid lily: a real lily's structure (6 tepals in two whorls, 6 stamens with anthers,
// a pistil with a 3-lobed stigma) drawn in the Blake Bloom style (pointed, twisted,
// splayed petals, silver centres fading to dark edges, glowing veins).
//
// Attributes: position, normal, uv (x across 0..1, y base->tip 0..1),
// part: 0 tepal, 1 filament, 2 anther, 3 pistil.
const PARTS = { tepal: 0, filament: 1, anther: 2, pistil: 3 }

// Deterministic per-petal jitter so every flower shares the same asymmetric shape.
const jitter = (k, salt) => {
  const v = Math.sin(k * 91.7 + salt * 13.1) * 43758.5453
  return v - Math.floor(v) - 0.5
}

export function lilyGeometry({ detail = 'full' } = {}) {
  const full = detail !== 'low' // 'full' and 'mid' keep stamens and pistil
  const nv = detail === 'full' ? 10 : detail === 'mid' ? 7 : 5
  const nu = detail === 'full' ? 5 : detail === 'mid' ? 4 : 3
  const positions = []
  const uvs = []
  const parts = []
  const index = []
  const push = (p, u, v, part) => {
    positions.push(p.x, p.y, p.z)
    uvs.push(u, v)
    parts.push(part)
    return positions.length / 3 - 1
  }

  for (let k = 0; k < 6; k++) {
    const inner = k % 2 === 0
    const width = (inner ? 0.3 : 0.22) * (1 + jitter(k, 1) * 0.12)
    const length = (inner ? 1.0 : 1.08) * (1 + jitter(k, 2) * 0.1)
    const elev0 = inner ? 1.22 : 1.05
    const elev1 = inner ? -0.35 : -0.62 // outer tepals curl back further
    const twist = (inner ? 0.28 : -0.34) * (1 + jitter(k, 3) * 0.4)
    const theta = (k / 6) * Math.PI * 2 + jitter(k, 4) * 0.16
    const rot = new THREE.Matrix4().makeRotationY(theta)
    const lift = inner ? 0.012 : 0 // inner whorl sits just above the outer one
    const base = positions.length / 3
    const c = new THREE.Vector3(0.04, 0.02 + lift, 0)
    const step = length / (nv - 1)
    for (let i = 0; i < nv; i++) {
      const v = i / (nv - 1)
      const elev = THREE.MathUtils.lerp(elev0, elev1, Math.pow(v, 1.35))
      const tangent = new THREE.Vector3(Math.cos(elev), Math.sin(elev), 0)
      let side = new THREE.Vector3(0, 0, 1)
      let up = new THREE.Vector3(-Math.sin(elev), Math.cos(elev), 0)
      // Twist the cross-section about the midline as the tepal grows.
      const tw = twist * v
      const s2 = side.clone().multiplyScalar(Math.cos(tw)).addScaledVector(up, Math.sin(tw))
      up = up.clone().multiplyScalar(Math.cos(tw)).addScaledVector(side, -Math.sin(tw))
      side = s2
      // Lanceolate outline: narrow base, widest a third of the way out, sharp tip.
      const halfW = width * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.6)), 0.9) * (1 - 0.2 * v) + 0.006 * (1 - v)
      for (let j = 0; j < nu; j++) {
        const u = -1 + (2 * j) / (nu - 1)
        const wave = full ? 0.018 * Math.sin(v * 17 + k) * Math.pow(Math.abs(u), 3) : 0
        const p = c
          .clone()
          .addScaledVector(side, u * halfW)
          .addScaledVector(up, 0.5 * u * u * halfW + wave) // trough with a raised rim
          .applyMatrix4(rot)
        push(p, (u + 1) / 2, v, PARTS.tepal)
      }
      if (i < nv - 1) c.addScaledVector(tangent, step)
    }
    for (let i = 0; i < nv - 1; i++)
      for (let j = 0; j < nu - 1; j++) {
        const a = base + i * nu + j
        const b = a + nu
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
  }

  // Crossed-quad strip along a polyline (filaments, pistil).
  const strand = (points, w, part) => {
    for (let s = 0; s < 2; s++) {
      const base = positions.length / 3
      points.forEach((p, i) => {
        const next = points[Math.min(i + 1, points.length - 1)]
        const prev = points[Math.max(i - 1, 0)]
        const dir = next.clone().sub(prev).normalize()
        let side = new THREE.Vector3(0, 1, 0).cross(dir)
        if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0)
        side.normalize()
        if (s === 1) side = dir.clone().cross(side).normalize()
        const v = i / (points.length - 1)
        push(p.clone().addScaledVector(side, -w), 0, v, part)
        push(p.clone().addScaledVector(side, w), 1, v, part)
      })
      for (let i = 0; i < points.length - 1; i++) {
        const a = base + i * 2
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
  }

  // Six stamens arching outward, each with an anther across its tip.
  for (let s = 0; s < 6; s++) {
    const phi = (s / 6) * Math.PI * 2 + 0.5
    const dir = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi))
    const pts = [0, 0.33, 0.66, 1].map((t) =>
      new THREE.Vector3(0, 0.03 + t * 0.48, 0).addScaledVector(dir, 0.04 + t * 0.22 + t * t * 0.06),
    )
    strand(full ? pts : [pts[0], pts[3]], 0.007, PARTS.filament)
    if (full) {
      const tip = pts[3]
      const anther = new THREE.BoxGeometry(0.075, 0.022, 0.026)
      anther.rotateY(-phi + Math.PI / 2)
      anther.translate(tip.x, tip.y + 0.01, tip.z)
      const ap = anther.attributes.position
      const base = positions.length / 3
      for (let i = 0; i < ap.count; i++) push(new THREE.Vector3(ap.getX(i), ap.getY(i), ap.getZ(i)), 0.5, i / ap.count, PARTS.anther)
      for (const i of anther.index.array) index.push(base + i)
    }
  }

  // Pistil: a slightly curved style with a three-lobed stigma.
  if (full) {
    strand([0, 0.4, 0.75, 1].map((t) => new THREE.Vector3(0.02 * t, 0.02 + t * 0.56, 0.01 * t)), 0.011, PARTS.pistil)
    for (let l = 0; l < 3; l++) {
      const a = (l / 3) * Math.PI * 2
      const lobe = detail === 'full' ? new THREE.SphereGeometry(0.018, 8, 6) : new THREE.SphereGeometry(0.018, 5, 3)
      lobe.translate(0.02 + Math.cos(a) * 0.016, 0.585, 0.01 + Math.sin(a) * 0.016)
      const lp = lobe.attributes.position
      const base = positions.length / 3
      for (let i = 0; i < lp.count; i++) push(new THREE.Vector3(lp.getX(i), lp.getY(i), lp.getZ(i)), 0.5, 1, PARTS.pistil)
      for (const i of lobe.index.array) index.push(base + i)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('part', new THREE.Float32BufferAttribute(parts, 1))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

// Wrap a plain geometry for instancing (shares its buffers).
export function toInstanced(base) {
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr)
  return g
}

// Fragment shading shared by floating and planted flowers.
// Expects: vUv, vPart, vNormalW, vWorld, vKind (0 dark lily, 1 glowing bell), vGlow (0..1).
export const flowerShadeGLSL = /* glsl */ `
uniform vec3 cPetal, cSilver, cSheen, cVein, cBell, cSkyF, cGroundF, cSunF, cStem;
float fpow(float x, float e){ return pow(max(x, 0.0), e); }
float fhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 shadeFlower(vec3 V, float dist){
  vec3 N = normalize(vNormalW + vec3(0.0, 1e-5, 0.0)) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 L = uSunDir;
  float across = abs(vUv.x - 0.5) * 2.0; // 0 on the midline, 1 at the edge
  float along = vUv.y;
  float glow = 0.35 + 0.65 * vGlow;
  vec3 ambient = mix(cGroundF, cSkyF, N.y * 0.5 + 0.5);
  vec3 H = normalize(L - V);

  if (vPart > 2.5) {
    // Pistil: dark style, softly glowing stigma.
    return cStem * ambient * 1.5 + cVein * smoothstep(0.8, 1.0, along) * 1.8 * glow;
  }
  if (vPart > 1.5) {
    // Anthers: small glowing pollen heads.
    return mix(cVein, vec3(1.0), 0.35) * 2.2 * glow + ambient * 0.2;
  }
  if (vPart > 0.5) {
    // Filaments: dark, catching a little light toward the tip.
    return cStem * ambient * 1.4 + cVein * smoothstep(0.7, 1.0, along) * 0.6 * glow;
  }

  float wrap = max((dot(N, L) + 0.4) / 1.4, 0.0);
  float rim = fpow(1.0 - abs(dot(N, -V)), 3.0);
  float through = fpow(dot(V, L), 4.0);

  if (vKind > 0.5) {
    // Small glowing blue bell: soft, self-lit, brighter toward the centre.
    vec3 c = cBell * (0.9 + 0.8 * (1.0 - along)) * (1.0 - 0.3 * across);
    c += cBell * ambient * 0.4 + vec3(1.0) * fpow(dot(N, H), 40.0) * 0.25;
    return c;
  }

  // Tepal colour: silver at the heart and along the midline, dark indigo at edges and tips.
  float silver = (1.0 - smoothstep(0.15, 0.7, along)) * (1.0 - smoothstep(0.35, 0.95, across));
  silver = max(silver, exp(-across * across * 30.0) * (1.0 - smoothstep(0.3, 0.9, along)) * 0.6);
  vec3 albedo = mix(cPetal * (1.1 - 0.35 * across), cSilver, silver * 0.85);

  // Freckles near the throat, as on real lilies.
  vec2 g = vec2(across * 7.0, along * 16.0);
  float r = fhash(floor(g));
  float d = length(fract(g) - 0.5 - (r - 0.5) * 0.3);
  float freckle = step(0.7, r) * (1.0 - smoothstep(0.07, 0.16, d)) * step(0.08, along) * (1.0 - step(0.42, along)) * (1.0 - step(0.75, across));
  albedo *= 1.0 - 0.55 * freckle;

  vec3 col = albedo * (ambient * 0.65 + cSunF * wrap * 0.45);
  col += cSunF * fpow(dot(N, H), 90.0) * 1.1;                           // sharp starry glint
  col += cSkyF * fpow(dot(reflect(V, N), vec3(0.0, 1.0, 0.0)), 10.0) * 0.18; // soft sky sheen
  col += cSheen * rim * 0.4;                                            // violet edge sheen
  col += cSheen * through * (0.25 + 0.75 * across) * 0.5;               // light through thin edges

  // Glowing silver midrib, faint diagonal side veins, bright heart.
  float vein = exp(-across * across * 90.0) * (1.0 - smoothstep(0.6, 0.98, along));
  float side = exp(-pow(fract(across * 2.5 - along * 1.2) - 0.5, 2.0) * 140.0) * 0.16 * (1.0 - along) * (1.0 - across);
  float heart = 1.0 - smoothstep(0.0, 0.2, along);
  col += cVein * (vein * 1.5 + side + heart * 1.1) * glow;
  return col;
}
`

export const flowerUniforms = (color) => ({
  cPetal: { value: color('#120f3c') },
  cSilver: { value: color('#c9c6ea') },
  cSheen: { value: color('#7f6cf0') },
  cVein: { value: color('#dfe6ff') },
  cBell: { value: color('#5f8dff') },
  cSkyF: { value: color('#8e86d6') },
  cGroundF: { value: color('#1a1d4a') },
  cSunF: { value: color('#f5c8d0') },
  cStem: { value: color('#1c1a3a') },
})
