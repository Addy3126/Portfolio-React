import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { about } from '../content'
import { motion } from '../store'
import { PIANO_POS, hideInReflection } from './world'

const TEXT_HEIGHT = 0.085 // metres

// Draw one label into a canvas texture: soft blue glow behind white text.
function labelTexture(text) {
  const font = '600 64px Figtree, "Segoe UI", system-ui, sans-serif'
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = font
  const pad = 36
  c.width = Math.ceil(ctx.measureText(text).width + pad * 2)
  c.height = 64 + pad * 2
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(111, 155, 255, 0.95)'
  ctx.shadowBlur = 26
  ctx.fillStyle = '#eaf0ff'
  ctx.fillText(text, c.width / 2, c.height / 2)
  ctx.shadowBlur = 8
  ctx.fillText(text, c.width / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return { tex, aspect: c.width / c.height }
}

// Floating over the music stand, high enough to clear the raised lid.
const STAND = new THREE.Vector3(PIANO_POS.x + 0.2, 1.8, PIANO_POS.z)

// Loose rows above the music stand, as offsets in screen-facing space (across, up).
function layout(n) {
  const perRow = 3
  const rows = Math.ceil(n / perRow)
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / perRow)
    const inRow = Math.min(perRow, n - row * perRow)
    const k = i % perRow
    const across = (k - (inRow - 1) / 2) * 0.52 + (row % 2 ? 0.08 : -0.04)
    const up = (rows - 1 - row) * 0.18 + Math.cos(across * 2.2) * 0.03
    return [across, up]
  })
}

const right = new THREE.Vector3()
const upVec = new THREE.Vector3()

export default function SkillLabels() {
  const [labels, setLabels] = useState([])
  const group = useRef()
  const meshes = useRef([])

  // Wait for the web font so the canvas text uses it.
  useEffect(() => {
    let alive = true
    const ready = document.fonts?.load ? document.fonts.load('600 64px Figtree') : Promise.resolve()
    ready
      .catch(() => {})
      .then(() => {
        if (!alive) return
        const spots = layout(about.skills.length)
        setLabels(about.skills.map((s, i) => ({ text: s, ...labelTexture(s), pos: spots[i], phase: i * 1.7 })))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => () => labels.forEach((l) => l.tex.dispose()), [labels])

  useEffect(() => {
    const g = group.current
    hideInReflection.add(g)
    return () => hideInReflection.delete(g)
  }, [])

  useFrame(({ camera, clock }) => {
    // Fully visible at the About stop, gone a little way either side.
    const d = Math.abs(motion.progress - 1)
    const o = 1 - THREE.MathUtils.smoothstep(d, 0.2, 0.55)
    group.current.visible = o > 0.01
    if (!group.current.visible) return
    const t = clock.elapsedTime
    meshes.current.forEach((m, i) => {
      if (!m) return
      const l = labels[i]
      right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      upVec.set(0, 1, 0)
      m.position.copy(STAND).addScaledVector(right, l.pos[0]).addScaledVector(upVec, l.pos[1] + Math.sin(t * 0.8 + l.phase) * 0.012)
      m.quaternion.copy(camera.quaternion)
      m.material.opacity = o * (0.85 + 0.15 * Math.sin(t * 1.3 + l.phase))
    })
  })

  return (
    <group ref={group} visible={false}>
      {labels.map((l, i) => (
        <mesh key={l.text} ref={(m) => (meshes.current[i] = m)} scale={[TEXT_HEIGHT * l.aspect * 1.9, TEXT_HEIGHT * 1.9, 1]}>
          <planeGeometry />
          <meshBasicMaterial map={l.tex} transparent alphaTest={0.04} depthWrite toneMapped={false} fog={false} color={[1.6, 1.6, 1.8]} />
        </mesh>
      ))}
    </group>
  )
}
