import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { lookNew } from '../quality'
import { noiseGLSL } from './glsl'
import { color, palette, shared } from './world'

// The sky is rendered in two parts:
// 1. Baked once at load into a small cube map: the gradient and the sunset glow (also the
//    source of the environment map for the reflective materials).
// 2. Live, per frame: a lookup of that cube plus the sun disc and twinkling stars.

const sphereVertex = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99995, p.w); // just inside the far plane
}
`

const bakeFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 cZenith, cUpper, cMid, cHorizon, cGlow, cFog;
varying vec3 vDir;

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float hc = max(h, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);

  // Base gradient: warm horizon to deep indigo zenith.
  vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.07, hc));
  col = mix(col, cUpper, smoothstep(0.07, 0.3, hc));
  col = mix(col, cZenith, smoothstep(0.3, 0.8, hc));
  col = mix(col, cMid, (1.0 - pow(sd, 3.0)) * (1.0 - smoothstep(0.0, 0.1, hc)) * 0.7);
  float band = exp(-hc * 14.0);
  col += cGlow * band * (0.05 + 0.75 * pow(sd, 9.0));
  col += cGlow * pow(sd, 40.0) * 0.6;

  // Below the horizon: blend into the fog colour the far sea fades to.
  vec3 below = mix(cFog, cGlow, pow(sd, 8.0) * 0.7);
  col = mix(col, below, 1.0 - smoothstep(-0.01, 0.0, h));
  gl_FragColor = vec4(col, 1.0);
}
`

const liveFragment = /* glsl */ `
uniform samplerCube uSky;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uFogColor, uFogGlow;
varying vec3 vDir;
${noiseGLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = textureCube(uSky, d).rgb;
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);

  // Stars, fading out near the sun and the horizon.
  vec2 sp = d.xz / (d.y + 0.35) * 140.0;
  vec2 id = floor(sp);
  float r = hash12(id);
  float star = step(0.986, r) * (1.0 - smoothstep(0.0, 0.12, length(fract(sp) - 0.5)));
  star *= 0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 60.0);
  col += vec3(0.85, 0.85, 1.0) * star * smoothstep(0.08, 0.35, h) * (1.0 - pow(sd, 3.0));

  // Sun disc.
  float disc = smoothstep(0.99955, 0.99975, sd) * smoothstep(-0.004, 0.003, h);
  col += vec3(7.0, 6.4, 6.2) * disc;
  col += vec3(1.6, 1.3, 1.35) * pow(sd, 500.0);
#ifdef LOOK_NEW
  // Warm atmospheric glow round the low sun: a tight corona and a wide soft halo.
  col += vec3(1.0, 0.8, 0.74) * (pow(sd, 2500.0) * 1.1 + pow(sd, 90.0) * 0.16) * smoothstep(-0.03, 0.01, h);
#endif
  // Salt-spray haze just above the horizon, so sea and sky meet softly.
  float haze = exp(-max(h, 0.0) * 38.0) * smoothstep(-0.02, 0.0, h);
  col = mix(col, mix(uFogColor, uFogGlow, pow(sd, 6.0) * 0.8) * 1.06, haze * 0.42);
  gl_FragColor = vec4(col, 1.0);
}
`

function bakeUniforms() {
  return {
    uSunDir: shared.uSunDir,
    cZenith: { value: color(palette.zenith) },
    cUpper: { value: color(palette.upper) },
    cMid: { value: color(palette.mid) },
    cHorizon: { value: color(palette.horizon) },
    cGlow: { value: color(palette.glow) },
    cFog: { value: shared.uFogColor.value },
  }
}

// A smooth gradient: a small cube holds it (the sun disc and halo are drawn live).
const CUBE_SIZE = 256

export default function Sky() {
  const mesh = useRef()
  const { gl, scene } = useThree()

  const { target, material } = useMemo(() => {
    const target = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false })
    const material = new THREE.ShaderMaterial({
      vertexShader: sphereVertex,
      fragmentShader: liveFragment,
      side: THREE.BackSide,
      depthWrite: false,
      defines: lookNew ? { LOOK_NEW: '' } : {},
      uniforms: { uSky: { value: target.texture }, uTime: shared.uTime, uSunDir: shared.uSunDir, uFogColor: shared.uFogColor, uFogGlow: shared.uFogGlow },
    })
    return { target, material }
  }, [])

  // Bake the sky once, then derive the environment map (for the lacquered piano and other
  // reflective materials) from the same cube.
  useEffect(() => {
    const bakeScene = new THREE.Scene()
    const bakeMat = new THREE.ShaderMaterial({ vertexShader: sphereVertex, fragmentShader: bakeFragment, side: THREE.BackSide, depthWrite: false, uniforms: bakeUniforms() })
    const sphere = new THREE.SphereGeometry(10, 64, 32)
    bakeScene.add(new THREE.Mesh(sphere, bakeMat))
    new THREE.CubeCamera(0.1, 100, target).update(gl, bakeScene)
    bakeMat.dispose()
    sphere.dispose()
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromCubemap(target.texture)
    scene.environment = env.texture
    scene.environmentIntensity = 0.9
    pmrem.dispose()
    return () => {
      scene.environment = null
      env.dispose()
    }
  }, [gl, scene, target])

  useEffect(() => () => target.dispose(), [target])

  useFrame(({ camera }) => {
    mesh.current.position.copy(camera.position)
  })

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1500, 64, 32]} />
    </mesh>
  )
}
