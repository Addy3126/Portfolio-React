import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { noiseGLSL } from './glsl'
import { color, palette, shared } from './world'

const vertex = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99995, p.w); // just inside the far plane
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 cZenith, cUpper, cMid, cHorizon, cGlow, cCloud, cCloudLit, cFog;
varying vec3 vDir;
${noiseGLSL}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float hc = max(h, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);

  // Base gradient: warm horizon to deep indigo zenith.
  vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.07, hc));
  col = mix(col, cUpper, smoothstep(0.07, 0.3, hc));
  col = mix(col, cZenith, smoothstep(0.3, 0.8, hc));
  // Pull the horizon toward violet away from the sun.
  col = mix(col, cMid, (1.0 - pow(sd, 3.0)) * (1.0 - smoothstep(0.0, 0.1, hc)) * 0.7);

  // Glow around the sun, strongest along the horizon.
  float band = exp(-hc * 14.0);
  col += cGlow * band * (0.05 + 0.75 * pow(sd, 9.0));
  col += cGlow * pow(sd, 40.0) * 0.6;

  // Stars, fading out near the sun and the horizon.
  vec2 sp = d.xz / (d.y + 0.35) * 140.0;
  vec2 id = floor(sp);
  float r = hash12(id);
  float star = step(0.986, r) * (1.0 - smoothstep(0.0, 0.12, length(fract(sp) - 0.5)));
  star *= 0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 60.0);
  col += vec3(0.85, 0.85, 1.0) * star * smoothstep(0.08, 0.35, h) * (1.0 - pow(sd, 3.0));


  // Clouds: fbm on a flat sky plane, banked low around the horizon.
  if (h > -0.02) {
    vec2 uv = d.xz / (hc + 0.05) * 0.32;
    uv.x += uTime * 0.0035;
    float n = fbm(uv + vec2(0.0, 4.0));
    float n2 = fbm(uv * 2.7 - 3.0);
    float cov = smoothstep(0.42, 0.78, n * 0.75 + n2 * 0.35);
    float alt = smoothstep(0.004, 0.035, hc) * (1.0 - smoothstep(0.16, 0.42, hc));
    float lit = pow(sd, 6.0);
    vec3 cc = mix(cCloud, cCloudLit, lit * 0.9 + n2 * 0.2);
    cc += cGlow * pow(sd, 20.0) * 0.9 * (1.0 - cov * 0.5); // bright rims toward the sun
    col = mix(col, cc, cov * alt * 0.9);
  }

  // Below the horizon: blend into the fog colour the far sea fades to.
  vec3 below = mix(cFog, cGlow, pow(sd, 8.0) * 0.7);
  col = mix(col, below, 1.0 - smoothstep(-0.01, 0.0, h));

  // Sun disc (HDR so bloom picks it up).
  float disc = smoothstep(0.99955, 0.99975, sd) * smoothstep(-0.004, 0.003, h);
  col += vec3(7.0, 6.4, 6.2) * disc;
  col += vec3(1.6, 1.3, 1.35) * pow(sd, 500.0);

  gl_FragColor = vec4(col, 1.0);
}
`

export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: shared.uTime,
      uSunDir: shared.uSunDir,
      cZenith: { value: color(palette.zenith) },
      cUpper: { value: color(palette.upper) },
      cMid: { value: color(palette.mid) },
      cHorizon: { value: color(palette.horizon) },
      cGlow: { value: color(palette.glow) },
      cCloud: { value: color(palette.cloud) },
      cCloudLit: { value: color(palette.cloudLit) },
      cFog: { value: shared.uFogColor.value },
    },
  })
}

export default function Sky() {
  const mesh = useRef()
  const { gl, scene } = useThree()
  const material = useMemo(makeSkyMaterial, [])

  // Bake the sky once into an environment map so the lacquered piano reflects it.
  useEffect(() => {
    const envScene = new THREE.Scene()
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material)
    envScene.add(envSky)
    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromScene(envScene, 0.02)
    scene.environment = rt.texture
    scene.environmentIntensity = 0.9
    return () => {
      scene.environment = null
      rt.dispose()
      pmrem.dispose()
      envSky.geometry.dispose()
    }
  }, [gl, scene, material])

  useFrame(({ camera }) => {
    mesh.current.position.copy(camera.position)
  })

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1500, 64, 32]} />
    </mesh>
  )
}
