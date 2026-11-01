import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { bloomEnabled, quality } from '../quality'
import CameraRig from './CameraRig'
import Grass from './Grass'
import Ground from './Ground'
import Petals from './Petals'
import Piano from './Piano'
import Ruins from './Ruins'
import Sea from './Sea'
import Sky from './Sky'
import { SUN_DIR, shared } from './world'

function Clock({ onReady }) {
  const frames = useRef(0)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    shared.uTime.value = t
    shared.uGlowPulse.value = 1 + 0.3 * Math.sin((t * Math.PI * 2) / 8)
    if (++frames.current === 3) onReady()
  })
  return null
}

export default function Experience({ hovered, selected, onHover, onSelect, onReady }) {
  return (
    <Canvas
      className="scene"
      dpr={quality.dpr}
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      onPointerMissed={() => onSelect(null)}
    >
      <Clock onReady={onReady} />
      <CameraRig />

      <hemisphereLight args={['#8f86c8', '#20255e', 1.2]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <directionalLight position={[-6, 4, 12]} color="#8a8fe0" intensity={0.9} />
      <pointLight position={[-1.45, 0.35, 4.3]} color="#6f9bff" intensity={1.4} distance={4} decay={2} />

      <Sky />
      <Sea />
      <Ground />
      <Grass count={quality.grass} />
      <Petals count={quality.petals} />
      <Ruins hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />
      <Piano />

      <EffectComposer multisampling={quality.multisampling} frameBufferType={THREE.HalfFloatType}>
        {bloomEnabled && <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.82} luminanceSmoothing={0.25} />}
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <Vignette offset={0.3} darkness={0.55} />
        <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
    </Canvas>
  )
}
