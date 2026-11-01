import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { quality } from '../quality'
import { fogGLSL, noiseGLSL } from './glsl'
import { color, hideInReflection, palette, shared } from './world'

const SEA_LEVEL = -0.04

const vertex = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWorld;
void main(){
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 color;
uniform float uTime;
uniform float uMotion;
uniform vec3 cDeep, cShallow, cFar, cGlow, cSkyRefl;
varying vec4 vUv;
varying vec3 vWorld;
${noiseGLSL}
${fogGLSL}

// Slope of one travelling sine wave (deep-water dispersion).
vec2 waveSlope(vec2 p, vec2 dir, float len, float amp, float t){
  float k = 6.2831853 / len;
  float omega = sqrt(9.8 * k);
  return dir * (amp * cos(k * dot(dir, p) - omega * t));
}

void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  float t = uTime * uMotion;
  vec2 p = vWorld.xz;

  // Calm sea: a few long directional waves plus fine noise ripples.
  // Short waves fade with distance so the far water doesn't shimmer.
  float near = 1.0 - smoothstep(25.0, 260.0, dist);
  float mid = 1.0 - smoothstep(80.0, 600.0, dist);
  vec2 g = vec2(0.0);
  g += waveSlope(p, vec2(0.958, 0.287), 11.0, 0.05, t) * mid;
  g += waveSlope(p, vec2(-0.514, 0.857), 6.3, 0.045, t) * mid;
  g += waveSlope(p, vec2(0.196, -0.981), 3.4, 0.035, t) * near;
  g += waveSlope(p, vec2(0.914, -0.406), 1.9, 0.03, t) * near;
  vec2 r1 = vec2(vnoise(p * 1.3 - t * 0.25), vnoise(p * 1.3 + 9.0 + t * 0.2)) - 0.5;
  vec2 r2 = vec2(vnoise(p * 4.5 + t * 0.6), vnoise(p * 4.5 - 4.0 - t * 0.5)) - 0.5;
  g += r1 * 0.09 * near + r2 * 0.06 * near;
  g += (vec2(vnoise(p * 0.12 + t * 0.03), vnoise(p * 0.12 + 5.0)) - 0.5) * 0.04; // broad undulation
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  float cosT = clamp(dot(-V, n), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * spow(1.0 - cosT, 5.0);

  // Reflection: the mirrored scene, nudged by the wave normals.
  #ifdef USE_REFLECTION
    vec2 ruv = vUv.xy / vUv.w + n.xz * 0.05 * (0.3 + 0.7 * near);
    vec3 refl = texture2D(tDiffuse, ruv).rgb;
  #else
    vec3 R0 = reflect(V, n);
    vec3 refl = mix(cSkyRefl, cGlow, spow(dot(R0, uSunDir), 10.0));
  #endif

  // Water body: lighter and bluer near the shore, darker out deep.
  vec3 body = mix(cShallow, cDeep, smoothstep(2.0, 45.0, dist));
  body = mix(body, cFar, smoothstep(120.0, 600.0, dist));
  vec3 col = mix(body, refl, clamp(fresnel * 1.15 + 0.08, 0.0, 1.0));

  // Sun glitter: sharp highlights nearby, a broader streak in the distance.
  vec3 R = reflect(V, n);
  float sd = max(dot(R, uSunDir), 0.0);
  float shin = mix(2600.0, 260.0, smoothstep(6.0, 400.0, dist));
  col += vec3(5.0, 4.6, 4.4) * spow(sd, shin) * mix(1.0, 0.45, smoothstep(6.0, 400.0, dist));
  col += cGlow * spow(sd, 60.0) * 0.18;

  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

const SeaShader = {
  name: 'SeaShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: vertex,
  fragmentShader: fragment,
}

function linkUniforms(material) {
  Object.assign(material.uniforms, shared, {
    cDeep: { value: color('#1c2386') },
    cShallow: { value: color('#3f52c8') },
    cFar: { value: color(palette.seaFar) },
    cGlow: { value: color(palette.glow) },
    cSkyRefl: { value: color('#5a4f9e') },
  })
}

export default function Sea() {
  const { size, viewport } = useThree()
  const scale = quality.reflection

  const mesh = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(3200, 1400)
    let m
    if (scale > 0) {
      m = new Reflector(geometry, { textureWidth: 512, textureHeight: 256, shader: SeaShader, multisample: 0, clipBias: 0.002 })
      m.material.defines = { USE_REFLECTION: '' }
      // Skip grass and flowers while rendering the mirrored view.
      const render = m.onBeforeRender
      m.onBeforeRender = function (...args) {
        hideInReflection.forEach((o) => (o.visible = false))
        render.apply(this, args)
        hideInReflection.forEach((o) => (o.visible = true))
      }
    } else {
      m = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { ...SeaShader.uniforms, textureMatrix: { value: new THREE.Matrix4() } } }),
      )
    }
    linkUniforms(m.material)
    m.rotation.x = -Math.PI / 2
    m.position.set(0, SEA_LEVEL, -620)
    return m
  }, [scale])

  // Keep the reflection at a fraction of the screen resolution.
  useEffect(() => {
    if (!mesh.getRenderTarget) return
    const w = Math.max(256, Math.round(size.width * viewport.dpr * scale))
    const h = Math.max(128, Math.round(size.height * viewport.dpr * scale))
    mesh.getRenderTarget().setSize(w, h)
  }, [mesh, size.width, size.height, viewport.dpr, scale])

  useEffect(() => () => mesh.dispose?.(), [mesh])

  return <primitive object={mesh} />
}
