// Walking up to a project tower ("focus"): which tower, how close, and what each part of the
// site needs to know about it. Mutable and read every frame by the scene (like store.motion);
// the overlay subscribes for re-renders.
//
// Stages, nearest last:
//   facade   in front of the tower, its windows carrying the project
//   opening  close on the broken-out opening, where a preview of the site plays
//   inside   the live site in a panel over the scene (desktop, sites that allow it)
import { projects } from './content'

export const focus = {
  project: null, // index into content.projects, or null at the bay
  stage: null,
  from: null, // the stage `inside` returns to
  arrivedAt: 0, // performance.now() when the camera reached the current stop (0: still moving)
  listeners: new Set(),
}

// Per project tower, filled in by the scene once its building is made (world space): the
// face's centre, width and band of floors carrying the project, and the opening.
export const facades = new Map()

// Screen rectangle of the focused tower's opening (CSS pixels), kept current by the scene,
// so the browsing panel can grow out of it.
export const openingRect = { x: 0, y: 0, w: 0, h: 0, valid: false }

// DOM the scene positions each frame: the hovered tower's name label (set by the overlay).
export const ui = { label: null }

// The visitor's own screen: phones open sites in a new tab rather than in the panel.
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 600px), (pointer: coarse) and (max-width: 900px)').matches

const STORE = 'nocturne-visited'
const visited = new Set(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '[]')
    } catch {
      return []
    }
  })(),
)
export const isVisited = (i) => visited.has(projects[i]?.slug)

function emit() {
  focus.listeners.forEach((fn) => fn({ project: focus.project, stage: focus.stage }))
}

function set(project, stage) {
  if (focus.project === project && focus.stage === stage) return
  if (stage === 'inside') focus.from = focus.stage
  focus.project = project
  focus.stage = stage
  focus.arrivedAt = 0
  if (project !== null) {
    visited.add(projects[project].slug)
    try {
      localStorage.setItem(STORE, JSON.stringify([...visited]))
    } catch {
      /* storage unavailable: remembered for this visit only */
    }
  }
  emit()
}

export const enterTower = (i) => set(i, 'facade')
export const leaveTower = () => set(null, null)
export const toOpening = () => focus.project !== null && set(focus.project, 'opening')
// Open the project: in the panel where the site allows it (not on phones), else a new tab.
export function openProject() {
  if (focus.project === null) return
  const p = projects[focus.project]
  if (p.embed && !isPhone()) set(focus.project, 'inside')
  else window.open(p.link, '_blank', 'noopener')
}
// One step back: inside → where it came from, opening → facade, facade → the bay.
export function back() {
  if (focus.stage === 'inside') set(focus.project, focus.from === 'opening' ? 'opening' : 'facade')
  else if (focus.stage === 'opening') set(focus.project, 'facade')
  else if (focus.stage === 'facade') leaveTower()
}
export function nextTower(dir) {
  if (focus.project === null) return
  set((focus.project + dir + projects.length) % projects.length, 'facade')
}
