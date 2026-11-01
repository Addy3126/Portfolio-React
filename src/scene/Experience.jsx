import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { autoQualityEnabled, debug, grassEnabled, settingsFor } from '../quality'
import CameraRig from './CameraRig'
import CursorField from './CursorField'
import Effects from './Effects'
import FieldFlowers from './FieldFlowers'
import Grass from './Grass'
import Ground from './Ground'
import { AutoQuality, FrameLimiter } from './Perf'
import Petals from './Petals'
import Piano from './Piano'
import PianoShadow from './PianoShadow'
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
  const [level, setLevel] = useState(0)
  const q = useMemo(() => settingsFor(level), [level])
  return (
    <Canvas
      className="scene"
      frameloop={debug.fps === 0 ? 'always' : 'demand'}
      dpr={q.dpr}
      camera={{ fov: 42, near: 0.1, far: 3000, position: [0, 1, 9] }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      onPointerMissed={() => onSelect(null)}
    >
      {debug.fps > 0 && <FrameLimiter fps={debug.fps} />}
      {autoQualityEnabled && debug.fps > 0 && <AutoQuality level={level} onLevel={setLevel} fps={debug.fps} />}
      <Clock onReady={onReady} />
      <CameraRig />
      <CursorField />
      {debug.shadow && <PianoShadow />}

      <hemisphereLight args={['#8f86c8', '#20255e', 1.2]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100)} color="#f5c8d0" intensity={2.2} />
      <directionalLight position={[-6, 4, 12]} color="#8a8fe0" intensity={0.9} />
      <pointLight position={[-1.45, 0.35, 4.3]} color="#6f9bff" intensity={1.4} distance={4} decay={2} />

      <Sky />
      <Sea reflection={debug.reflection ? q.reflection : 0} />
      <Ground />
      {grassEnabled && <Grass count={q.grassNear} layer="near" />}
      {grassEnabled && <Grass count={q.grassFar} layer="far" />}
      {grassEnabled && <FieldFlowers />}
      {debug.flowers && <Petals count={q.petals} />}
      <Ruins hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />
      <Piano />

      <Effects godRays={q.godRays && debug.godRays} dof={q.dof && debug.dof} sanitize={debug.sanitize} msaaOverride={debug.msaa} />
    </Canvas>
  )
}
