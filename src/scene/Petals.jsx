import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL } from './glsl'
import { color, shared } from './world'

// Petals live in a box that scrolls toward the sun and wraps around.
const BOX_MIN = [-36, 0.15, -70]
const BOX_SIZE = [72, 16, 82]

const vertex = /* glsl */ `
attribute vec4 iSeed;
attribute vec4 iSeed2;
uniform float uTime;
uniform float uMotion;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vWorld;
varying float vShade;

mat3 rotAxis(vec3 a, float ang){
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

void main(){
  vUv = position.xy + 0.5;
  float t = uTime * uMotion;
  float speed = 0.5 + iSeed.w * 0.9;
  vec3 flow = normalize(vec3(uSunDir.x + 0.45, 0.0, uSunDir.z));

  vec3 p = uBoxMin + iSeed.xyz * uBoxSize + flow * t * speed * 1.4;
  p.xz = uBoxMin.xz + mod(p.xz - uBoxMin.xz, uBoxSize.xz);

  // Swirl: lazy loops layered on the drift.
  float ph = iSeed2.x * 6.2831;
  p.x += sin(t * 0.35 * speed + ph + p.z * 0.08) * 1.6;
  p.y += sin(t * 0.5 * speed + ph * 1.3) * 0.9 + sin(t * 0.17 + p.x * 0.05) * 0.6;
  p.z += cos(t * 0.3 * speed + ph) * 1.2;

  float size = (0.08 + iSeed2.y * 0.12) * clamp(distance(p, cameraPosition) / 6.0, 0.35, 1.0);
  vec3 axis = normalize(vec3(iSeed2.z - 0.5, 1.0, iSeed2.w - 0.5));
  mat3 R = rotAxis(axis, t * (1.0 + iSeed2.z * 2.0) + ph);
  vec3 local = R * (position * vec3(size, size * 0.55, size));
  vShade = abs((R * vec3(0.0, 0.0, 1.0)).y);

  vec3 w = p + local;
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`

const fragment = /* glsl */ `
uniform vec3 cPetal, cRim;
varying vec2 vUv;
varying vec3 vWorld;
varying float vShade;
${fogGLSL}
void main(){
  vec2 q = vUv - 0.5;
  // Leaf shape: pointed ellipse.
  float leaf = length(vec2(q.x, q.y * (1.0 + abs(q.x) * 2.5)));
  if (leaf > 0.5) discard;
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  float back = pow(max(dot(V, uSunDir), 0.0), 8.0);
  vec3 col = cPetal * (0.5 + 0.5 * vShade) + cRim * back * 0.12;
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Petals({ count }) {
  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    const plane = new THREE.PlaneGeometry(1, 1)
    g.index = plane.index
    g.setAttribute('position', plane.attributes.position)
    const a = new Float32Array(count * 4)
    const b = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i++) {
      a[i] = Math.random()
      b[i] = Math.random()
    }
    // Bias heights toward the ground.
    for (let i = 0; i < count; i++) a[i * 4 + 1] = Math.pow(a[i * 4 + 1], 1.8)
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(a, 4))
    g.setAttribute('iSeed2', new THREE.InstancedBufferAttribute(b, 4))
    g.instanceCount = count
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
          uBoxMin: { value: new THREE.Vector3(...BOX_MIN) },
          uBoxSize: { value: new THREE.Vector3(...BOX_SIZE) },
          cPetal: { value: color('#120c30') },
          cRim: { value: color('#f5c8d0') },
        },
      }),
    [],
  )

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
