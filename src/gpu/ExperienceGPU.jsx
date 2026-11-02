import { useRef } from 'react'
import { Canvas, extend, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { debug, grassEnabled, settingsFor } from '../quality'
import CameraRig from '../scene/CameraRig'
import CursorField from '../scene/CursorField'
import { FrameLimiter } from '../scene/Perf'
import { SUN_DIR, shared } from '../scene/world'
import EffectsGPU from './EffectsGPU'
import GrassGPU from './GrassGPU'
import GroundGPU from './GroundGPU'
import SeaGPU, { REFLECTION_HIDDEN } from './SeaGPU'
import SkyGPU from './SkyGPU'
import { sync } from './tsl'

// The WebGPU path (?renderer=webgpu). WebGPURenderer runs on WebGPU where the browser has
// it and falls back to WebGL2 on its own, and the TSL materials compile for either. It is
// built up here piece by piece until it matches the WebGL scene, then becomes the default.
extend(THREE)

function Clock({ onReady }) {
  const frames = useRef(0)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    shared.uTime.value = t
    shared.uGlowPulse.value = 1 + 0.3 * Math.sin((t * Math.PI * 2) / 8)
    sync()
    if (++frames.current === 3) onReady()
  })
  return null
}

async function createRenderer(props) {
  const renderer = new THREE.WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', stencil: false })
  await renderer.init()
  // Which backend actually came up (for the debug overlay and tests).
  window.__backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  return renderer
}

export default function ExperienceGPU({ onSelect, onReady }) {
  const q = settingsFor(0)
  return (
    <Canvas
      className="scene"
      frameloop={debug.fps === 0 ? 'always' : 'demand'}
      dpr={q.dpr}
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={createRenderer}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.NeutralToneMapping
        camera.layers.enable(REFLECTION_HIDDEN) // grass and flowers: seen, but not reflected
      }}
      onPointerMissed={() => onSelect(null)}
    >
      {debug.fps > 0 && <FrameLimiter fps={debug.fps} />}
      <Clock onReady={onReady} />
      <CameraRig />
      <CursorField />

      <hemisphereLight args={['#8f86c8', '#20255e', 1.2]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <directionalLight position={[-6, 4, 12]} color="#8a8fe0" intensity={0.9} />

      <SkyGPU />
      <SeaGPU reflection={debug.reflection ? q.reflection : 0} />
      <GroundGPU />
      {grassEnabled && <GrassGPU density={q.grassDensity} hiDist={q.grassHi} loDist={q.grassLo} />}

      <EffectsGPU godRays={q.godRays && debug.godRays} gradeOn={debug.grade} />
    </Canvas>
  )
}
