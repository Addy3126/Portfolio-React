import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fogGLSL, noise3GLSL, noiseGLSL, shoreGLSL, swashGLSL } from '../glsl'
import { surfaceUniforms, triplanarGLSL } from '../surfaces'
import { color, shared } from '../world'
import { fbm3, hash3 } from './noise3'

// Beach stones seen up close: pebbles and cobbles, not cliff rock.
// - Shapes: water-worn pebbles are smooth, flattened ellipsoids; cobbles keep a couple of
//   softened break faces. Both have smooth normals (no facets).
// - Shading works in each stone's own space, scaled to its real size, so a 10 cm pebble
//   gets millimetre grain and a 60 cm cobble gets centimetre mottling. Each octave fades
//   out once it would be smaller than a pixel, so nothing shimmers at a distance.
// - Every stone picks a rock type (granite, basalt, quartzite, banded sandstone) and tint
//   from a hash of its position, so neighbours differ.
// - Wetness comes from the shared swash model: stones the waves reach turn dark, saturated
//   and glossy; dry stones get a dusting of sand around their base.

export function pebbleGeometry(seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4))
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  const o = seed * 13.7
  const flat = 0.5 + hash3(seed, 1, 1) * 0.25 // how flat the stone is
  const chips = [0, 1].map((i) => {
    const th = hash3(seed, i, 8) * Math.PI * 2
    const ph = (hash3(seed, i, 9) - 0.3) * 1.0
    return { n: new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)), d: 0.72 + hash3(seed, i, 10) * 0.15 }
  })
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    // Lumpy, uneven mass with small bumps on top.
    const n = fbm3(v.x * 1.3 + o, v.y * 1.3, v.z * 1.3 - o, 4) - 0.5
    const b = fbm3(v.x * 5.5 - o, v.y * 5.5 + o, v.z * 5.5, 3) - 0.5
    v.multiplyScalar(1 + n * 0.5 + b * 0.12)
    for (const c of chips) {
      const dd = v.dot(c.n) - c.d
      if (dd > -0.04) v.addScaledVector(c.n, -Math.max(0, dd + 0.04) * 0.85)
    }
    v.y *= flat
    // Slightly flatter underside (it settled on that face).
    if (v.y < -flat * 0.55) v.y = -flat * 0.55 + (v.y + flat * 0.55) * 0.35
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

