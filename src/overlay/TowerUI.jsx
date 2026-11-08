import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { projects } from '../content'
import { back, focus, isPhone, leaveTower, nextTower, openProject, openingRect, toOpening, ui } from '../focus'
import { duck } from '../audio/ambient'
import { reducedMotion } from '../quality'

// What the page shows at a project tower (focus.js): the controls along the bottom, the
// project's text (on phones as a sheet under the tower; elsewhere for screen readers, the
// windows carry it on screen), and the live site in a panel at 80% of the screen.
// Also the hovered tower's name label in the Projects view (positioned by the scene).

export function useFocus() {
  const [f, setF] = useState({ project: focus.project, stage: focus.stage })
  useEffect(() => {
    focus.listeners.add(setF)
    return () => focus.listeners.delete(setF)
  }, [])
  return f
}

// Keys, wheel and swipes at a tower: Esc goes back a step, ← → move to the neighbouring
// tower, scrolling down goes closer (to the opening) and up goes back out.
function useTowerInput(active, stage) {
  useEffect(() => {
    if (!active) return
    let acc = 0
    let accAt = 0
    let lockUntil = 0
    const step = (dir) => {
      const now = performance.now()
      if (now < lockUntil) return
      lockUntil = now + 900
      if (dir > 0) {
        if (focus.stage === 'facade') toOpening()
      } else back()
    }
    const onWheel = (e) => {
      if (focus.stage === 'inside') return
      const now = performance.now()
      if (now - accAt > 250) acc = 0
      accAt = now
      acc += e.deltaY
      if (Math.abs(acc) > 60) {
        step(Math.sign(acc))
        acc = 0
      }
    }
    let y0 = null
    const onStart = (e) => (y0 = e.touches[0]?.clientY ?? null)
    const onEnd = (e) => {
      if (y0 === null || focus.stage === 'inside') return
      const dy = y0 - (e.changedTouches[0]?.clientY ?? y0)
      y0 = null
      if (Math.abs(dy) > 50 && !e.target.closest?.('.tower-card')) step(Math.sign(dy))
    }
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') back()
      else if (focus.stage !== 'inside' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) nextTower(e.key === 'ArrowRight' ? 1 : -1)
      else return
      e.preventDefault()
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('keydown', onKey)
    }
  }, [active, stage])
}

// The live site, growing out of the opening's place on screen into a panel at 80% of the
// screen (and shrinking back into it on the way out).
function Browser({ project, closing, onClosed }) {
  const p = projects[project]
  const panel = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const fromOpening = () => {
    const el = panel.current
    const r = el.getBoundingClientRect()
    if (!openingRect.valid || reducedMotion) return 'scale(0.96)'
    const sx = openingRect.w / r.width
    const sy = openingRect.h / r.height
    const dx = openingRect.x + openingRect.w / 2 - (r.left + r.width / 2)
    const dy = openingRect.y + openingRect.h / 2 - (r.top + r.height / 2)
    return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  }
  useLayoutEffect(() => {
    const el = panel.current
    el.style.transition = 'none'
    el.style.transform = fromOpening()
    el.style.opacity = '0.4'
    void el.offsetWidth
    el.style.transition = ''
    el.style.transform = 'none'
    el.style.opacity = '1'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!closing) return
    const el = panel.current
    el.style.transform = fromOpening()
    el.style.opacity = '0'
    const id = setTimeout(onClosed, reducedMotion ? 0 : 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing])
  useEffect(() => {
    duck('inside', true)
    return () => duck('inside', false)
  }, [])
  const host = new URL(p.link).host
  return (
    <div className={`browse ${closing ? 'closing' : ''}`}>
      <div className="browse-panel" ref={panel} role="dialog" aria-label={`${p.name}, live site`}>
        <div className="browse-bar">
          <button type="button" onClick={back}>
            <span aria-hidden="true">←</span> Tower
          </button>
          <span className="browse-url" title={p.link}>
            {host}
          </span>
          <a href={p.link} target="_blank" rel="noreferrer">
            New tab <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="browse-page">
          {!loaded && <p className="browse-wait">Opening {host}…</p>}
          <iframe
            src={p.link}
            title={p.name}
            onLoad={() => setLoaded(true)}
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            allow="fullscreen"
          />
        </div>
      </div>
    </div>
  )
}

export default function TowerUI({ hovered }) {
  const { project, stage } = useFocus()
  const at = project !== null
  useTowerInput(at, stage)
  const p = at ? projects[project] : null
  const phone = isPhone()

  // The panel stays mounted while it shrinks back into the opening.
  const [browsing, setBrowsing] = useState(null) // { project, closing }
  useEffect(() => {
    if (stage === 'inside') setBrowsing({ project, closing: false })
    else setBrowsing((b) => (b && !b.closing ? { ...b, closing: true } : b))
  }, [stage, project])

  const label = hovered !== null && hovered !== undefined ? projects[hovered] : null
  const newTab = p && (!p.embed || phone)
  return (
    <>
      <div className="tower-label" ref={(el) => (ui.label = el)} aria-hidden="true">
        {label && (
          <>
            <span className="num">{String(hovered + 1).padStart(2, '0')}</span> {label.name}
            <em>Click to walk up to it</em>
          </>
        )}
      </div>

      {at && stage !== 'inside' && (
        <>
          <section className="tower-card" aria-live="polite" aria-labelledby="tower-h" data-lenis-prevent>
            <p className="tower-num">
              {String(project + 1).padStart(2, '0')} / {String(projects.length).padStart(2, '0')}
            </p>
            <h2 id="tower-h">{p.name}</h2>
            <p>{p.summary}</p>
            <ul className="chips" aria-label="Built with">
              {p.stack.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
          <nav className="tower-bar" aria-label="Project">
            <button type="button" className="tb-back" onClick={leaveTower}>
              <span aria-hidden="true">←</span> Bay
            </button>
            <div className="tb-nav">
              <button type="button" onClick={() => nextTower(-1)} aria-label="Previous project">
                ‹
              </button>
              <span className="tb-name">{p.name}</span>
              <button type="button" onClick={() => nextTower(1)} aria-label="Next project">
                ›
              </button>
            </div>
            {newTab ? (
              <a className="tb-go" href={p.link} target="_blank" rel="noreferrer">
                {p.enterLabel} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <>
                <button type="button" className="tb-go" onClick={openProject}>
                  {p.enterLabel} <span aria-hidden="true">→</span>
                </button>
                <a className="tb-tab" href={p.link} target="_blank" rel="noreferrer">
                  New tab <span aria-hidden="true">↗</span>
                </a>
              </>
            )}
          </nav>
          {stage === 'facade' && !phone && <p className="tower-hint">Scroll or click the opening to look closer · ← → next tower · Esc to go back</p>}
        </>
      )}

      {browsing && <Browser key={browsing.project} project={browsing.project} closing={browsing.closing} onClosed={() => setBrowsing(null)} />}
    </>
  )
}
