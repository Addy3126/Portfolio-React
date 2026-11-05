import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import Lenis from 'lenis'
import Overlay from './overlay/Overlay'
import PianoBar from './overlay/PianoBar'
import { enterPlay, exitPlay } from './piano/engine'
import usePianoKeyboard from './piano/usePianoKeyboard'
import { SECTIONS, motion } from './store'
import { debug, gpuLabel, hasWebGL, isWindows, qualitySource, reducedMotion, tier } from './quality'

// Renderer: the WebGPU scene where the browser has WebGPU, the WebGL scene otherwise (and if
// WebGPU fails to start or its device is lost). ?renderer=webgl / ?renderer=webgpu force one.
const ExperienceGPU = lazy(() => import('./gpu/ExperienceGPU'))
const ExperienceGL = lazy(() => import('./scene/Experience'))
const forced = new URLSearchParams(window.location.search).get('renderer')
// ?hud=1 (or ?stats=1): a readout of the renderer, the settled quality and how frames are
// doing, for checking performance on a real machine.
function Hud() {
  const [lines, setLines] = useState(['starting…'])
  useEffect(() => {
    const pct = (arr, p) => {
      if (!arr?.length) return null
      const a = [...arr].sort((x, y) => x - y)
      return a[Math.min(a.length - 1, Math.floor(a.length * p))]
    }
    const f = (v) => (v === null || v === undefined ? '–' : v.toFixed(1))
    const id = setInterval(() => {
      const p = window.__perf
      const c = window.__calibration
      const st = window.__stats
      const cv = document.querySelector('canvas')
      const iv = p?.intervals ?? []
      const fps = iv.length ? 1000 / pct(iv, 0.5) : null // median: one long pause doesn't skew it
      const budget = 1000 / (window.__pace?.fps ?? 60)
      const long = iv.filter((v) => v > budget * 1.6).length
      setLines([
        `${window.__backend ?? 'webgl'} · ${c ? `${c.tier} · ${Math.round(c.scale * 100)}%` : `${tier} · ${qualitySource}…`} · ${cv ? `${cv.width}×${cv.height}` : ''} · target ${Math.round(1000 / budget)} fps${window.__pace ? ` (${window.__pace.refresh} Hz ÷ ${window.__pace.every})` : ''}`,
        `${f(fps)} fps · frame ${f(pct(iv, 0.5))} / ${f(pct(iv, 0.95))} ms (p50/p95) · ${long} long of ${iv.length}`,
        `main thread ${f(pct(p?.cpu, 0.5))} / ${f(pct(p?.cpu, 0.95))} ms · GPU ${p?.gpu?.length ? `${f(pct(p.gpu, 0.5))} ms` : 'n/a (no timestamps)'}`,
        `${st ? `${st.calls} draws · ${(st.triangles / 1e6).toFixed(2)}M tris` : ''}${c ? ` · settled in ${(c.ms / 1000).toFixed(1)} s${c.steps.length ? `: ${c.steps.join(' → ')}` : ` (${qualitySource})`}` : ''}`,
        gpuLabel,
      ])
    }, 500)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 50, font: '11px/1.45 monospace', color: '#fff', background: 'rgba(0,0,0,.7)', padding: '6px 9px', borderRadius: 4, pointerEvents: 'none', maxWidth: 'calc(100vw - 24px)', whiteSpace: 'pre-wrap' }}>
      {lines.join('\n')}
    </div>
  )
}
async function pickRenderer() {
  if (forced === 'webgl' || forced === 'webgpu') return forced
  try {
    const adapter = await navigator.gpu?.requestAdapter(isWindows ? undefined : { powerPreference: 'high-performance' })
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
      {debug.hud && <Hud />}
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
