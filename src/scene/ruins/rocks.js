import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fogGLSL, noiseGLSL } from '../glsl'
import { color, shared } from '../world'
import { fbm3, ridged3 } from './noise3'

// A weathered rock: noise-displaced sphere with ridges, partial terracing (layered
// strata), a worn flatter top and a flat base that sits below the waterline.
export function rockGeometry(seed, { detail = 3, flatTop = 0.55, terrace = 0.35, rough = 1, cliff = 0.55, faceted = true, fine = 0 } = {}) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail))
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  const o = seed * 17.31
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const n = fbm3(v.x * 1.4 + o, v.y * 1.4 + o, v.z * 1.4 + o)
    const r = ridged3(v.x * 2.8 - o, v.y * 2.8 + o, v.z * 2.8)
    // Cliff walls: push the sides out toward a column so faces are near vertical.
    const xz = Math.hypot(v.x, v.z)
    if (xz > 1e-4) {
      const k = THREE.MathUtils.lerp(xz, 1, cliff) / xz
      v.x *= k
      v.z *= k
    }
    const f = fine ? (fbm3(v.x * 9 + o, v.y * 9, v.z * 9 - o, 3) - 0.5) * fine : 0
    v.multiplyScalar(1 + (n - 0.5) * 0.9 * rough + (r - 0.6) * 0.38 * rough + f)
    // Layered strata: pull heights toward crisp bands (ledges).
    const t = v.y * 6
    const banded = (Math.floor(t) + THREE.MathUtils.smoothstep(t - Math.floor(t), 0.4, 0.6)) / 6
    v.y = v.y * (1 - terrace) + banded * terrace
    if (v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.3 // worn top
    if (v.y < -0.25) v.y = -0.25 // flat base
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  if (!faceted) {
    g.computeVertexNormals()
    return g
  }
  // Faceted (flat-shaded) faces read as fractured stone at small scales.
  const flat = g.toNonIndexed()
  flat.computeVertexNormals()
  g.dispose()
  return flat
}

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 cRock, cRock2, cFrostR, cWet, cSalt, cFoamR, cSkyR, cGroundR, cSunR;
varying vec3 vWorld;
varying vec3 vNormalW;
${noiseGLSL}
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormalW + vec3(0.0, 1e-5, 0.0));
  float h = vWorld.y;
  float detail = 1.0 - smoothstep(60.0, 260.0, dist); // fine detail fades with distance

  // Strata: colour bands along height, wobbling slightly.
  float band = vnoise(vec2(h * 2.2, vWorld.x * 0.05 + vWorld.z * 0.05));
  vec3 albedo = mix(cRock, cRock2, smoothstep(0.35, 0.65, band));
  albedo *= 0.85 + 0.3 * vnoise(vWorld.xz * 0.35 + h * 0.2);

  // Cracks: thin dark creases.
  float cr = abs(vnoise(vWorld.xz * 0.9 + h * 0.45) * 2.0 - 1.0);
  albedo *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.07, cr)) * detail;

  // Frost and lichen on upward faces.
  float up = smoothstep(0.55, 0.85, N.y) * smoothstep(0.35, 0.6, vnoise(vWorld.xz * 1.7));
  albedo = mix(albedo, cFrostR, up * 0.65);

  // Waterline: dark wet band, then a faint salt crust above it.
  albedo = mix(albedo, cWet, 1.0 - smoothstep(0.05, 0.6, h));
  float salt = smoothstep(0.5, 0.8, h) * (1.0 - smoothstep(0.9, 1.6, h)) * smoothstep(0.5, 0.7, vnoise(vWorld.xz * 3.0 + h));
  albedo = mix(albedo, cSalt, salt * 0.35);

  // Lighting: twilight sky, wrapped low sun, rim when backlit.
  vec3 ambient = mix(cGroundR, cSkyR, N.y * 0.5 + 0.5);
  float wrap = max((dot(N, uSunDir) + 0.3) / 1.3, 0.0);
  float rim = pow(max(1.0 - abs(dot(N, -V)), 0.0), 3.0) * pow(max(dot(V, uSunDir), 0.0), 3.0);
  vec3 col = albedo * (ambient + cSunR * wrap * 0.5) + cSunR * rim * 0.35;

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
      cRock: { value: color('#2b2744') },
      cRock2: { value: color('#3d3758') },
      cFrostR: { value: color('#8f88c4') },
      cWet: { value: color('#141633') },
      cSalt: { value: color('#b9b2d6') },
      cFoamR: { value: color('#e4dcff') },
      cSkyR: { value: color('#7d74c4') },
      cGroundR: { value: color('#1a1d4a') },
      cSunR: { value: color('#f5c8d0') },
    },
  })
}
