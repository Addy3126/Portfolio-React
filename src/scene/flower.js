import * as THREE from 'three'

// A lily-like flower, 1 unit long petals, growing along +y.
// Attributes: position, normal, uv (x = across the petal 0..1, y = base->tip 0..1),
// part (0 = petal, 1 = stamen).
export function lilyGeometry({ petals = 5, width = 0.3, cup = 0.55, nv = 9, nu = 5 } = {}) {
  const positions = []
  const uvs = []
  const parts = []
  const index = []

  const pushVertex = (p, u, v, part) => {
    positions.push(p.x, p.y, p.z)
    uvs.push(u, v)
    parts.push(part)
    return positions.length / 3 - 1
  }

  for (let k = 0; k < petals; k++) {
    const theta = (k / petals) * Math.PI * 2 + (k % 2 ? 0.06 : -0.04)
    const rot = new THREE.Matrix4().makeRotationY(theta)
    const base = positions.length / 3
    // Walk along the petal's midline: steep at the base, curling outward at the tip.
    const c = new THREE.Vector3(0.045, 0.02, 0)
    const step = 1 / (nv - 1)
    for (let i = 0; i < nv; i++) {
      const v = i / (nv - 1)
      const elev = THREE.MathUtils.lerp(1.2, -0.45, Math.pow(v, 1.3))
      const tangent = new THREE.Vector3(Math.cos(elev), Math.sin(elev), 0)
      const up = new THREE.Vector3(-Math.sin(elev), Math.cos(elev), 0) // midline normal, pointing inward/up
      const halfW = width * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.62)), 0.85) + 0.006 * (1 - v)
      for (let j = 0; j < nu; j++) {
        const u = -1 + (2 * j) / (nu - 1)
        const p = c
          .clone()
          .add(new THREE.Vector3(0, 0, u * halfW))
          .addScaledVector(up, cup * u * u * halfW) // edges curl up into a trough
          .applyMatrix4(rot)
        pushVertex(p, (u + 1) / 2, v, 0)
      }
      if (i < nv - 1) c.addScaledVector(tangent, step * 0.95)
    }
    for (let i = 0; i < nv - 1; i++) {
      for (let j = 0; j < nu - 1; j++) {
        const a = base + i * nu + j
        const b = a + nu
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }

  // Stamens: thin filaments as crossed quads, glowing toward the tips.
  const stamens = 6
  for (let s = 0; s < stamens; s++) {
    const phi = (s / stamens) * Math.PI * 2 + 0.3
    const tip = new THREE.Vector3(Math.cos(phi) * 0.2, 0.42, Math.sin(phi) * 0.2)
    const root = new THREE.Vector3(0, 0.03, 0)
    const dir = tip.clone().sub(root).normalize()
    const sides = [new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi)), new THREE.Vector3().crossVectors(dir, new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi))).normalize()]
    for (const side of sides) {
      const w = 0.012
      const a = pushVertex(root.clone().addScaledVector(side, -w), 0, 0, 1)
      pushVertex(root.clone().addScaledVector(side, w), 1, 0, 1)
      pushVertex(tip.clone().addScaledVector(side, -w), 0, 1, 1)
      pushVertex(tip.clone().addScaledVector(side, w), 1, 1, 1)
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
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
uniform vec3 cPetal, cSheen, cVein, cBell, cSkyF, cGroundF, cSunF;
float fpow(float x, float e){ return pow(max(x, 0.0), e); }
vec3 shadeFlower(vec3 V, float dist){
  vec3 N = normalize(vNormalW) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 L = uSunDir;
  float across = abs(vUv.x - 0.5) * 2.0; // 0 on the midline, 1 at the edge
  float along = vUv.y;

  if (vPart > 0.5) {
    // Stamens: glow brightest at the tips.
    vec3 c = mix(cVein, vec3(1.0), 0.3);
    return c * (0.6 + 2.4 * smoothstep(0.6, 1.0, along)) * (0.4 + 0.6 * vGlow);
  }

  vec3 ambient = mix(cGroundF, cSkyF, N.y * 0.5 + 0.5);
  float wrap = max((dot(N, L) + 0.4) / 1.4, 0.0);
  vec3 H = normalize(L - V);
  float gloss = fpow(dot(N, H), 40.0);
  float rim = fpow(1.0 - abs(dot(N, -V)), 3.0);
  float through = fpow(dot(V, L), 4.0);

  if (vKind > 0.5) {
    // Small glowing blue bell: soft, self-lit, brighter toward the centre.
    vec3 c = cBell * (0.9 + 0.8 * (1.0 - along)) * (1.0 - 0.3 * across);
    c += cBell * ambient * 0.4 + vec3(1.0) * gloss * 0.25;
    return c;
  }

  // Dark glossy lily petal.
  vec3 albedo = cPetal * (1.15 - 0.4 * across) * (0.85 + 0.3 * along);
  vec3 col = albedo * (ambient * 0.6 + cSunF * wrap * 0.45);
  col += cSunF * gloss * 0.45;                                   // glossy highlight
  col += cSheen * rim * 0.45;                                    // violet edge sheen
  col += cSheen * through * (0.25 + 0.75 * across) * 0.5;        // light through thin edges
  // Glowing midline vein and a few faint side veins.
  float vein = exp(-across * across * 70.0) * (1.0 - smoothstep(0.55, 0.98, along));
  float side = exp(-pow(fract(across * 2.0 + along * 0.6) - 0.5, 2.0) * 120.0) * 0.18 * (1.0 - along);
  float heart = 1.0 - smoothstep(0.0, 0.22, along);
  col += cVein * (vein * 1.6 + side + heart * 1.3) * (0.35 + 0.65 * vGlow);
  return col;
}
`

export const flowerUniforms = (color) => ({
  cPetal: { value: color('#120f3c') },
  cSheen: { value: color('#7f6cf0') },
  cVein: { value: color('#a9c0ff') },
  cBell: { value: color('#5f8dff') },
  cSkyF: { value: color('#8e86d6') },
  cGroundF: { value: color('#1a1d4a') },
  cSunF: { value: color('#f5c8d0') },
})
