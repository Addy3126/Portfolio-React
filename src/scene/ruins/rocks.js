import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fogGLSL, noise3GLSL, noiseGLSL } from '../glsl'
import { color, shared } from '../world'
import { fbm3, hash3, ridged3 } from './noise3'

// A weathered rock, modelled the way real broken rock looks:
// - a domain-warped noise mass (not a sphere with bumps)
// - a few planar fracture cuts, giving flat broken faces with crisp edges
// - optional strata ledges, a worn top and a flat base below the waterline
// - smooth normals; fine grain and pits come from the shader, not from facets
// Each vertex also stores its curvature (aCurv: + crevice, - edge) for the shader.

// Remove the flat underside (all three vertices on the clamped base): never visible.
function dropBase(g) {
  const pos = g.attributes.position
  const idx = g.index.array
  const keep = []
  for (let i = 0; i < idx.length; i += 3) {
    if (pos.getY(idx[i]) <= -0.249 && pos.getY(idx[i + 1]) <= -0.249 && pos.getY(idx[i + 2]) <= -0.249) continue
    keep.push(idx[i], idx[i + 1], idx[i + 2])
  }
  g.setIndex(keep)
}

// Curvature per vertex: how far the average of its neighbours sits along its normal.
function curvature(g) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const idx = g.index.array
  const sum = new Float32Array(pos.count * 3)
  const cnt = new Float32Array(pos.count)
  for (let i = 0; i < idx.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[i + k]
      for (let j = 1; j < 3; j++) {
        const b = idx[i + ((k + j) % 3)]
        sum[a * 3] += pos.getX(b)
        sum[a * 3 + 1] += pos.getY(b)
        sum[a * 3 + 2] += pos.getZ(b)
        cnt[a]++
      }
    }
  }
  const curv = new Float32Array(pos.count)
  let scale = 0
  for (let i = 0; i < pos.count; i++) {
    if (!cnt[i]) continue
    const dx = sum[i * 3] / cnt[i] - pos.getX(i)
    const dy = sum[i * 3 + 1] / cnt[i] - pos.getY(i)
    const dz = sum[i * 3 + 2] / cnt[i] - pos.getZ(i)
    curv[i] = dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i)
    scale = Math.max(scale, Math.abs(curv[i]))
  }
  for (let i = 0; i < curv.length; i++) curv[i] = Math.max(-1, Math.min(1, (curv[i] / (scale || 1)) * 2.5))
  g.setAttribute('aCurv', new THREE.BufferAttribute(curv, 1))
}

export function rockGeometry(
  seed,
  { detail = 3, flatTop = 0.55, terrace = 0.35, rough = 1, cliff = 0.55, faceted = false, fine = 0, cuts = 5 } = {},
) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail))
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  const o = seed * 17.31
  // Fracture planes: random directions, cutting off 8-30% of the mass.
  const planes = Array.from({ length: cuts }, (_, i) => {
    const th = hash3(seed, i, 1) * Math.PI * 2
    const ph = (hash3(seed, i, 2) - 0.35) * 1.6
    return { n: new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)), d: 0.62 + hash3(seed, i, 3) * 0.3 }
  })
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    // Domain warp, then large and ridged noise for an irregular mass.
    const wx = v.x + (fbm3(v.x * 1.1 + o, v.y * 1.1, v.z * 1.1, 3) - 0.5) * 0.8
    const wy = v.y + (fbm3(v.x * 1.1, v.y * 1.1 + o, v.z * 1.1, 3) - 0.5) * 0.8
    const wz = v.z + (fbm3(v.x * 1.1, v.y * 1.1, v.z * 1.1 + o, 3) - 0.5) * 0.8
    const n = fbm3(wx * 1.3 + o, wy * 1.3 + o, wz * 1.3 + o)
    const r = ridged3(wx * 2.6 - o, wy * 2.6 + o, wz * 2.6)
    const xz = Math.hypot(v.x, v.z)
    if (xz > 1e-4) {
      const k = THREE.MathUtils.lerp(xz, 1, cliff) / xz
      v.x *= k
      v.z *= k
    }
    const f = fine ? (fbm3(v.x * 9 + o, v.y * 9, v.z * 9 - o, 3) - 0.5) * fine : 0
    v.multiplyScalar(1 + (n - 0.5) * 0.85 * rough + (r - 0.6) * 0.3 * rough + f)
    // Fracture faces: pull everything beyond each plane back onto it (slightly rough).
    for (const p of planes) {
      const dd = v.dot(p.n) - p.d
      if (dd > 0) v.addScaledVector(p.n, -dd * 0.92)
    }
    if (terrace > 0) {
      const t = v.y * 6
      const banded = (Math.floor(t) + THREE.MathUtils.smoothstep(t - Math.floor(t), 0.4, 0.6)) / 6
      v.y = v.y * (1 - terrace) + banded * terrace
    }
    if (v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.3 // worn top
    if (v.y < -0.25) v.y = -0.25 // flat base
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  dropBase(g)
  g.computeVertexNormals()
  curvature(g)
  if (!faceted) return g
  const flat = g.toNonIndexed()
  flat.computeVertexNormals()
  g.dispose()
  return flat
}

