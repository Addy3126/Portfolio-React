// Regression check: loads the built site (vite preview) in headless Chromium, visits every
// section stop and the flights between them on both renderers, and records per stop the
// draw calls, triangles and compiled pipelines/programs, plus a screenshot. Compares with
// the previous run's numbers when there is one.
//
//   npm run build && npm run check -- [--quality=high] [--size=1280x540] [--renderers=webgpu,webgl]
//                                     [--stops=0,0.5,1,1.5,2,2.5,3] [--out=check-out] [--look=old] [--dist=dist]
//
// Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
// Works with a software GPU (SwiftShader), so frame times are not meaningful; the counts
// and the screenshots are.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const quality = args.quality ?? 'high'
const [w, h] = (args.size ?? '1280x540').split('x').map(Number)
const renderers = (args.renderers ?? 'webgpu,webgl').split(',')
const stops = (args.stops ?? '0,0.5,1,1.5,2,2.5,3').split(',').map(Number)
const out = args.out ?? 'check-out'
const port = Number(args.port ?? 4319)
const extra = args.look ? `&look=${args.look}` : ''
const dist = args.dist ?? 'dist'

let chromium
try {
  chromium = createRequire(import.meta.url)('playwright').chromium
} catch {
  console.error('Playwright not found: npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build: run npm run build first')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--outDir', dist], { stdio: 'ignore' })
const stop = () => server.kill()
process.on('exit', stop)
for (let i = 0; i < 60; i++) {
  try {
    await fetch(`http://localhost:${port}/`)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}

const gpuFlags = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface',
  '--ignore-gpu-blocklist',
]
const results = {}
for (const renderer of renderers) {
  const browser = await chromium.launch({ args: [...(renderer === 'webgpu' ? gpuFlags : []), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text().slice(0, 160)}`))
  const t0 = Date.now()
  await page.goto(`http://localhost:${port}/?renderer=${renderer}&quality=${quality}&stats=1${extra}`)
  await page.waitForSelector('.loader.done', { state: 'attached', timeout: 1_500_000 })
  const loadMs = Date.now() - t0
  await page.addStyleTag({ content: '.panel,.scroll-cue{opacity:0!important}' })
  const rows = []
  for (const s of stops) {
    await page.evaluate((s) => window.scrollTo(0, ((document.documentElement.scrollHeight - innerHeight) * s) / 3), s)
    await page.waitForTimeout(8000)
    // Two fresh frames, then read the counts.
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
    const r = await page.evaluate(() => {
      const gl = window.__gl
      return { ...window.__stats, pipelines: gl?._pipelines?.caches?.size ?? gl?.info?.programs?.length ?? null }
    })
    await page.screenshot({ path: join(out, `${renderer}-${String(s).replace('.', '_')}.png`), timeout: 900_000 })
    rows.push({ stop: s, draws: r.calls, triangles: r.triangles, pipelines: r.pipelines })
  }
  results[renderer] = { loadMs, rows, errors: errors.slice(0, 10) }
  await browser.close()
}
stop()

const file = join(out, 'summary.json')
const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
writeFileSync(file, JSON.stringify({ quality, size: `${w}x${h}`, results }, null, 2))
const delta = (a, b) => (b === undefined || b === null ? '' : ` (${a - b >= 0 ? '+' : ''}${a - b})`)
for (const [renderer, r] of Object.entries(results)) {
  console.log(`\n${renderer} @ ${quality}, ${w}x${h}: ready in ${(r.loadMs / 1000).toFixed(0)} s`)
  for (const row of r.rows) {
    const p = prev?.results?.[renderer]?.rows?.find((x) => x.stop === row.stop)
    console.log(
      `  stop ${String(row.stop).padEnd(3)}  draws ${String(row.draws).padStart(4)}${delta(row.draws, p?.draws)}  tris ${(row.triangles / 1e6).toFixed(2)}M${p ? ` (was ${(p.triangles / 1e6).toFixed(2)}M)` : ''}  pipelines ${row.pipelines}${delta(row.pipelines, p?.pipelines)}`,
    )
  }
  console.log(r.errors.length ? `  console: ${r.errors.join(' | ')}` : '  console: clean')
}
console.log(`\nScreenshots and summary in ${out}/`)
