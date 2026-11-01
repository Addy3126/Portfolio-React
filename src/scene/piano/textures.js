import * as THREE from 'three'

// Small procedural textures drawn once into canvases (no image files to download).

function rng(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function canvasTexture(w, h, draw, { srgb = false, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Quarter-sawn spruce: long, slightly wavy grain lines with soft colour bands.
export function spruceTextures() {
  const r = rng(7)
  const lines = Array.from({ length: 180 }, () => ({ y: r(), w: 0.4 + r() * 1.6, a: 0.08 + r() * 0.22, phase: r() * 10 }))
  const draw = (ctx, w, h, color) => {
    ctx.fillStyle = color ? '#c79a5e' : '#808080'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = color ? `rgba(${150 + r() * 40},${105 + r() * 30},${60 + r() * 20},0.25)` : `rgba(${110 + r() * 40},${110 + r() * 40},${110 + r() * 40},0.3)`
      ctx.fillRect(0, r() * h, w, h * (0.03 + r() * 0.08))
    }
    for (const l of lines) {
      ctx.strokeStyle = color ? `rgba(95,60,30,${l.a})` : `rgba(30,30,30,${l.a * 1.6})`
      ctx.lineWidth = l.w
      ctx.beginPath()
      for (let x = 0; x <= w; x += 16) {
        const y = l.y * h + Math.sin(x * 0.01 + l.phase) * 2.5
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  return {
    map: canvasTexture(1024, 256, (c, w, h) => draw(c, w, h, true), { srgb: true, repeat: [0.8, 1.6] }),
    bump: canvasTexture(1024, 256, (c, w, h) => draw(c, w, h, false), { repeat: [0.8, 1.6] }),
  }
}

// Speckled noise for bump maps: hammertone cast iron, felt, leather grain.
export function noiseBump({ seed = 1, size = 256, dots = 2600, minR = 0.6, maxR = 2.6, repeat = [4, 4] } = {}) {
  const r = rng(seed)
  return canvasTexture(
    size,
    size,
    (ctx, w, h) => {
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < dots; i++) {
        const v = Math.floor(70 + r() * 120)
        ctx.fillStyle = `rgba(${v},${v},${v},0.55)`
        ctx.beginPath()
        ctx.arc(r() * w, r() * h, minR + r() * (maxR - minR), 0, Math.PI * 2)
        ctx.fill()
      }
    },
    { repeat },
  )
}
