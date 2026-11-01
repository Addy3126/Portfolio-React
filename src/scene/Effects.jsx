import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Bloom, DepthOfField, EffectComposer, GodRays, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, KernelSize, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { bloomEnabled, quality, reducedMotion } from '../quality'
import { motion } from '../store'
import { PIANO_CENTRE, SUN_DIR } from './world'

const SUN_DISTANCE = 1400

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

export default function Effects() {
  const full = quality.effects === 'full'
  const sun = useSunSource()
  const dof = useRef()
  const rays = useRef()

  useFrame(({ camera }) => {
    sun.position.copy(camera.position).addScaledVector(SUN_DIR, SUN_DISTANCE)
    sun.updateMatrixWorld()

    // Depth of field only around the About stop, focused on the piano.
    if (dof.current) {
      const w = 1 - THREE.MathUtils.smoothstep(Math.abs(motion.progress - 1), 0.15, 0.5)
      dof.current.bokehScale = w * 2.0
    }
  })

  return (
    <EffectComposer multisampling={quality.multisampling} frameBufferType={THREE.HalfFloatType} autoClear={false}>
      {full && (
        <DepthOfField ref={dof} target={PIANO_CENTRE.toArray()} focusRange={3.5} bokehScale={0} resolutionScale={0.5} />
      )}
      {full && (
        <GodRays
          ref={rays}
          sun={sun}
          samples={reducedMotion ? 30 : 48}
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
      {bloomEnabled && <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.82} luminanceSmoothing={0.25} />}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.3} darkness={0.55} />
      <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  )
}
