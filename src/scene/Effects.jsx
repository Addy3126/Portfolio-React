import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, GodRays, N8AO, Noise, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing'
import { BlendFunction, Effect, EffectAttribute, KernelSize, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { reducedMotion } from '../quality'
import { SUN_DIR, shared } from './world'

const SUN_DISTANCE = 1400

// Colour grade after tone mapping: cool shadows, warm highlights (split toning), a gentle
// S-curve for contrast and a little vibrance, so the twilight palette has depth instead
// of sitting in one flat purple.
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
      uniform vec3 uGradeHigh;
      uniform vec3 uGradeShadow;
      uniform float uGradeCurve;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // Tints and curve strength per section (scene/grade.js).
        c *= mix(uGradeShadow, vec3(1.0), smoothstep(0.0, 0.45, l));
        c *= mix(vec3(1.0), uGradeHigh, smoothstep(0.45, 1.0, l));
        vec3 s = c * c * (3.0 - 2.0 * c);
        c = mix(c, s, uGradeCurve);
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
        c = mix(vec3(l2), c, 1.0 + 0.18 * (1.0 - sat));
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      { uniforms: new Map([['uGradeHigh', shared.uGradeHigh], ['uGradeShadow', shared.uGradeShadow], ['uGradeCurve', shared.uGradeCurve]]) },
    )
  }
}
const Grade = wrapEffect(GradeEffect)
const TM = { agx: ToneMappingMode.AGX, aces: ToneMappingMode.ACES_FILMIC, neutral: ToneMappingMode.NEUTRAL }

// Safety net: replaces any invalid (NaN/infinite) pixel before the blur passes, which
// would otherwise smear one bad pixel into black blocks. The empty mainUv keeps
// this in its own pass, so the passes after it read the cleaned image.
class SanitizeEffect extends Effect {
  constructor() {
    super(
      'SanitizeEffect',
      /* glsl */ `
      void mainUv(inout vec2 uv) {}
      bool bad(vec3 c) {
        // isnan may be compiled away on ANGLE/Direct3D; the comparisons below still catch
        // NaN (every comparison with NaN is false) and overflow.
        // Exact zero counts too: nothing in this twilight scene is lit to pure black, and some
        // drivers store NaN as 0.
        return any(isnan(c)) || !(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0) || !(c.r < 6e4 && c.g < 6e4 && c.b < 6e4) || (c.r + c.g + c.b) <= 0.0;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        if (bad(c)) {
          // Repair from valid neighbours (two rings, so a 2x2 bad block is covered too)
          // instead of painting the pixel black.
          vec3 sum = vec3(0.0);
          float n = 0.0;
          for (int r = 1; r <= 2; r++) {
            for (int k = 0; k < 8; k++) {
              float a = float(k) * 0.7853982;
              vec3 s = texture2D(inputBuffer, uv + vec2(cos(a), sin(a)) * texelSize * float(r * 2)).rgb;
              if (!bad(s)) { sum += s; n += 1.0; }
            }
          }
          c = n > 0.0 ? sum / n : vec3(0.0);
        }
        // Cap extreme highlights (tames lacquer fireflies).
        c = min(max(c, vec3(0.0)), vec3(12.0));
        outputColor = vec4(c, 1.0);
      }`,
    )
  }
}
const Sanitize = wrapEffect(SanitizeEffect)

