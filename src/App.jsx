import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import Lenis from 'lenis'
import Overlay from './overlay/Overlay'
import PianoBar from './overlay/PianoBar'
import { enterPlay, exitPlay } from './piano/engine'
import usePianoKeyboard from './piano/usePianoKeyboard'
import { SECTIONS, motion } from './store'
import { hasWebGL, reducedMotion } from './quality'

// Renderer: the WebGPU scene where the browser has WebGPU, the WebGL scene otherwise (and if
// WebGPU fails to start or its device is lost). ?renderer=webgl / ?renderer=webgpu force one.
const ExperienceGPU = lazy(() => import('./gpu/ExperienceGPU'))
const ExperienceGL = lazy(() => import('./scene/Experience'))
const forced = new URLSearchParams(window.location.search).get('renderer')
const hud = new URLSearchParams(window.location.search).get('hud') === '1'

// ?hud=1: a small readout of the renderer, quality tier, render scale and frame time.
function Hud() {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const a = window.__adaptive
      setText(`${window.__backend ?? 'webgl'} · ${a ? `${a.tier} · ${Math.round(a.scale * 100)}% · ${a.avg} ms` : 'measuring…'}`)
    }, 500)
    return () => clearInterval(id)
  }, [])
  return <div style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 50, font: '12px monospace', color: '#fff', background: 'rgba(0,0,0,.55)', padding: '4px 8px', borderRadius: 4, pointerEvents: 'none' }}>{text}</div>
}
async function pickRenderer() {
  if (forced === 'webgl' || forced === 'webgpu') return forced
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    return adapter ? 'webgpu' : 'webgl'
  } catch {
    return 'webgl'
  }
}
const webgl = hasWebGL()

export default function App() {
  const [ready, setReady] = useState(!webgl)
  const [hovered, setHovered] = useState(null)
  const [selected, setSelected] = useState(null)
  const lenis = useRef(null)
  // Seated at the piano: page scrolling stops, the camera moves to the keys and the piano
  // controls replace the panels.
  const [playing, setPlaying] = useState(false)
  const startPlaying = useCallback(() => {
    enterPlay()
    lenis.current?.stop()
    document.documentElement.classList.add('at-piano')
    document.activeElement?.blur?.()
    setPlaying(true)
  }, [])
  const stopPlaying = useCallback(() => {
    exitPlay()
    lenis.current?.start()
    document.documentElement.classList.remove('at-piano')
    setPlaying(false)
  }, [])
  usePianoKeyboard(playing, stopPlaying)
  const [renderer, setRenderer] = useState(null)
  // Take the loader out once its fade has had time to run: a CSS transition can stall when
  // the page is busy compiling shaders, and a timer still fires.
  const [loaderGone, setLoaderGone] = useState(false)
  useEffect(() => {
    if (!ready) return
    const id = setTimeout(() => setLoaderGone(true), 1800)
    return () => clearTimeout(id)
  }, [ready])
  useEffect(() => {
    if (webgl) pickRenderer().then(setRenderer)
  }, [])
  const Experience = renderer === 'webgpu' ? ExperienceGPU : ExperienceGL

  useEffect(() => {
    const l = new Lenis({ lerp: reducedMotion ? 1 : 0.075, wheelMultiplier: 0.9 })
    lenis.current = l
    const onScroll = ({ scroll, limit }) => {
      motion.progress = limit > 0 ? (scroll / limit) * (SECTIONS.length - 1) : 0
    }
    l.on('scroll', onScroll)
    onScroll({ scroll: window.scrollY, limit: document.documentElement.scrollHeight - window.innerHeight })
    let raf
    const loop = (t) => {
      l.raf(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onPointer = (e) => {
      motion.pointerX = (e.clientX / window.innerWidth) * 2 - 1
      motion.pointerY = -((e.clientY / window.innerHeight) * 2 - 1)
      motion.pointerMovedAt = performance.now()
      motion.pointerInside = e.pointerType === 'mouse'
    }
    const onLeave = () => (motion.pointerInside = false)
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('pointermove', onPointer)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      l.destroy()
    }
  }, [])

  useEffect(() => {
    document.body.style.cursor = hovered !== null ? 'pointer' : ''
  }, [hovered])

  const goTo = useCallback((i) => {
    const limit = document.documentElement.scrollHeight - window.innerHeight
    const y = (limit * i) / (SECTIONS.length - 1)
    if (lenis.current) lenis.current.scrollTo(y, { duration: reducedMotion ? 0 : 2.4 })
    else window.scrollTo(0, y)
  }, [])

  return (
    <>
      {webgl ? (
        <Suspense fallback={null}>
          {renderer && (
            <Experience
              hovered={hovered}
              selected={selected}
              onHover={setHovered}
              onSelect={setSelected}
              onReady={() => setReady(true)}
              onFail={() => setRenderer('webgl')}
            />
          )}
        </Suspense>
      ) : (
        <div className="scene fallback" role="img" aria-label="Twilight field with an empty grand piano" />
      )}
      {hud && <Hud />}
      {!loaderGone && (
      <div className={`loader ${ready ? 'done' : ''}`} aria-hidden={ready}>
        <span>Tuning the piano</span>
      </div>
      )}
      <Overlay
        goTo={goTo}
        hovered={hovered}
        selected={selected}
        onHover={setHovered}
        onSelect={setSelected}
        ready={ready}
        onPlay={webgl ? startPlaying : null}
      />
      {playing && <PianoBar onExit={stopPlaying} />}
      <div className="scroll-space" style={{ height: `${100 + (SECTIONS.length - 1) * 130}vh` }} />
    </>
  )
}