export function cobbleGeometry(seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4))
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  const o = seed * 7.9
  const planes = [0, 1, 2, 3, 4].map((i) => {
    const th = hash3(seed, i, 4) * Math.PI * 2
    const ph = (hash3(seed, i, 5) - 0.2) * 1.2
    return { n: new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)), d: 0.6 + hash3(seed, i, 6) * 0.25 }
  })
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const n = fbm3(v.x * 1.5 + o, v.y * 1.5 + o, v.z * 1.5, 4) - 0.5
    const b = fbm3(v.x * 6.0 - o, v.y * 6.0, v.z * 6.0 + o, 3) - 0.5
    v.multiplyScalar(1 + n * 0.55 + b * 0.14)
    // Soft break faces: pull back past each plane, with a rounded transition.
    for (const p of planes) {
      const dd = v.dot(p.n) - p.d
      if (dd > -0.03) v.addScaledVector(p.n, -Math.max(0, dd + 0.03) * 0.9) // sharper break edges
    }
    v.y *= 0.7
    if (v.y < -0.42) v.y = -0.42 + (v.y + 0.42) * 0.3
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vObj;    // position in the stone's space, in metres
varying vec3 vObjN;   // normal in the stone's space
varying float vSeed;
varying float vSize;
varying float vLocalY;
void main(){
  mat4 m = modelMatrix * instanceMatrix;
  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(m) * normal);
  vObj = position * sc;
  vObjN = normal;
  vec3 tr = instanceMatrix[3].xyz;
  vSeed = fract(sin(dot(tr, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vSize = (sc.x + sc.y + sc.z) / 3.0;
  vLocalY = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform sampler2D tStoneS, tStoneN;
uniform vec3 cGranite, cBasalt, cQuartz, cSandst, cSandDust, cSkyS, cGroundS, cSunS, cFoamS, cSkyRefl;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vObjN;
varying float vSeed;
varying float vSize;
varying float vLocalY;
${noiseGLSL}
${noise3GLSL}
${fogGLSL}
${shoreGLSL}
${swashGLSL}
${triplanarGLSL}

// An octave of feature size s (metres) stays visible until it shrinks below ~1.5 px.
float vis(float s, float dist){ return 1.0 - smoothstep(0.6, 1.0, dist / (s * 420.0)); }

void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 N = normalize(vNormalW + vec3(0.0, 1e-5, 0.0));
  vec3 P = vObj + vSeed * 31.0; // per-stone offset so patterns differ

  // Rock type per stone.
  float k = vSeed;
  vec3 base; float grain; float veins; float bands;
  if (k < 0.34)      { base = cGranite; grain = 1.0; veins = 0.15; bands = 0.0; }
  else if (k < 0.62) { base = cBasalt;  grain = 0.35; veins = 0.35; bands = 0.0; }
  else if (k < 0.82) { base = cQuartz;  grain = 0.25; veins = 0.6; bands = 0.0; }
  else               { base = cSandst;  grain = 0.5; veins = 0.0; bands = 1.0; }
  base *= 0.62 + 0.8 * fract(vSeed * 7.31); // tone varies a lot stone to stone

  // Mottling (~2 cm), grain (~4 mm and ~1.5 mm), weighted by visibility.
  float vM = vis(0.02, dist), vG = vis(0.008, dist), vF = vis(0.003, dist);
  // Large blotches (~5 cm) and mottling (~2 cm).
  float blot = fbm3g(P * 14.0);
  float mott = fbm3g(P * 45.0);
  vec3 albedo = base * (0.7 + 0.6 * blot) * (0.8 + 0.4 * mott * vM + 0.2 * (1.0 - vM));
  // Crystals (~8 mm) for granite: light feldspar and dark mica.
  float g1 = vnoise3(P * 130.0);
  float g2 = vnoise3(P * 330.0 + 3.0);
  float speck = smoothstep(0.62, 0.8, g1) * vG + smoothstep(0.7, 0.85, g2) * vF;
  float darkSpeck = (1.0 - smoothstep(0.18, 0.32, g1)) * vG;
  albedo = mix(albedo, albedo * 1.8 + 0.05, speck * 0.75 * grain);
  albedo *= 1.0 - 0.6 * darkSpeck * grain;

  // Quartz veins: thin pale lines winding through the stone.
  float vn = abs(vnoise3(P * vec3(18.0, 30.0, 18.0) + vec3(5.0)) - 0.5);
  float vein = (1.0 - smoothstep(0.0, 0.045, vn)) * veins * vis(0.01, dist);
  albedo = mix(albedo, cQuartz * 1.6, vein * 0.85);

  // Sandstone bands along the stone's own layering.
  float bandv = sin(vObj.y * 90.0 + vnoise3(P * 20.0) * 4.0) * 0.5 + 0.5;
  albedo *= 1.0 - bands * 0.3 * bandv * vis(0.012, dist);

  // Scanned rock surface in the stone's own space (it sticks to the stone): normals,
  // grain, and pits from the scan's cavities, fading as they shrink below a pixel.
  vec3 sInfo;
  N = triplanar(tStoneS, tStoneN, P, N, 3.5, vis(0.01, dist) * 1.3, sInfo);
  albedo *= mix(1.0, sInfo.r * 1.2 + 0.4, vis(0.01, dist));
  albedo *= mix(1.0, sInfo.b * 0.7 + 0.3, vis(0.006, dist));
  float rough = 1.0 - sInfo.g;

  // Wetness from the swash (and anything standing in the sea).
  float L = landDist(vWorld.xz);
  float t = uTime * uMotion;
  vec4 sw = swash(vWorld.xz, L, t);
  float wet = clamp(max(max(sw.z, sw.x), 1.0 - smoothstep(-0.4, 0.1, L)), 0.0, 1.0);
  // Tops dry first between waves (blotchy edge); the bit the water covers stays wet.
  float dryTop = smoothstep(0.0, 0.7, vLocalY + (vnoise3(P * 25.0) - 0.5) * 0.5);
  wet *= mix(1.0, 0.35, dryTop * (1.0 - sw.x));
  // Wet stones: darker and more saturated.
  float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
  vec3 wetAlb = mix(vec3(lum), albedo, 1.2) * 0.62;
  albedo = mix(albedo, wetAlb, wet);

  // Dry stones: sand dusting around the base, where they sit in the beach.
  float dust = (1.0 - smoothstep(-0.45, -0.1, vLocalY)) * (1.0 - wet) * (0.55 + 0.45 * vnoise3(P * 90.0) * vG);
  albedo = mix(albedo, cSandDust, dust * 0.65);

  // Lighting: sky ambient (occluded underneath), wrapped low sun, specular that tightens
  // and brightens when wet, plus a wet reflection of the sky.
  float ao = mix(0.45, 1.0, smoothstep(-0.6, 0.3, vLocalY));
  vec3 ambient = mix(cGroundS, cSkyS, N.y * 0.5 + 0.5) * ao;
  float wrap = max((dot(N, uSunDir) + 0.2) / 1.2, 0.0);
  vec3 H = normalize(uSunDir - V);
  // The wet film is broken by the rough surface: the highlight sparkles in patches rather
  // than forming one smooth plastic blob.
  float shin = mix(14.0, 90.0, wet);
  float film = smoothstep(0.35, 0.65, rough + (vnoise3(P * 60.0) - 0.5) * 0.4);
  float spec = pow(max(dot(N, H), 0.0), shin) * mix(0.08, 1.4, wet) * mix(0.25, 1.0, film);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, -V), 0.0, 1.0), 5.0);
  vec3 R = reflect(V, N);
  vec3 skyR = mix(cSkyRefl, uFogGlow, pow(max(dot(R, uSunDir), 0.0), 6.0));
  // Wet film reflects the sky over the whole stone (stronger at grazing angles).
  float reflAmt = wet * (0.08 + 0.55 * fres) * mix(0.55, 1.0, film);
  // Bounce light: the sunlit sand lights the stone's underside and flanks.
  vec3 bounce = vec3(0.56, 0.48, 0.66) * pow(clamp(0.5 - 0.5 * N.y, 0.0, 1.0), 1.5) * (1.0 - smoothstep(-0.2, 0.6, vLocalY)) * (1.0 - wet * 0.6) * 0.7;
  vec3 col = albedo * (ambient + bounce + cSunS * wrap * 0.7) * (1.0 - reflAmt * 0.5) + cSunS * spec + skyR * reflAmt;

  // Foam lapping round stones the swash reaches.
  col = mix(col, foamShadeAt(cFoamS, V, vWorld.xz, sw.y), sw.y * 0.85 * (1.0 - smoothstep(0.0, 0.25, vLocalY + 0.3)));

  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export function stoneMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      ...shared,
      ...surfaceUniforms('rock_face_03', 'tStone'),
      // Real stone colours, pulled slightly toward the twilight palette.
      cGranite: { value: color('#8a7f8e') },
      cBasalt: { value: color('#2a2934') },
      cQuartz: { value: color('#c4bfd0') },
      cSandst: { value: color('#8e7476') },
      cSandDust: { value: color('#a49ad0') },
      cSkyS: { value: color('#8f86d0') },
      cGroundS: { value: color('#232458') },
      cSunS: { value: color('#f5c8d0') },
      cFoamS: { value: color('#e4dcff') },
      cSkyRefl: { value: color('#5a4f9e') },
    },
  })
}
