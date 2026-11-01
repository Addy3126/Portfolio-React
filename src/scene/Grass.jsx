import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from './glsl'
import { PIANO_POS, color, palette, shared, shoreZ } from './world'

const SEGMENTS = 4

// One tapered blade, 0..1 tall, centred on x = 0.
function bladeGeometry() {
  const positions = []
  const index = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    const w = 0.5 * Math.pow(1 - t, 0.9)
    if (i === SEGMENTS) positions.push(0, 1, 0)
    else positions.push(-w, t, 0, w, t, 0)
  }
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const last = (SEGMENTS - 1) * 2
  index.push(last, last + 1, last + 2)
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(index)
  return g
}

const vertex = /* glsl */ `
attribute vec3 iOffset;
attribute vec4 iParams; // yaw, height, width, random
uniform float uTime;
uniform float uMotion;
varying float vT;
varying float vRand;
varying vec3 vWorld;
${noiseGLSL}
void main(){
  float t = position.y;
  vT = t;
  vRand = iParams.w;
  float yaw = iParams.x, hgt = iParams.y, wid = iParams.z;

  vec3 p = vec3(position.x * wid, t * hgt, 0.0);
  p.z += (0.18 + vRand * 0.3) * t * t * hgt; // natural droop
  float c = cos(yaw), s = sin(yaw);
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  vec3 w = iOffset + p;

  // Wind: slow gusts rolling across the field from the left.
  float time = uTime * uMotion;
  float gust = vnoise(iOffset.xz * 0.07 + vec2(-time * 0.22, time * 0.03));
  float wave = sin(time * 1.05 - iOffset.x * 0.32 + iOffset.z * 0.18) * 0.5 + 0.5;
  float bend = (0.12 + 0.6 * gust * gust + 0.18 * wave) * t * t * hgt;
  vec2 windDir = normalize(vec2(0.85, -0.5));
  w.xz += windDir * bend;
  w.y -= bend * bend * 0.5;

  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`

const fragment = /* glsl */ `
uniform vec3 cBase, cTip, cFrost;
uniform vec3 uPianoPos, uPianoGlow;
uniform float uGlowPulse;
varying float vT;
varying float vRand;
varying vec3 vWorld;
float spow(float x, float e){ return pow(max(x, 0.0), e); }
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 col = mix(cBase, cTip, smoothstep(0.0, 0.85, clamp(vT, 0.0, 1.0)));
  col *= 0.55 + 0.7 * vRand;
  // Frosted tips, glowing when backlit by the sun.
  float back = pow(max(dot(V, uSunDir), 0.0), 4.0);
  col += cFrost * spow(vT, 2.6) * (0.16 + 1.0 * back);
  // Blue spill from the piano.
  float pd = length(vWorld.xz - uPianoPos.xz);
  col += uPianoGlow * uGlowPulse * (0.25 + vT) * 0.55 / (1.0 + pd * pd * 0.9);
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Grass({ count }) {
  const geometry = useMemo(() => {
    const g = bladeGeometry()
    const offsets = new Float32Array(count * 3)
    const params = new Float32Array(count * 4)
    let n = 0
    let guard = 0
    while (n < count && guard++ < count * 20) {
      // Denser near the camera: sample depth with a bias toward the front.
      const u = Math.random()
      const z = 11.8 - 20.8 * Math.pow(u, 0.85)
      const halfWidth = (11.5 - z) * 1.05 + 3
      const x = (Math.random() * 2 - 1) * halfWidth
      if (z < shoreZ(x) + 0.25) continue
      // Leave a clearing around the landing cameras so no blade fills the lens.
      if (Math.hypot(x, z - 9) < 1.4 || Math.hypot(x + 1.5, z - 10.8) < 1.4) continue
      // Keep blades out of the piano bench's footprint.
      const dx = x - (PIANO_POS.x - 0.8)
      const dz = z - PIANO_POS.z
      const nearBench = Math.abs(dx) < 0.3 && Math.abs(dz) < 0.55
      const r = Math.random()
      offsets.set([x, 0, z], n * 3)
      const height = (0.32 + Math.random() * 0.38) * (nearBench ? 0.4 : 1) * (z < -4 ? 1.2 : 1)
      const width = 0.035 + Math.random() * 0.03 + Math.max(0, -z) * 0.004
      params.set([Math.random() * Math.PI * 2, height, width, r], n * 4)
      n++
    }
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    g.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 4))
    g.instanceCount = n
    return g
  }, [count])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: THREE.DoubleSide,
        uniforms: {
          ...shared,
          cBase: { value: color(palette.grassBase) },
          cTip: { value: color(palette.grassTip) },
          cFrost: { value: color(palette.frost) },
        },
      }),
    [],
  )

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
