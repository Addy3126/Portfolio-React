import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import Lenis from 'lenis'
import Overlay from './overlay/Overlay'
import { SECTIONS, motion } from './store'
import { hasWebGL, reducedMotion } from './quality'

const Experience = lazy(() => import('./scene/Experience'))
const webgl = hasWebGL()

export default function App() {
  const [ready, setReady] = useState(!webgl)
  const [hovered, setHovered] = useState(null)
  const [selected, setSelected] = useState(null)
  const lenis = useRef(null)

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
          <Experience
            hovered={hovered}
            selected={selected}
            onHover={setHovered}
            onSelect={setSelected}
            onReady={() => setReady(true)}
          />
        </Suspense>
      ) : (
        <div className="scene fallback" role="img" aria-label="Twilight field with an empty grand piano" />
      )}
      <div className={`loader ${ready ? 'done' : ''}`} aria-hidden={ready}>
        <span>Tuning the piano</span>
      </div>
      <Overlay
        goTo={goTo}
        hovered={hovered}
        selected={selected}
        onHover={setHovered}
        onSelect={setSelected}
        ready={ready}
      />
      <div className="scroll-space" style={{ height: `${100 + (SECTIONS.length - 1) * 130}vh` }} />
    </>
  )
}
