import { useCallback, useMemo, useRef, useState } from 'react'
import { texturesReady } from '../textureReady'
import { Canvas, extend, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { autoQualityEnabled, debug, grassEnabled, settingsFor, tier as startTier } from '../quality'
import CameraRig from '../scene/CameraRig'
import CursorField from '../scene/CursorField'
import Piano from '../scene/Piano'
import Life from '../scene/Life'
import { Adaptive, FrameLimiter } from '../scene/Perf'
import { SUN_DIR, shared } from '../scene/world'
import EffectsGPU from './EffectsGPU'
import { FieldFlowersGPU, PetalsGPU } from './FlowersGPU'
import GrassGPU from './GrassGPU'
import GroundGPU from './GroundGPU'
import RocksGPU from './RocksGPU'
import { PlateauGPU, RuinsGPU } from './RuinsGPU'
import { PianoShadowGPU } from './shadow'
import SeaGPU, { REFLECTION_HIDDEN, seaSwap } from './SeaGPU'
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
    if (++frames.current === 3) texturesReady().then(onReady)
  })
  return null
}

// The piano's reflection capture: a cube view of the field and sky from the piano.
function captureEnvGPU(gl, scene, at) {
  const rt = new THREE.CubeRenderTarget(256, { type: THREE.HalfFloatType })
  const cam = new THREE.CubeCamera(0.3, 3000, rt)
  cam.position.copy(at)
  const sea = seaSwap.mesh
  const live = sea?.material
  if (sea) sea.material = seaSwap.plain
  cam.update(gl, scene)
  if (sea) sea.material = live
  return rt
}

async function createRenderer(props) {
  const renderer = new THREE.WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', stencil: false })
  await renderer.init()
  // Which backend actually came up (for the debug overlay and tests).
  window.__backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  return renderer
}

export default function ExperienceGPU({ hovered, selected, onHover, onSelect, onReady, onFail }) {
  // If WebGPU can't start, its device is lost later (driver reset), or the GPU runs out of
  // memory, hand over to the WebGL scene instead of leaving a blank or frozen canvas.
  const failRef = useRef(onFail)
  failRef.current = onFail
  const gl = useCallback(async (props) => {
    const fail = (why, detail) => {
      console.warn(`WebGPU ${why}, switching to WebGL:`, detail)
      failRef.current?.()
    }
    let r
    try {
      r = await createRenderer(props)
    } catch (e) {
      fail('failed to start', e)
      throw e
    }
    // Tearing down a renderer whose device is gone can throw; nothing is left to free.
    const dispose = r.dispose.bind(r)
    r.dispose = () => {
      try {
        dispose()
      } catch {
        /* device already lost */
      }
    }
    r.onDeviceLost = (info) => {
      if (info?.reason !== 'destroyed') fail('device lost', info?.message) // 'destroyed': our own teardown
    }
    const device = r.backend.device
    device?.addEventListener('uncapturederror', (e) => {
      if (e.error?.constructor?.name === 'GPUOutOfMemoryError') fail('out of memory', e.error.message)
    })
    const onRejection = (e) => {
      if (/popErrorScope|GPUDevice/.test(String(e.reason?.message ?? e.reason))) fail('error', e.reason?.message)
    }
    const onError = (e) => /GPUDevice/.test(e.message) && fail('error', e.message)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    const d2 = r.dispose
    r.dispose = () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
      d2()
    }
    return r
  }, [])
  const [tier, setTier] = useState(startTier)
  const q = useMemo(() => settingsFor(tier), [tier])
  return (
    <Canvas
      className="scene"
      frameloop={debug.fps === 0 ? 'always' : 'demand'}
      dpr={q.dpr}
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={gl}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.NeutralToneMapping
        camera.layers.enable(REFLECTION_HIDDEN) // grass and flowers: seen, but not reflected
      }}
      onPointerMissed={() => onSelect(null)}
    >
      {debug.fps > 0 && <FrameLimiter fps={debug.fps} />}
      {autoQualityEnabled && debug.fps > 0 && <Adaptive tier={tier} onTier={setTier} startTier={startTier} baseDpr={q.dpr[1]} />}
      <Clock onReady={onReady} />
      <CameraRig />
      <CursorField />
      {debug.shadow && <PianoShadowGPU />}

      <hemisphereLight args={['#8f86c8', '#20255e', 1.2]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <directionalLight position={[-6, 4, 12]} color="#8a8fe0" intensity={0.9} />
      <pointLight position={[-1.45, 0.35, 4.3]} color="#6f9bff" intensity={1.4} distance={4} decay={2} />

      <SkyGPU />
      <SeaGPU reflection={debug.reflection ? q.reflection : 0} />
      <GroundGPU />
      {grassEnabled && <GrassGPU density={q.grassDensity} hiDist={q.grassHi} loDist={q.grassLo} />}
      {grassEnabled && <FieldFlowersGPU />}
      {debug.flowers && <PetalsGPU count={q.petals} />}
      <RocksGPU />
      <PlateauGPU />
      <RuinsGPU hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />
      <Piano captureEnv={captureEnvGPU} />
      {debug.life && <Life />}

      <EffectsGPU godRays={q.godRays && debug.godRays} gradeOn={debug.grade} ao={q.ao && debug.ao} aoFull={tier === 'ultra'} contact={q.contact && debug.contact} flare={debug.flare} />
    </Canvas>
  )
}
