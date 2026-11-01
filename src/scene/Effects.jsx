import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, GodRays, Noise, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing'
import { BlendFunction, Effect, KernelSize, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { reducedMotion } from '../quality'
import { SUN_DIR } from './world'

const SUN_DISTANCE = 1400

// Safety net: replaces any invalid (NaN/infinite) pixel before the blur passes, which
// would otherwise smear one bad pixel into black blocks. The empty mainUv keeps
// this in its own pass, so the passes after it read the cleaned image.
class SanitizeEffect extends Effect {
  constructor() {
    super(
      'SanitizeEffect',
      /* glsl */ `
      void mainUv(inout vec2 uv) {}
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        // NaN -> black; overflowed (infinite) highlights -> capped bright, not black.
        c = any(isnan(c)) ? vec3(0.0) : c;
        // On Windows (ANGLE/Direct3D) the compiler may drop isnan(); there, min/max
        // return the non-NaN operand, so this clamp removes NaN as well. The upper cap
        // also tames lacquer fireflies.
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
export default function Effects({ godRays = true, sanitize = true, msaaOverride = null }) {
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
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {msaa === 0 && <SMAA />}
      <Vignette offset={0.3} darkness={0.55} />
      <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  )
}
