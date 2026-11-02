import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { flowerShadeGLSL, flowerUniforms, lilyGeometry, toInstanced } from './flower'
import { fogGLSL } from './glsl'
import { color, hideInReflection, shared } from './world'

// Floating flowers live in a box that drifts toward the sun and wraps around.
export const BOX_MIN = [-36, 0.15, -70]
export const BOX_SIZE = [72, 16, 82]

const vertex = /* glsl */ `
attribute float part;
attribute vec4 iSeed;
attribute vec4 iSeed2;
uniform float uTime;
uniform float uMotion;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vPart;
varying float vKind;
varying float vGlow;
varying vec3 vNormalW;
varying vec3 vWorld;

mat3 rotAxis(vec3 a, float ang){
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

void main(){
  vUv = uv;
  vPart = part;
  vKind = 0.0;
  float t = uTime * uMotion;
  float speed = 0.5 + iSeed.w * 0.9;
  vec3 flow = normalize(vec3(uSunDir.x + 0.45, 0.0, uSunDir.z));

  vec3 p = uBoxMin + iSeed.xyz * uBoxSize + flow * t * speed * 1.4;
  p.xz = uBoxMin.xz + mod(p.xz - uBoxMin.xz, uBoxSize.xz);

  // Lazy loops layered on the drift.
  float ph = iSeed2.x * 6.2831;
  p.x += sin(t * 0.35 * speed + ph + p.z * 0.08) * 1.6;
  p.y += sin(t * 0.5 * speed + ph * 1.3) * 0.9 + sin(t * 0.17 + p.x * 0.05) * 0.6;
  p.z += cos(t * 0.3 * speed + ph) * 1.2;

  // Slow tumble around a mostly-upright axis so flowers keep their shape.
  float camDist = distance(p, cameraPosition);
  float size = (0.085 + iSeed2.y * 0.085) * clamp(camDist / 6.0, 0.4, 1.0);
  vec3 axis = normalize(vec3(iSeed2.z - 0.5, 0.6, iSeed2.w - 0.5));
  mat3 R = rotAxis(axis, t * (0.2 + iSeed2.z * 0.45) + ph);

  vec3 w = p + R * (position * size);
  vNormalW = R * normal;
  vWorld = w;
  vGlow = 1.0 - smoothstep(5.0, 25.0, camDist);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`

const fragment = /* glsl */ `
varying vec2 vUv;
varying float vPart;
varying float vKind;
varying float vGlow;
varying vec3 vNormalW;
varying vec3 vWorld;
${fogGLSL}
${flowerShadeGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 col = shadeFlower(V, dist);
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Petals({ count }) {
  const geometry = useMemo(() => {
    // Low-poly lily: these are small and moving, so ~1/3 of the full model's triangles is plenty.
    const g = toInstanced(lilyGeometry({ detail: 'low' }))
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
          ...flowerUniforms(color),
          uBoxMin: { value: new THREE.Vector3(...BOX_MIN) },
          uBoxSize: { value: new THREE.Vector3(...BOX_SIZE) },
        },
      }),
    [],
  )

  const mesh = useRef()
  useEffect(() => {
    const m = mesh.current
    hideInReflection.add(m)
    return () => hideInReflection.delete(m)
  }, [])

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />
}
