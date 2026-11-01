import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, GodRays, N8AO, Noise, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing'
import { BlendFunction, Effect, KernelSize, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { reducedMotion } from '../quality'
import { SUN_DIR } from './world'

const SUN_DISTANCE = 1400

// Colour grade after tone mapping: cool shadows, warm highlights (split toning), a gentle
// S-curve for contrast and a little vibrance, so the twilight palette has depth instead
// of sitting in one flat purple.
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadowTint = vec3(0.9, 0.94, 1.08);
        vec3 highTint = vec3(1.07, 1.0, 0.93);
        c *= mix(shadowTint, vec3(1.0), smoothstep(0.0, 0.45, l));
        c *= mix(vec3(1.0), highTint, smoothstep(0.45, 1.0, l));
        vec3 s = c * c * (3.0 - 2.0 * c);
        c = mix(c, s, 0.22);
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
        c = mix(vec3(l2), c, 1.0 + 0.18 * (1.0 - sat));
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
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
export default function Effects({ godRays = true, ao = false, grade = true, tm = null, sanitize = true, msaaOverride = null }) {
  const sun = useSunSource()
  const composer = useRef()

  useFrame(({ camera }) => {
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
      <ToneMapping mode={TM[tm] ?? ToneMappingMode.NEUTRAL} />
      {grade && <Grade />}
      {msaa === 0 && <SMAA />}
      <Vignette offset={0.3} darkness={0.55} />
      <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  )
}