const vertex = /* glsl */ `
attribute float aCurv;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vCurv;
void main(){
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(m) * normal);
  vCurv = aCurv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 cRock, cRock2, cRockWarm, cFrostR, cLichen, cWet, cSalt, cFoamR, cSkyR, cGroundR, cSunR;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vCurv;
${noiseGLSL}
${noise3GLSL}
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormalW + vec3(0.0, 1e-5, 0.0));
  float h = vWorld.y;
  float detail = 1.0 - smoothstep(40.0, 220.0, dist);

  // Surface relief: bump the normal with 3D noise (no stretching on steep faces).
  vec3 P = vWorld * 1.6;
  if (detail > 0.01) {
    float e = 0.12;
    float f0 = fbm3g(P);
    vec3 grad = vec3(fbm3g(P + vec3(e, 0.0, 0.0)) - f0, fbm3g(P + vec3(0.0, e, 0.0)) - f0, fbm3g(P + vec3(0.0, 0.0, e)) - f0) / e;
    grad += (vec3(vnoise3(P * 6.0 + 1.0), vnoise3(P * 6.0 + 5.0), vnoise3(P * 6.0 + 9.0)) - 0.5) * 1.2; // fine grain
    N = normalize(N - (grad - N * dot(grad, N)) * 0.22 * detail);
  }
  // Medium-scale relief (bulges, hollows, ledges) that still reads at a distance.
  {
    vec3 Q = vWorld * 0.22;
    float e = 0.15;
    float g0 = fbm3g(Q);
    vec3 grad = vec3(fbm3g(Q + vec3(e, 0.0, 0.0)) - g0, fbm3g(Q + vec3(0.0, e, 0.0)) - g0, fbm3g(Q + vec3(0.0, 0.0, e)) - g0) / e;
    grad.y *= 1.6; // favour horizontal ledges, like bedding planes
    N = normalize(N - (grad - N * dot(grad, N)) * 0.32);
  }

  // Base colour: cool grey stone with large warm/cool variation and strata bands.
  float big = fbm3g(vWorld * 0.06);
  vec3 albedo = mix(cRock, cRock2, smoothstep(0.3, 0.7, big));
  albedo = mix(albedo, cRockWarm, smoothstep(0.55, 0.8, fbm3g(vWorld * 0.13 + 7.0)) * 0.5);
  float band = vnoise(vec2(h * 1.8, (vWorld.x + vWorld.z) * 0.04));
  albedo *= 0.88 + 0.24 * band;
  // Grain: mineral speckle like granite.
  float speck = vnoise3(vWorld * 9.0);
  albedo *= 0.86 + 0.28 * smoothstep(0.2, 0.8, speck) * detail + (1.0 - detail) * 0.14;

  // Thin dark cracks (joints), more visible than grain at a distance.
  float j = abs(vnoise3(vWorld * vec3(0.35, 0.9, 0.35)) - 0.5);
  albedo *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.025, j)) * (1.0 - smoothstep(150.0, 400.0, dist));

  // Shape-aware weathering: crevices darker (dirt, occlusion), edges worn lighter.
  albedo *= 1.0 - 0.5 * smoothstep(0.05, 0.8, vCurv);
  albedo = mix(albedo, albedo * 1.35 + 0.02, smoothstep(0.1, 0.8, -vCurv) * 0.6);

  // Lichen: blotchy cool patches on upward-ish faces; frost on flat tops.
  float lichenMask = smoothstep(0.62, 0.72, fbm3g(vWorld * 0.45 + 3.0)) * smoothstep(-0.1, 0.5, N.y);
  albedo = mix(albedo, cLichen * (0.8 + 0.4 * vnoise3(vWorld * 5.0)), lichenMask * 0.7);
  float up = smoothstep(0.6, 0.9, N.y) * smoothstep(0.4, 0.7, fbm3g(vWorld * 0.3));
  albedo = mix(albedo, cFrostR, up * 0.5);

  // Waterline: dark wet band with algae, then a faint salt crust above it.
  float wet = 1.0 - smoothstep(0.05, 0.7, h);
  albedo = mix(albedo, cWet, wet * 0.9);
  float salt = smoothstep(0.5, 0.8, h) * (1.0 - smoothstep(0.9, 1.6, h)) * smoothstep(0.5, 0.7, vnoise(vWorld.xz * 3.0 + h));
  albedo = mix(albedo, cSalt, salt * 0.3);

  // Lighting: twilight sky, wrapped low sun, rim when backlit, a wet sheen near the water.
  float ao = 1.0 - 0.45 * smoothstep(0.0, 0.9, vCurv);
  vec3 ambient = mix(cGroundR, cSkyR, N.y * 0.5 + 0.5) * ao;
  float wrap = max((dot(N, uSunDir) + 0.25) / 1.25, 0.0);
  float rim = pow(max(1.0 - abs(dot(N, -V)), 0.0), 3.0) * pow(max(dot(V, uSunDir), 0.0), 3.0);
  vec3 H = normalize(uSunDir - V);
  float sheen = pow(max(dot(N, H), 0.0), 40.0) * (0.08 + 0.6 * wet);
  vec3 col = albedo * (ambient + cSunR * wrap * 0.55) + cSunR * (rim * 0.3 + sheen);

  // Foam lapping where the rock meets the water.
  float t = uTime * uMotion;
  float line = -0.04 + 0.035 * sin(t * 1.2 + vWorld.x * 0.7 + vWorld.z * 0.5);
  float foam = (1.0 - smoothstep(0.0, 0.07, abs(h - line))) * smoothstep(0.4, 0.7, vnoise(vWorld.xz * 6.0 + t * 0.3)) * (1.0 - smoothstep(0.6, 0.9, abs(N.y)));
  col = mix(col, cFoamR, foam * 0.7);

  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export function rockMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      ...shared,
      cRock: { value: color('#2f2c48') },
      cRock2: { value: color('#45415f') },
      cRockWarm: { value: color('#4a3a52') },
      cFrostR: { value: color('#9a93cc') },
      cLichen: { value: color('#5b6a82') },
      cWet: { value: color('#141633') },
      cSalt: { value: color('#b9b2d6') },
      cFoamR: { value: color('#e4dcff') },
      cSkyR: { value: color('#7d74c4') },
      cGroundR: { value: color('#1a1d4a') },
      cSunR: { value: color('#f5c8d0') },
    },
  })
}
