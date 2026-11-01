import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { tier } from '../quality'
import { noise3GLSL, noiseGLSL } from './glsl'
import { color, palette, shared } from './world'

// The sky is rendered in two parts:
// 1. Baked once at load into a cube map: the gradient, the sunset glow and a layer of
//    clouds ray-marched through a slab of sky and lit after Schneider's Horizon Zero Dawn
//    talk (Beer's law for extinction, the "powder" term for dark, defined edges, and a
//    two-lobe Henyey-Greenstein phase for the silver lining near the sun). The alpha
//    channel stores how much of the sky shows through the clouds.
// 2. Live, per frame: a cheap lookup of that cube plus the sun disc and twinkling stars,
//    both hidden where clouds cover them.

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
uniform vec3 cZenith, cUpper, cMid, cHorizon, cGlow, cCloud, cCloudLit, cFog;
varying vec3 vDir;
${noiseGLSL}
${noise3GLSL}

const float SLAB0 = 1.0;   // cloud base (sky units)
const float SLAB1 = 1.55;  // cloud tops
const float PI = 3.14159265;

float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

// Cloud density at p (sky units). cov: local coverage 0..1.
float density(vec3 p, float cov, bool detail){
  float h = (p.y - SLAB0) / (SLAB1 - SLAB0);
  // Flat-ish bases, rounded tops (cumulus profile).
  float profile = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.45, 1.0, h));
  vec3 q = vec3(p.x, p.y * 2.2, p.z);
  float base = fbm3g(q * 0.62 + vec3(3.1, 0.0, 1.7));
  float d = (base - (1.0 - cov)) / max(cov, 0.05) * 1.6;
  d = d * profile - (1.0 - profile) * 0.35;
  // Erode the edges into wisps and cauliflower bumps.
  if (detail && d > 0.0) d -= (vnoise3(q * 3.4 + 7.0) * 0.6 + vnoise3(q * 8.0 - 3.0) * 0.4) * 0.45 * (1.0 - d);
  return clamp(d, 0.0, 1.0);
}

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

  float T = 1.0; // transmittance through the clouds
  if (h > 0.004) {
    float t0 = SLAB0 / h;
    float t1 = min(SLAB1 / h, t0 + 30.0);
    const int STEPS = 22;
    float dt = (t1 - t0) / float(STEPS);
    // Coverage: heavier toward the horizon and around the sun, like a sunset sky.
    float cov = 0.36 + 0.2 * exp(-hc * 5.0) + 0.12 * pow(sd, 2.0);
    float cosA = dot(d, uSunDir);
    float phase = mix(hg(cosA, 0.62), hg(cosA, -0.2), 0.3) * 4.0 * PI; // ~1 for isotropic
    vec3 sunCol = cGlow * vec3(1.2, 0.98, 0.85) * 1.7;
    vec3 scat = vec3(0.0);
    const float SIGMA = 9.0;
    for (int i = 0; i < STEPS; i++) {
      float t = t0 + (float(i) + 0.5) * dt;
      vec3 p = d * t;
      float den = density(p, cov, true);
      if (den <= 0.003) continue;
      // Light march toward the sun (cheap density).
      float od = 0.0;
      vec3 lp = p;
      for (int j = 1; j <= 5; j++) {
        lp += uSunDir * 0.09 * float(j);
        od += density(lp, cov, false) * 0.09 * float(j);
      }
      od *= SIGMA * 1.7;
      float beer = exp(-od);
      float powder = 1.0 - exp(-od * 2.0);
      float lightE = beer * mix(1.0, powder * 2.0, 0.5);
      float hf = clamp((p.y - SLAB0) / (SLAB1 - SLAB0), 0.0, 1.0);
      // Sky light: dark lavender bellies, lighter tops.
      vec3 ambient = mix(cCloud * 0.32, cCloudLit * 0.38, hf * hf) + cUpper * 0.12;
      vec3 S = sunCol * lightE * phase + ambient;
      float ext = den * SIGMA;
      float a = exp(-ext * dt);
      scat += T * S * (1.0 - a);
      T *= a;
      if (T < 0.02) break;
    }
    // Fade the layer out right at the horizon (sub-pixel, aliases) and blend toward the
    // horizon colour with distance (aerial perspective).
    float fade = smoothstep(0.004, 0.03, h);
    float aerial = 1.0 - exp(-t0 * 0.02);
    vec3 hazeCol = mix(cMid, cGlow, pow(sd, 4.0) * 0.8);
    scat = mix(scat, hazeCol * (1.0 - T), aerial * 0.55);
    col = mix(col, col * T + scat, fade);
    T = mix(1.0, T, fade);
  }

  // Below the horizon: blend into the fog colour the far sea fades to.
  vec3 below = mix(cFog, cGlow, pow(sd, 8.0) * 0.7);
  col = mix(col, below, 1.0 - smoothstep(-0.01, 0.0, h));
  gl_FragColor = vec4(col, T);
}
`

const liveFragment = /* glsl */ `
uniform samplerCube uSky;
uniform float uTime;
uniform vec3 uSunDir;
varying vec3 vDir;
${noiseGLSL}
void main(){
  vec3 d = normalize(vDir);
  vec4 sky = textureCube(uSky, d);
  vec3 col = sky.rgb;
  float clear = sky.a; // how much open sky shows through the clouds
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);

  // Stars, fading out near the sun and the horizon, hidden by clouds.
  vec2 sp = d.xz / (d.y + 0.35) * 140.0;
  vec2 id = floor(sp);
  float r = hash12(id);
  float star = step(0.986, r) * (1.0 - smoothstep(0.0, 0.12, length(fract(sp) - 0.5)));
  star *= 0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 60.0);
  col += vec3(0.85, 0.85, 1.0) * star * smoothstep(0.08, 0.35, h) * (1.0 - pow(sd, 3.0)) * clear;

  // Sun disc, dimmed where clouds pass in front of it.
  float disc = smoothstep(0.99955, 0.99975, sd) * smoothstep(-0.004, 0.003, h);
  col += vec3(7.0, 6.4, 6.2) * disc * mix(0.15, 1.0, clear);
  col += vec3(1.6, 1.3, 1.35) * pow(sd, 500.0) * mix(0.4, 1.0, clear);
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
    cCloud: { value: color(palette.cloud) },
    cCloudLit: { value: color(palette.cloudLit) },
    cFog: { value: shared.uFogColor.value },
  }
}

const CUBE_SIZE = tier === 'low' ? 512 : 1024

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
      uniforms: { uSky: { value: target.texture }, uTime: shared.uTime, uSunDir: shared.uSunDir },
    })
    return { target, material }
  }, [])

  // Bake the sky and clouds once, then derive the environment map (for the lacquered
  // piano and other reflective materials) from the same cube.
  useEffect(() => {
    const bakeScene = new THREE.Scene()
    const bakeMat = new THREE.ShaderMaterial({ vertexShader: sphereVertex, fragmentShader: bakeFragment, side: THREE.BackSide, depthWrite: false, uniforms: bakeUniforms() })
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), bakeMat)
    bakeScene.add(sphere)
    const cam = new THREE.CubeCamera(0.1, 100, target)
    cam.update(gl, bakeScene)
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromCubemap(target.texture)
    scene.environment = env.texture
    scene.environmentIntensity = 0.9
    pmrem.dispose()
    bakeMat.dispose()
    sphere.geometry.dispose()
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
