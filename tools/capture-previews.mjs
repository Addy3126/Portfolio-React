// Captures the scroll-through previews that play in the project towers' openings
// (src/scene/Facade.jsx): each live site is scrolled a screen at a time (so content that
// appears on scroll has appeared) and the screens are stacked into one tall WebP strip.
// A project without a live site shows its own source code instead, fetched from GitHub.
//
//   node tools/capture-previews.mjs [slug ...]
//
// Needs Playwright with Chromium. Writes public/previews/<slug>.webp (960 px wide, at most
// 3840 px tall: about six screens, within every GPU's texture size limit).
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { projects } from '../src/content.js'

const W = 960
const MAX_H = 3840
const VIEW = { width: 1280, height: 800 }
const OUT = 'public/previews'

// No live site: these files, in this order (the parts a reader would look at first).
const CODE = {
  'finance-tracker': {
    repo: 'Addy3126/finance-tracker-using-mern',
    branch: 'main',
    files: ['frontend/src/components/Transactions/TransactionChart.jsx', 'backend/controllers/transactionCtrl.js', 'backend/middlewares/isAuth.js', 'backend/routes/transactionRouter.js'],
  },
}

const { chromium } = createRequire(import.meta.url)('playwright')
const only = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()

// Stacks PNG screenshots into one strip, scaled to W wide, and encodes it as WebP.
async function stitch(shots) {
  const page = await browser.newPage()
  const data = await page.evaluate(
    async ({ shots, W, MAX_H }) => {
      const imgs = await Promise.all(
        shots.map(
          (b64) =>
            new Promise((res) => {
              const im = new Image()
              im.onload = () => res(im)
              im.src = `data:image/png;base64,${b64}`
            }),
        ),
      )
      const k = W / imgs[0].width
      const h = Math.min(MAX_H, Math.round(imgs.reduce((a, im) => a + im.height * k, 0)))
      const c = document.createElement('canvas')
      c.width = W
      c.height = h
      const ctx = c.getContext('2d')
      let y = 0
      for (const im of imgs) {
        ctx.drawImage(im, 0, y, W, im.height * k)
        y += im.height * k
        if (y >= h) break
      }
      return c.toDataURL('image/webp', 0.8).split(',')[1]
    },
    { shots, W, MAX_H },
  )
  await page.close()
  return Buffer.from(data, 'base64')
}

async function captureSite(url) {
  const page = await browser.newPage({ viewport: VIEW })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.mouse.move(VIEW.width / 2, VIEW.height / 2)
  const shots = []
  const screens = Math.ceil(MAX_H / ((VIEW.height * W) / VIEW.width))
  for (let i = 0; i < screens; i++) {
    shots.push((await page.screenshot()).toString('base64'))
    // Scroll with the wheel, so pages that drive their own scrolling follow it too; stop
    // at the bottom of the page.
    const y = await page.evaluate(() => window.scrollY)
    for (let s = 0; s < 8; s++) await page.mouse.wheel(0, VIEW.height / 8)
    await page.waitForTimeout(1400)
    if ((await page.evaluate(() => window.scrollY)) <= y) break
  }
  await page.close()
  return shots
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// One pass over the source: comments, strings and keywords coloured, everything escaped.
function highlight(code) {
  return code.replace(/(\/\/.*)|("[^"\n]*"|'[^'\n]*'|`[^`]*`)|\b(const|let|var|return|await|async|import|from|export|default|if|else|new|function|try|catch|throw|require)\b|([^])/g, (m, c, s, k, other) =>
    c ? `<i class="c">${esc(c)}</i>` : s ? `<i class="s">${esc(s)}</i>` : k ? `<i class="k">${k}</i>` : esc(other ?? m),
  )
}
async function captureCode({ repo, branch, files }) {
  const sources = await Promise.all(files.map(async (f) => [f, await (await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${f}`)).text()]))
  const page = await browser.newPage({ viewport: { width: VIEW.width, height: VIEW.height } })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #0d0f26; color: #d8d4f0; font: 17px/1.55 'DejaVu Sans Mono', Menlo, Consolas, monospace; }
    .bar { position: sticky; top: 0; display: flex; gap: 0; background: #15123f; border-bottom: 1px solid #2c2864; font: 600 15px system-ui, sans-serif; }
    .bar span { padding: 12px 20px; color: #9f98c9; border-right: 1px solid #2c2864; }
    .bar span:first-child { color: #ffcf8a; background: #0d0f26; }
    h2 { margin: 0; padding: 26px 40px 10px; font: 600 16px system-ui, sans-serif; color: #ffcf8a; letter-spacing: .04em; }
    pre { margin: 0; padding: 4px 40px 30px; white-space: pre-wrap; counter-reset: l; }
    pre span { display: block; counter-increment: l; }
    pre span::before { content: counter(l); display: inline-block; width: 2.6em; margin-right: 1.4em; text-align: right; color: #4a4680; }
    i { font-style: normal; } .c { color: #6f6aa0; } .s { color: #f5c8d0; } .k { color: #9fbcff; }
  </style><div class="bar">${files.map((f) => `<span>${esc(f.split('/').pop())}</span>`).join('')}</div>${sources
    .map(([f, src]) => `<h2>${esc(f)}</h2><pre>${highlight(src.replace(/\t/g, '  ').trimEnd()).split('\n').map((l) => `<span>${l || ' '}</span>`).join('')}</pre>`)
    .join('')}`)
  const shot = (await page.screenshot({ fullPage: true })).toString('base64')
  await page.close()
  return [shot]
}

for (const p of projects) {
  if (!p.preview || (only.length && !only.includes(p.slug))) continue
  const shots = CODE[p.slug] ? await captureCode(CODE[p.slug]) : await captureSite(p.link)
  const out = `${OUT}/${p.slug}.webp`
  const buf = await stitch(shots)
  writeFileSync(out, buf)
  console.log(`${out}: ${shots.length} screen(s), ${(buf.length / 1024).toFixed(0)} KB`)
}
await browser.close()
