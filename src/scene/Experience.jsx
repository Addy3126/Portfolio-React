import { useMemo, useRef, useState } from 'react'
import { texturesReady } from '../textureReady'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { autoQualityEnabled, debug, grassEnabled, settingsFor, tier as startTier } from '../quality'
import CameraRig from './CameraRig'
import CursorField from './CursorField'
import Effects from './Effects'
import FieldFlowers from './FieldFlowers'
import Grass from './Grass'
import Ground from './Ground'
import Life from './Life'
import ScannedRocks from './ScannedRocks'
import FillLight from './FillLight'
import PlayEffects from './PlayEffects'
import { Adaptive, FrameLimiter } from './Perf'
import Petals from './Petals'
import Piano from './Piano'
import BeachShadow from './BeachShadow'
import PianoShadow from './PianoShadow'
import Ruins from './Ruins'
import ShorePlants from './ShorePlants'
import Rocks from './Rocks'
import Sea from './Sea'
import Sky from './Sky'
import { SUN_DIR, shared } from './world'

// Debug: ?stats=1 exposes per-frame render counts as window.__stats.
const statsOn = new URLSearchParams(window.location.search).get('stats') === '1'
function Stats() {
  // Count the whole frame (all passes), not just the last render call.
  useFrame(({ gl }) => {
    gl.info.autoReset = false
    gl.info.reset()
  }, -1000)
  useFrame(({ gl }) => {
    window.__stats = { triangles: gl.info.render.triangles, calls: gl.info.render.calls }
  }, 1000)
  return null
}

function Clock({ onReady }) {
  const frames = useRef(0)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    shared.uTime.value = t
    shared.uGlowPulse.value = 1 + 0.3 * Math.sin((t * Math.PI * 2) / 8)
    if (++frames.current === 3) texturesReady().then(onReady)
  })
  return null
}

export default function Experience({ hovered, selected, onHover, onSelect, onReady }) {
  const [tier, setTier] = useState(startTier)
  const q = useMemo(() => settingsFor(tier), [tier])
  return (
    <Canvas
      className="scene"
      frameloop={debug.fps === 0 ? 'always' : 'demand'}
      dpr={q.dpr}
      shadows={q.rockShadows > 0}
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      onCreated={({ scene }) => {
        window.__backend = 'webgl'
        // Haze for the standard materials (scanned rocks, piano), matching the custom shaders' fog.
        scene.fog = new THREE.FogExp2(shared.uFogColor.value, shared.uFogDensity.value)
      }}
      onPointerMissed={() => onSelect(null)}
    >
      {debug.fps > 0 && <FrameLimiter fps={debug.fps} />}
      {autoQualityEnabled && debug.fps > 0 && <Adaptive tier={tier} onTier={setTier} startTier={startTier} baseDpr={q.dpr[1]} />}
      <Clock onReady={onReady} />
      {statsOn && <Stats />}
      <CameraRig />
      <CursorField />
      {debug.shadow && <PianoShadow />}
      {debug.shadow && <BeachShadow />}

      {/* Ground colour: light bounced up from the lavender field onto the piano. */}
      <hemisphereLight args={['#8f86c8', '#2c2a6c', 0.8]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <FillLight shadowSize={q.rockShadows} />
      <pointLight position={[-1.45, 0.35, 4.3]} color="#6f9bff" intensity={1.4} distance={4} decay={2} />

      <Sky />
      <Sea reflection={debug.reflection ? q.reflection : 0} reflectAll={q.reflectAll} />
      <Ground />
      {grassEnabled && <Grass density={q.grassDensity} hiDist={q.grassHi} loDist={q.grassLo} />}
      {grassEnabled && <FieldFlowers />}
      {grassEnabled && <ShorePlants />}
      {debug.flowers && <Petals count={q.petals} />}
      <Rocks />
      <ScannedRocks />
      <Ruins hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />
      <Piano />
      {debug.life && <Life />}
      <PlayEffects />

      <Effects godRays={q.godRays && debug.godRays} ao={q.ao && debug.ao} contact={q.contact && debug.contact} flare={debug.flare} grade={debug.grade} tm={debug.tm} sanitize={debug.sanitize} msaaOverride={debug.msaa} />
    </Canvas>
  )
}