// Screen-space contact shadows (as the WebGPU scene): from each pixel a short ray runs
// toward the sun through the depth buffer; a surface in front of the ray (within a thin
// slab) shadows the pixel. Small shadows between grass blades, flowers, stones and piano
// legs that no shadow map resolves. Faded out with distance.
class ContactShadowEffect extends Effect {
  constructor() {
    super(
      'ContactShadowEffect',
      /* glsl */ `
      uniform mat4 uProj;
      uniform mat4 uProjInv;
      uniform vec3 uSunView;
      vec3 viewPos(vec2 p, float d) {
        vec4 v = uProjInv * vec4(vec3(p, d) * 2.0 - 1.0, 1.0);
        return v.xyz / v.w;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (depth >= 0.99999) return;
        vec3 P = viewPos(uv, depth);
        float dist = length(P);
        if (dist > 40.0) return;
        float len = clamp(dist * 0.025, 0.12, 0.7);
        vec3 stepV = uSunView * (len / 12.0);
        // Interleaved gradient noise (Jimenez) to break up banding.
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        vec3 p = P + stepV * jitter;
        float bias = dist * 0.002 + 0.01;
        float occ = 0.0;
        for (int i = 0; i < 12; i++) {
          p += stepV;
          vec4 c = uProj * vec4(p, 1.0);
          vec2 s = c.xy / c.w * 0.5 + 0.5;
          if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0) continue;
          float dz = viewPos(s, readDepth(s)).z - p.z;
          if (dz > bias && dz < 0.35) occ = max(occ, 1.0 - float(i) / 12.0 * 0.5);
        }
        float lit = 1.0 - occ * (1.0 - smoothstep(18.0, 40.0, dist));
        outputColor = vec4(inputColor.rgb * mix(vec3(0.52, 0.5, 0.7), vec3(1.0), lit), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        uniforms: new Map([
          ['uProj', new THREE.Uniform(new THREE.Matrix4())],
          ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
          ['uSunView', new THREE.Uniform(new THREE.Vector3())],
        ]),
      },
    )
  }
  track(camera) {
    this.uniforms.get('uProj').value.copy(camera.projectionMatrix)
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse)
    this.uniforms.get('uSunView').value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse)
  }
}

// Sun lens flare (as the WebGPU scene): sun visibility from the depth buffer on a small ring
// around it, then ghosts along the line through the screen centre, a faint halo and a soft
// horizontal streak. Analytic, so it can't flicker.
const GHOSTS = [
  [0.55, 0.035, [0.55, 0.45, 0.9]],
  [0.95, 0.02, [0.9, 0.6, 0.75]],
  [1.35, 0.06, [0.4, 0.5, 1.0]],
  [1.7, 0.028, [0.75, 0.55, 1.0]],
  [2.15, 0.09, [0.35, 0.3, 0.8]],
]
const f3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`
class LensFlareEffect extends Effect {
  constructor() {
    super(
      'LensFlareEffect',
      /* glsl */ `
      uniform vec2 uSun;
      uniform float uSunOn;
      uniform float uAspect;
      uniform float uNear;
      uniform float uFar;
      float viewZAt(vec2 p) {
        float d = readDepth(p);
        return (uNear * uFar) / ((uFar - uNear) * d - uFar);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = inputColor;
        if (uSunOn < 0.5) return;
        float vis = 0.0;
        for (int k = 0; k < 12; k++) {
          float a = float(k) / 12.0 * 6.2831853;
          float r = mod(float(k), 2.0) > 0.5 ? 0.006 : 0.012;
          vis += 1.0 - smoothstep(-1450.0, -1300.0, viewZAt(uSun + vec2(cos(a), sin(a)) * r / vec2(uAspect, 1.0)));
        }
        // (GLSL smoothstep needs edge0 < edge1, hence the 1 - smoothstep forms.)
        vis *= smoothstep(-0.1, 0.05, uSun.x) * (1.0 - smoothstep(0.95, 1.1, uSun.x)) * smoothstep(-0.1, 0.05, uSun.y) * (1.0 - smoothstep(0.95, 1.1, uSun.y)) / 12.0;
        if (vis < 0.001) return;
        vec2 A = vec2(uAspect, 1.0);
        vec2 toC = vec2(0.5) - uSun;
        vec3 res = vec3(0.0);
        ${GHOSTS.map(([f, r, t]) => `{ float d = length((uv - (uSun + toC * ${f.toFixed(3)})) * A);
          res += ${f3(t)} * (1.0 - smoothstep(${(r * 0.55).toFixed(4)}, ${r.toFixed(4)}, d)) * (0.55 + 0.45 * smoothstep(${(r * 0.4).toFixed(4)}, ${r.toFixed(4)}, d)) * 0.16; }`).join('\n        ')}
        float hd = length((uv - (uSun + toC)) * A);
        res += vec3(0.5, 0.42, 0.85) * exp(-abs(hd - 0.32) * 60.0) * 0.03;
        vec2 ds = (uv - uSun) * A;
        res += vec3(0.75, 0.7, 1.0) * exp(-abs(ds.y) * 320.0) * exp(-abs(ds.x) * 4.5) * 0.32;
        res += vec3(1.0, 0.85, 0.8) * exp(-length(ds) * 14.0) * 0.12;
        outputColor = vec4(inputColor.rgb + res * vis, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        uniforms: new Map([
          ['uSun', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
          ['uSunOn', new THREE.Uniform(0)],
          ['uAspect', new THREE.Uniform(1)],
          ['uNear', new THREE.Uniform(0.1)],
          ['uFar', new THREE.Uniform(3000)],
        ]),
      },
    )
    this._v = new THREE.Vector3()
  }
  track(camera, aspect) {
    const v = this._v.copy(camera.position).addScaledVector(SUN_DIR, 1400).project(camera)
    this.uniforms.get('uSun').value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5)
    this.uniforms.get('uSunOn').value = v.z < 1 ? 1 : 0
    this.uniforms.get('uAspect').value = aspect
    this.uniforms.get('uNear').value = camera.near
    this.uniforms.get('uFar').value = camera.far
  }
}

// Light source for the shafts: a bright disc where the sky draws the sun.
// It is never added to the scene; the god-rays pass renders it on its own.
function useSunSource() {
  return useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.97, 0.95), fog: false, toneMapped: false }),
    )
    m.scale.setScalar(15) // smaller than the sky's sun disc, so its edge never shows
    return m
  }, [])
}

// Depth of field was removed: its half-resolution blur produced invalid pixels on the
// piano's lacquer (black 2x2 specks) on some GPUs.
export default function Effects({ godRays = true, ao = false, contact = false, flare = true, grade = true, tm = null, sanitize = true, msaaOverride = null }) {
  const sun = useSunSource()
  const composer = useRef()
  const contactFx = useMemo(() => (contact ? new ContactShadowEffect() : null), [contact])
  const flareFx = useMemo(() => (flare ? new LensFlareEffect() : null), [flare])

  useFrame(({ camera, size }) => {
    contactFx?.track(camera)
    flareFx?.track(camera, size.width / size.height)
    if (godRays) {
      sun.position.copy(camera.position).addScaledVector(SUN_DIR, SUN_DISTANCE)
      sun.updateMatrixWorld()
    }

  })

  // Edge smoothing: SMAA by default; ?msaa=N switches to hardware multisampling.
  const msaa = msaaOverride ?? 0
  return (
    <EffectComposer ref={composer} multisampling={msaa} frameBufferType={THREE.HalfFloatType} autoClear={false}>
      {/* Contact shadows where things meet: piano legs in the grass, rubble against towers,
          rock crevices. Half resolution keeps it affordable. */}
      {ao && <N8AO halfRes quality="medium" aoRadius={1.2} distanceFalloff={0.6} intensity={2.2} color="#0b0a24" />}
      {sanitize && <Sanitize />}
      {contactFx && <primitive object={contactFx} />}
      {godRays && (
        <GodRays
          sun={sun}
          samples={reducedMotion ? 30 : 40}
          density={0.96}
          decay={0.94}
          weight={0.35}
          exposure={0.32}
          clampMax={1}
          blur
          kernelSize={KernelSize.SMALL}
          resolutionScale={0.5}
        />
      )}
      {flareFx && <primitive object={flareFx} />}
      <ToneMapping mode={TM[tm] ?? ToneMappingMode.NEUTRAL} />
      {grade && <Grade />}
      {msaa === 0 && <SMAA />}
      <Vignette offset={0.3} darkness={0.55} />
      <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  )
}
