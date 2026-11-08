import { useCallback, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { debug, dprFor, grassEnabled, rockShadowSize, settingsFor, startScale, tier as startTier } from '../quality'
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
import { FrameLimiter, Probe, Startup } from './Perf'
import Petals from './Petals'
import Piano from './Piano'
import BeachShadow from './BeachShadow'
import PianoShadow from './PianoShadow'
import Ruins from './Ruins'
import ShorePlants from './ShorePlants'
import Rocks from './Rocks'
import Sea from './Sea'
import Sky from './Sky'
import { NEVER_REFLECTED, SUN_DIR, shared } from './world'

function Clock() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    shared.uTime.value = t
    shared.uGlowPulse.value = 1 + 0.3 * Math.sin((t * Math.PI * 2) / 8)
  })
  return null
}

export default function Experience({ hovered, selected, onHover, onSelect, onReady }) {
  // Settled by the calibration while the loading screen is up, then fixed (scene/Perf.jsx).
  const [{ tier, scale }, setQuality] = useState({ tier: startTier, scale: startScale })
  const q = useMemo(() => settingsFor(tier), [tier])
  const onQuality = useCallback((t, sc) => setQuality({ tier: t, scale: sc }), [])
  return (
    <Canvas
      className="scene"
      frameloop={debug.fps === 0 ? 'always' : 'demand'}
      dpr={dprFor(q, scale)}
      shadows={{ enabled: rockShadowSize > 0, type: THREE.PCFShadowMap }} // (three r186 has no PCFSoftShadowMap, R3F's choice for shadows={true})
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      onCreated={({ scene, camera, raycaster }) => {
        window.__backend = 'webgl'
        // What stands on the field behind the shore: seen, never reflected (the reflection's
        // camera only has layer 0). The pointer raycaster needs it too (the piano keys).
        camera.layers.enable(NEVER_REFLECTED)
        raycaster.layers.enable(NEVER_REFLECTED)
        // Haze for the standard materials (scanned rocks, piano), matching the custom shaders' fog.
        scene.fog = new THREE.FogExp2(shared.uFogColor.value, shared.uFogDensity.value)
      }}
      onPointerMissed={() => onSelect(null)}
    >
      {debug.fps !== 0 && <FrameLimiter fps={debug.fps} />}
      <Clock />
      <Startup tier={tier} scale={scale} onQuality={onQuality} onDone={onReady} />
      <Probe />
      <CameraRig />
      <CursorField />
      {debug.shadow && <PianoShadow />}
      {debug.shadow && <BeachShadow />}

      {/* Ground colour: light bounced up from the lavender field onto the piano. */}
      <hemisphereLight args={['#8f86c8', '#2c2a6c', 0.8]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <FillLight shadowSize={rockShadowSize} />
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
