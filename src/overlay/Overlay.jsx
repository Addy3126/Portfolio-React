import { useEffect, useRef, useState } from 'react'
import { about, contact, projects, site } from '../content'
import { SECTIONS, motion } from '../store'
import useLocalTime from './useLocalTime'

// Each panel fades in around its camera stop.
function usePanelFades(refs, cue) {
  useEffect(() => {
    let raf
    const tick = () => {
      refs.current.forEach((el, i) => {
        if (!el) return
        const d = Math.abs(motion.progress - i)
        const o = 1 - smoothstep(0.18, 0.45, d)
        el.style.opacity = o.toFixed(3)
        el.style.transform = `translateY(${((motion.progress - i) * -24).toFixed(1)}px)`
        el.style.visibility = o < 0.01 ? 'hidden' : 'visible'
        el.dataset.active = o > 0.5 ? 'true' : 'false'
      })
      if (cue.current) cue.current.style.opacity = (1 - smoothstep(0.02, 0.2, motion.progress)).toFixed(3)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [refs, cue])
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export default function Overlay({ goTo, hovered, selected, onHover, onSelect, ready }) {
  const panels = useRef([])
  const cue = useRef(null)
  usePanelFades(panels, cue)
  const time = useLocalTime(site.timeZone)
  const [copied, setCopied] = useState(false)
  const active = selected ?? hovered
  const project = active !== null && active !== undefined ? projects[active] : null

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(contact.email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable: the address is still visible and selectable */
    }
  }

  return (
    <>
      <header className="topbar">
        <button className="brand" onClick={() => goTo(0)} aria-label="Back to top">
          AS
        </button>
        <nav aria-label="Sections">
          {SECTIONS.slice(1).map((s, i) => (
            <button key={s} onClick={() => goTo(i + 1)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </nav>
        <dl className="status">
          <div>
            <dt>Local time</dt>
            <dd>{time} IST</dd>
          </div>
          <div>
            <dt>Based in</dt>
            <dd>{site.location}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{site.status}</dd>
          </div>
        </dl>
      </header>

      <section ref={(el) => (panels.current[0] = el)} className={`panel landing ${ready ? 'in' : ''}`} aria-label="Intro">
        <h1>{site.name}</h1>
        <p className="tagline">{site.tagline}</p>
      </section>
      <div ref={cue} className="scroll-cue" aria-hidden="true">
        Scroll
      </div>

      <section ref={(el) => (panels.current[1] = el)} className="panel about" aria-labelledby="about-h">
        <h2 id="about-h">{about.heading}</h2>
        <p>{about.body}</p>
        {/* Skills float above the piano's music stand in the scene; this list is for screen readers. */}
        <ul className="sr-only" aria-label="Skills">
          {about.skills.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section ref={(el) => (panels.current[2] = el)} className="panel projects" aria-labelledby="projects-h">
        <div className="project-list">
          <h2 id="projects-h">Projects</h2>
          <p className="hint">Hover a lit tower, or pick one here.</p>
          <ol>
            {projects.map((p, i) => (
              <li key={p.name}>
                <button
                  aria-pressed={selected === i}
                  className={active === i ? 'on' : ''}
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(i)}
                  onBlur={() => onHover(null)}
                  onClick={() => onSelect(selected === i ? null : i)}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <article className={`project-detail ${project ? 'show' : ''}`} aria-live="polite">
          {project && (
            <>
              <h3>{project.name}</h3>
              <p>{project.summary}</p>
              <ul className="chips">
                {project.stack.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <a href={project.link} target="_blank" rel="noreferrer">
                View project
              </a>
            </>
          )}
        </article>
      </section>

      <section ref={(el) => (panels.current[3] = el)} className="panel contact" aria-labelledby="contact-h">
        <h2 id="contact-h">{contact.heading}</h2>
        <div className="email">
          <span>{contact.email}</span>
          <button onClick={copyEmail}>{copied ? 'Copied' : 'Copy email'}</button>
        </div>
        <ul className="links">
          {contact.links.map((l) => (
            <li key={l.label}>
              <a href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="footer">© {new Date().getFullYear()} {site.name}</p>
      </section>
    </>
  )
}
