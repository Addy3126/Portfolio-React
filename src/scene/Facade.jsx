import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { projects } from '../content'
import { facades, focus, isPhone, openProject, openingRect, toOpening, ui } from '../focus'
import { uiSound } from '../audio/ambient'
import { reducedMotion } from '../quality'
import { inProjects } from './projectsGate'

// A project tower's front face as the page for its project (see focus.js): when the camera
// has walked up to the tower its windows switch on one by one, in reading order, with a
// fluorescent stutter. Top floor: name, pitch, status; the floors around the opening and
// below it: the project's facts; the brightest window opens the project. In the broken-out
// opening a capture of the site scrolls slowly from top to bottom and back.
// Everything here is in the building's own space (it renders inside the tower's group).

const TILE_W = 256
const INK = '#2b1a0e'
const FONT = "'Figtree', 'Segoe UI', system-ui, sans-serif"

// Which windows carry what. Reading order: rows above the top as needed, the top row, the
// columns either side of the opening (top floor first), then the bottom row, whose last
// window is the way in.
function layout(fc, count) {
  const n = fc.cols.length
  const { f0, f1, c0, c1 } = fc.open
  const has = (c, f) => f <= fc.tops[c]
  const row = (f) => fc.cols.map((_, c) => ({ c, f })).filter(({ c, f: ff }) => has(c, ff))
  const sides = []
  for (let f = f1; f >= f0; f--) for (let c = 0; c < n; c++) if ((c < c0 || c > c1) && has(c, f)) sides.push({ c, f })
  const bottom = row(f0 - 1)
  const enter = bottom.pop()
  let extra = 0
  while (row(f1 + 1).length + sides.length + bottom.length + extra * n < count && extra < 4) extra++
  const above = []
  for (let r = extra; r >= 1; r--) above.push(...row(f1 + 1 + r))
  return { cells: [...above, ...row(f1 + 1), ...sides, ...bottom].slice(0, count), enter, topRow: row(f1 + 1 + extra).length }
}

// Wraps text into lines no wider than `w` at the context's current font.
function wrap(ctx, text, w) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word
    if (ctx.measureText(t).width > w && line) {
      lines.push(line)
      line = word
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

// Fits a block of text into the tile, shrinking the type until it does.
function block(ctx, text, { weight, size, w, h, lineH = 1.16 }) {
  for (let s = size; s >= 12; s -= 1) {
    ctx.font = `${weight} ${s}px ${FONT}`
    const lines = text.split('\n').flatMap((p) => wrap(ctx, p, w))
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width))
    if (lines.length * s * lineH <= h && width <= w) return { lines, size: s, lineH }
  }
  return { lines: [text], size: 12, lineH }
}

