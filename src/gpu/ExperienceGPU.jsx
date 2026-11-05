import { useCallback, useMemo, useRef, useState } from 'react'
import { Canvas, extend, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { calibrate, debug, dprFor, grassEnabled, isWindows, rockShadowSize, settingsFor, startScale, tier as startTier } from '../quality'
import CameraRig from '../scene/CameraRig'
import CursorField from '../scene/CursorField'
import Piano from '../scene/Piano'
import ShorePlants from '../scene/ShorePlants'
import Life from '../scene/Life'
import ScannedRocks from '../scene/ScannedRocks'
import FillLight from '../scene/FillLight'
import './scanMaterial'
import PlayEffects from '../scene/PlayEffects'
import { FrameLimiter, Probe, Startup } from '../scene/Perf'
import { SUN_DIR, shared } from '../scene/world'
import EffectsGPU from './EffectsGPU'
import { FieldFlowersGPU, PetalsGPU } from './FlowersGPU'
import GrassGPU from './GrassGPU'
import GroundGPU from './GroundGPU'
import RocksGPU from './RocksGPU'
import { RuinsGPU } from './RuinsGPU'
import { BeachShadowGPU, PianoShadowGPU } from './shadow'
import SeaGPU, { NEVER_REFLECTED, REFLECTION_HIDDEN, seaSwap } from './SeaGPU'
import SkyGPU from './SkyGPU'
import { sync } from './tsl'

// The WebGPU path (?renderer=webgpu). WebGPURenderer runs on WebGPU where the browser has
// it and falls back to WebGL2 on its own, and the TSL materials compile for either. It is
// built up here piece by piece until it matches the WebGL scene, then becomes the default.
extend(THREE)

function Clock() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    shared.uTime.value = t
    shared.uGlowPulse.value = 1 + 0.3 * Math.sin((t * Math.PI * 2) / 8)
    sync()
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
  // GPU timestamps while calibrating (and for the ?hud=1 readout). The power preference is
  // ignored on Windows, where asking for it only logs a warning.
  const renderer = new THREE.WebGPURenderer({
    ...props,
    antialias: false,
    stencil: false,
    trackTimestamp: calibrate || debug.hud,
    ...(isWindows ? {} : { powerPreference: 'high-performance' }),
  })
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
  // Settled by the calibration while the loading screen is up, then fixed (scene/Perf.jsx).
  const [{ tier, scale }, setQuality] = useState({ tier: startTier, scale: startScale })
  const q = useMemo(() => settingsFor(tier), [tier])
  const onQuality = useCallback((t, sc) => setQuality({ tier: t, scale: sc }), [])
  return (
    <Canvas
      className="scene"
      frameloop={debug.fps === 0 ? 'always' : 'demand'}
      dpr={dprFor(q, scale)}
      shadows={{ enabled: rockShadowSize > 0, type: THREE.PCFShadowMap }} // (a boolean makes R3F pick PCFSoftShadowMap, which WebGPU lacks)
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={gl}
      onCreated={({ gl, camera, scene, raycaster }) => {
        gl.toneMapping = THREE.NeutralToneMapping
        // Haze for the standard materials (scanned rocks, piano), matching the custom shaders' fog.
        scene.fog = new THREE.FogExp2(shared.uFogColor.value, shared.uFogDensity.value)
        camera.layers.enable(REFLECTION_HIDDEN) // grass and flowers: seen, but not reflected
        camera.layers.enable(NEVER_REFLECTED) // the field: seen, never reflected
        raycaster.layers.enable(NEVER_REFLECTED) // (the piano keys are on it)
      }}
      onPointerMissed={() => onSelect(null)}
    >
      {debug.fps !== 0 && <FrameLimiter fps={debug.fps} />}
      <Clock />
      <Startup tier={tier} scale={scale} onQuality={onQuality} onDone={onReady} />
      <Probe />
      <CameraRig />
      <CursorField />
      {debug.shadow && <PianoShadowGPU />}
      {debug.shadow && <BeachShadowGPU />}

      {/* Ground colour: light bounced up from the lavender field onto the piano. */}
      <hemisphereLight args={['#8f86c8', '#2c2a6c', 0.8]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <FillLight shadowSize={rockShadowSize} />
      <pointLight position={[-1.45, 0.35, 4.3]} color="#6f9bff" intensity={1.4} distance={4} decay={2} />

      <SkyGPU />
      <SeaGPU reflection={debug.reflection ? q.reflection : 0} reflectAll={q.reflectAll} />
      <GroundGPU />
      {grassEnabled && <GrassGPU density={q.grassDensity} hiDist={q.grassHi} loDist={q.grassLo} />}
      {grassEnabled && <FieldFlowersGPU />}
      {grassEnabled && <ShorePlants />}
      {debug.flowers && <PetalsGPU count={q.petals} />}
      <RocksGPU />
      <ScannedRocks />
      <RuinsGPU hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />
      <Piano captureEnv={captureEnvGPU} />
      {debug.life && <Life />}
      <PlayEffects />

      <EffectsGPU godRays={q.godRays && debug.godRays} gradeOn={debug.grade} ao={q.ao && debug.ao} aoFull={tier === 'ultra'} contact={q.contact && debug.contact} flare={debug.flare} />
    </Canvas>
  )
}
