import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Bloom, DepthOfField, EffectComposer, GodRays, Noise, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing'
import { BlendFunction, Effect, KernelSize, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { bloomEnabled, reducedMotion } from '../quality'
import { motion } from '../store'
import { PIANO_CENTRE, SUN_DIR } from './world'

const SUN_DISTANCE = 1400

// Safety net: replaces any invalid (NaN/infinite) pixel before blur and bloom, which
// would otherwise smear one bad pixel into large black blocks. The empty mainUv keeps
// this in its own pass, so the passes after it read the cleaned image.
class SanitizeEffect extends Effect {
  constructor() {
    super(
      'SanitizeEffect',
      /* glsl */ `
      void mainUv(inout vec2 uv) {}
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        bool bad = any(isnan(c)) || any(isinf(c));
        outputColor = vec4(bad ? vec3(0.0) : min(c, vec3(12.0)), bad ? 1.0 : inputColor.a); // cap also tames lacquer fireflies
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
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.86, 0.84), fog: false, toneMapped: false }),
    )
    m.scale.setScalar(34)
    return m
  }, [])
}

export default function Effects({ godRays = true, dof = true, sanitize = true, msaaOverride = null }) {
  const sun = useSunSource()
  const composer = useRef()
  const dofEffect = useRef()
  const dofPass = useRef(null)

  useFrame(({ camera }) => {
    if (godRays) {
      sun.position.copy(camera.position).addScaledVector(SUN_DIR, SUN_DISTANCE)
      sun.updateMatrixWorld()
    }

    // Depth of field only around the About stop. Elsewhere its pass is switched off
    // entirely, so it costs nothing.
    if (dofEffect.current && composer.current) {
      if (!dofPass.current || !composer.current.passes.includes(dofPass.current)) {
        dofPass.current = composer.current.passes.find((p) => p.effects?.includes(dofEffect.current)) || null
      }
      const w = 1 - THREE.MathUtils.smoothstep(Math.abs(motion.progress - 1), 0.15, 0.5)
      dofEffect.current.bokehScale = w * 2.0
      // Only toggle the pass if depth of field is the only effect in it.
      if (dofPass.current && dofPass.current.effects.length === 1) dofPass.current.enabled = w > 0.001
    }
  })

  // Depth of field needs hardware multisampling: without it the blur produces invalid
  // pixels that bloom spreads across the frame (black screen). 2x is half the old cost.
  // When depth of field is off, use cheaper SMAA instead.
  const msaa = msaaOverride ?? (dof ? 2 : 0)
  return (
    <EffectComposer ref={composer} multisampling={msaa} frameBufferType={THREE.HalfFloatType} autoClear={false}>
      {sanitize && <Sanitize />}
      {dof && <DepthOfField ref={dofEffect} target={PIANO_CENTRE.toArray()} focusRange={3.5} bokehScale={0} resolutionScale={0.5} />}
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
      {/* Second safety net: catches anything the depth-of-field or light-shaft passes produce. */}
      {sanitize && bloomEnabled && <Sanitize />}
      {bloomEnabled && <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.82} luminanceSmoothing={0.25} />}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {msaa === 0 && <SMAA />}
      <Vignette offset={0.3} darkness={0.55} />
      <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  )
}