function drawTile(ctx, x, y, w, h, item) {
  ctx.save()
  ctx.translate(x, y)
  const bright = item.kind === 'enter'
  const g = ctx.createLinearGradient(0, 0, w * 0.35, h)
  g.addColorStop(0, bright ? '#ffffff' : '#fff8ec')
  g.addColorStop(0.6, bright ? '#fff6e6' : '#ffe6bf')
  g.addColorStop(1, bright ? '#ffe2b4' : '#ffd59a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Light falls off toward the frame.
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, 'rgba(140,70,10,0)')
  v.addColorStop(1, 'rgba(140,70,10,0.16)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const pad = w * 0.07
  const inner = w - pad * 2
  const parts = []
  if (item.label) parts.push({ text: item.label.toUpperCase(), weight: 600, size: 24, spacing: 2, alpha: 0.6 })
  if (item.kind === 'title') parts.push({ text: item.text, weight: 600, size: 60 })
  else if (item.kind === 'enter') parts.push({ text: item.text, weight: 600, size: 52 }, { text: item.arrow, weight: 500, size: 60 })
  else parts.push({ text: item.text, weight: 500, size: item.kind === 'pitch' ? 46 : 44 })
  // Lay the parts out top to bottom, centred as a group.
  const gap = h * 0.04
  const room = h - pad * 2 - gap * (parts.length - 1)
  const fitted = parts.map((p, i) => {
    const share = parts.length === 1 ? 1 : i === 0 && item.label ? 0.2 : item.kind === 'enter' ? (i === 0 ? 0.55 : 0.4) : 0.8
    return { ...p, ...block(ctx, p.text, { weight: p.weight, size: p.size, w: inner, h: room * share }) }
  })
  const total = fitted.reduce((a, f) => a + f.lines.length * f.size * f.lineH, 0) + gap * (fitted.length - 1)
  let cy = (h - total) / 2
  for (const f of fitted) {
    ctx.font = `${f.weight} ${f.size}px ${FONT}`
    ctx.globalAlpha = f.alpha ?? 1
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${f.spacing ?? 0}px`
    for (const l of f.lines) {
      cy += f.size * f.lineH
      ctx.fillText(l, w / 2, cy - f.size * (f.lineH - 1) - f.size * 0.12)
    }
    cy += gap
  }
  ctx.restore()
}

// The window's stutter as a tube catches: on and off a few times, then steady.
const STUTTER = [
  [0, 0],
  [0.1, 0.8],
  [0.18, 0.06],
  [0.3, 0.92],
  [0.38, 0.22],
  [0.52, 1],
]
function flicker(x) {
  if (x <= 0) return 0
  let v = 0
  for (const [t, a] of STUTTER) if (x >= t) v = a
  return v
}
const STEP = 0.3 // seconds between windows
const LEAD = 0.25

export default function Facade({ project, fc, origin, towerTop, hovered }) {
  const p = projects[project]
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const group = useRef()
  const panes = useRef()
  const enterMesh = useRef()
  const screen = useRef()

  const items = useMemo(() => {
    const list = [
      { kind: 'title', label: `${String(project + 1).padStart(2, '0')} / ${String(projects.length).padStart(2, '0')}`, text: p.name },
      { kind: 'pitch', text: p.pitch },
      { kind: 'fact', label: p.status[0], text: p.status[1] },
      ...p.facts.map(([label, text]) => ({ kind: 'fact', label, text: text.replaceAll(' · ', '\n') })),
    ]
    return list
  }, [p, project])
  const plan = useMemo(() => layout(fc, items.length), [fc, items.length])

  // The text, drawn once into one texture: a tile per window.
  const tileH = Math.round((TILE_W * fc.winH) / fc.winW)
  const atlas = useMemo(() => {
    const cols = 4
    const rows = Math.ceil((items.length + 1) / cols)
    const canvas = document.createElement('canvas')
    canvas.width = TILE_W * cols
    canvas.height = tileH * rows
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    tex.userData.cols = cols
    tex.userData.rows = rows
    return tex
  }, [items.length, tileH])
  useEffect(() => {
    let live = true
    const draw = () => {
      if (!live) return
      const canvas = atlas.image
      const ctx = canvas.getContext('2d')
      const cols = atlas.userData.cols
      const all = [...items, { kind: 'enter', text: p.enterLabel, arrow: p.embed && !isPhone() ? '→' : '↗' }]
      all.forEach((it, i) => drawTile(ctx, (i % cols) * TILE_W, Math.floor(i / cols) * tileH, TILE_W, tileH, it))
      atlas.needsUpdate = true
    }
    // Draw with the site's typeface once it has loaded (and again if it arrives later).
    Promise.all([document.fonts.load(`600 38px ${FONT}`), document.fonts.load(`500 30px ${FONT}`)])
      .catch(() => {})
      .then(draw)
    return () => {
      live = false
    }
  }, [atlas, items, p, tileH])
  useEffect(() => () => atlas.dispose(), [atlas])

  // One quad per window, mapped to its tile; a vertex colour carries each window's light.
  const uvOf = (i) => {
    const { cols, rows } = atlas.userData
    const u0 = (i % cols) / cols
    const v1 = 1 - Math.floor(i / cols) / rows
    return [u0, v1 - 1 / rows, u0 + 1 / cols, v1]
  }
  const quad = (cell, i) => {
    const x = fc.cols[cell.c]
    const y = fc.floorY(cell.f)
    const w = fc.winW / 2
    const h = fc.winH / 2
    const z = fc.paneZ
    const [u0, v0, u1, v1] = uvOf(i)
    return {
      pos: [x - w, y - h, z, x + w, y - h, z, x + w, y + h, z, x - w, y + h, z],
      uv: [u0, v0, u1, v0, u1, v1, u0, v1],
    }
  }
  const paneGeo = useMemo(() => {
    const pos = []
    const uv = []
    const idx = []
    plan.cells.forEach((cell, i) => {
      const q = quad(cell, i)
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
      pos.push(...q.pos)
      uv.push(...q.uv)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
    g.setIndex(idx)
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, atlas])
  const enterGeo = useMemo(() => {
    const q = quad(plan.enter, items.length)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(q.uv, 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, atlas, items.length])
  const o = fc.open
  const screenGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(o.x1 - o.x0, o.y1 - o.y0)
    g.translate((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.z)
    return g
  }, [o])
  useEffect(
    () => () => {
      paneGeo.dispose()
      enterGeo.dispose()
      screenGeo.dispose()
    },
    [paneGeo, enterGeo, screenGeo],
  )

  const mats = useMemo(
    () => ({
      panes: new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true }),
      enter: new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(0, 0, 0) }),
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) }),
    }),
    [atlas],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  // The opening's capture: loaded the first time the tower is hovered or walked up to.
  const strip = useRef(null)
  const wantStrip = useRef(false)
  const loadStrip = () => {
    if (wantStrip.current || !p.preview) return
    wantStrip.current = true
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}${p.preview}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      tex.generateMipmaps = true
      tex.minFilter = THREE.LinearMipmapLinearFilter
      strip.current = tex
      mats.screen.map = tex
      mats.screen.needsUpdate = true
    })
  }
  useEffect(() => () => strip.current?.dispose(), [])
  useEffect(() => {
    if (hovered === project) loadStrip()
  })

  // Where the camera stands, for CameraRig: the face, the band of floors carrying the
  // project, and the opening (world space).
  useEffect(() => {
    const ys = [...plan.cells, plan.enter].map((c) => fc.floorY(c.f))
    const lo = Math.min(...ys) - fc.winH / 2
    const hi = Math.max(...ys) + fc.winH / 2
    const w = fc.cols[fc.cols.length - 1] - fc.cols[0] + fc.winW
    facades.set(project, {
      center: new THREE.Vector3(origin.x, origin.y + (lo + hi) / 2, origin.z),
      width: w,
      height: hi - lo,
      frontZ: origin.z + fc.frontZ,
      opening: { center: new THREE.Vector3(origin.x + (o.x0 + o.x1) / 2, origin.y + (o.y0 + o.y1) / 2, origin.z + o.z), w: o.x1 - o.x0, h: o.y1 - o.y0 },
      top: towerTop,
    })
    return () => facades.delete(project)
  }, [project, fc, plan, origin, towerTop, o])

  // Light and motion.
  const state = useRef({ since: 0, level: 0, ticked: 0, peek: 0 })
  const v = new THREE.Vector3()
  useFrame((_, dt) => {
    const s = state.current
    const mine = focus.project === project
    if (mine && !s.since && focus.arrivedAt) {
      s.since = focus.arrivedAt
      s.ticked = 0
      loadStrip()
    }
    if (!mine && s.since) s.since = 0
    s.level = mine && s.since ? 1 : Math.max(0, s.level - dt / 0.35) // switch off quickly on leaving
    // Hovered in the Projects view: the opening glows faintly, a hint of what's inside.
    const peek = hovered === project && focus.project === null && strip.current ? 1 : 0
    s.peek += (peek - s.peek) * Math.min(1, dt * 4)
    const g = group.current
    g.visible = s.level > 0 || s.peek > 0.01
    panes.current.visible = enterMesh.current.visible = s.level > 0
    updateLabel()
    if (!g.visible) {
      if (mine) openingRect.valid = false
      return
    }
    const t = s.since ? (performance.now() - s.since) / 1000 : 99
    const power = (i) => (reducedMotion ? 1 : flicker(t - LEAD - i * STEP)) * s.level

    // Windows, in order; a soft tick as each one catches.
    const col = paneGeo.attributes.color
    const glow = 1.55
    for (let i = 0; i < plan.cells.length; i++) {
      const k = power(i) * glow
      for (let j = 0; j < 4; j++) col.setXYZ(i * 4 + j, k, k, k)
      if (s.since && !reducedMotion && s.ticked === i && t - LEAD - i * STEP > 0.1) {
        s.ticked++
        uiSound('power')
      }
    }
    col.needsUpdate = true
    const last = plan.cells.length
    const pulse = 1.35 + Math.sin(performance.now() / 420) * 0.18
    mats.enter.color.setScalar(power(last) * pulse)
    // The opening lights up after the top row, as a screen warming up.
    const sOn = reducedMotion ? 1 : Math.min(1, Math.max(0, (t - LEAD - plan.topRow * STEP) / 0.9))
    mats.screen.color.setScalar(Math.max((strip.current ? 1.15 : 0.12) * sOn * s.level, s.peek * 0.45))

    // Scroll the capture: slowly down the whole page and back, resting at each end.
    const tex = strip.current
    if (tex?.image) {
      const aspect = (o.x1 - o.x0) / (o.y1 - o.y0)
      const vh = Math.min(1, tex.image.width / aspect / tex.image.height)
      const span = 1 - vh
      const period = 4 + span * 30
      const ph = ((performance.now() / 1000) % (period * 2)) / period
      const tri = ph < 1 ? ph : 2 - ph
      const k = THREE.MathUtils.smoothstep(tri, 0.08, 0.92)
      const top = 1 - k * span
      const uv = screen.current.geometry.attributes.uv
      uv.setXY(0, 0, top)
      uv.setXY(1, 1, top)
      uv.setXY(2, 0, top - vh)
      uv.setXY(3, 1, top - vh)
      uv.needsUpdate = true
    }

    // The opening's place on screen, for the browsing panel to grow out of.
    if (mine) {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const [x, y] of [
        [o.x0, o.y0],
        [o.x1, o.y0],
        [o.x1, o.y1],
        [o.x0, o.y1],
      ]) {
        v.set(origin.x + x, origin.y + y, origin.z + o.z).project(camera)
        const sx = ((v.x + 1) / 2) * size.width
        const sy = ((1 - v.y) / 2) * size.height
        x0 = Math.min(x0, sx)
        x1 = Math.max(x1, sx)
        y0 = Math.min(y0, sy)
        y1 = Math.max(y1, sy)
      }
      Object.assign(openingRect, { x: x0, y: y0, w: x1 - x0, h: y1 - y0, valid: true })
    }
  })

  // The tower's name beside it while hovered in the Projects view.
  function updateLabel() {
    const el = ui.label
    if (!el) return
    const show = hovered === project && focus.project === null && inProjects()
    if (show) {
      v.copy(towerTop).project(camera)
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 14px))`
      el.dataset.project = project
      el.classList.add('show')
    } else if (el.dataset.project === String(project)) el.classList.remove('show')
  }

  // The opening and the bright window answer the pointer when the camera is at this tower.
  const active = () => focus.project === project && focus.stage !== 'inside'
  const hit = (fn) => ({
    raycast(raycaster, intersects) {
      if (active()) THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
    },
    onClick: (e) => {
      e.stopPropagation()
      fn()
    },
    onPointerOver: (e) => {
      e.stopPropagation()
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => (document.body.style.cursor = ''),
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={panes} geometry={paneGeo} material={mats.panes} raycast={() => {}} />
      <mesh ref={enterMesh} geometry={enterGeo} material={mats.enter} {...hit(openProject)} />
      <mesh ref={screen} geometry={screenGeo} material={mats.screen} {...hit(() => (focus.stage === 'facade' ? toOpening() : openProject()))} />
    </group>
  )
}
