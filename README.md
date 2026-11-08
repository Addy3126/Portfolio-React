# Nocturne Field

Aditya Sharma's portfolio: a real-time Three.js scene of an empty grand piano in a frosted field at twilight. Scrolling moves the camera between four stops: landing, About (at the piano), Projects (at the towers on the water) and Contact (at the shoreline).

Built with Vite, React 19, React Three Fiber (WebGPU with a WebGL fallback), postprocessing and Lenis. The piano, grass, flowers, sea, sky and ruins are generated in code; the large rocks are photo scans and the ground, ruins and rocks use scanned surface textures (Poly Haven, CC0), and the playable piano uses the Salamander Grand Piano samples (CC BY 3.0). The ambience mixes generated wind, grass and window sounds with recorded water, shore and cricket loops (all CC0, from OpenGameArt: "Sea and river wave sounds", "Beach ocean waves", "Water waves" and "Crickets ambient noise (loopable)"); each section has its own mix, and it drops to 20% while you play the piano.

## Scripts

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
npm run check    # after a build: every section on both renderers, draw/triangle/pipeline
                 # counts and screenshots in check-out/ (needs Playwright with Chromium)
```

## URL options

| Option | What it does |
|---|---|
| `?hud=1` | On-screen readout: quality, render size, fps, frame and GPU times, draw calls |
| `?quality=minimal\|low\|mid\|high\|ultra` | Pin a quality tier (skips the load-time test) |
| `?recalibrate=1` | Run the load-time quality test again (the result is remembered per GPU and screen) |
| `?look=old` | The scene as it was before the latest visual refresh, for comparison |
| `?renderer=webgl\|webgpu` | Force a renderer |

## Deployment

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). In the repository's Settings → Pages, **Source** must be set to **GitHub Actions**. You can also rerun a deploy by hand from the Actions tab.

## Editing content

All text lives in `src/content.js`. Each project in `projects` belongs to one lit tower (`project` in `src/scene/ruins/layout.js`). Choosing a project walks the camera up to its tower, whose front windows carry the project: the name, `pitch` and `status` along the top floor, each of `facts` in the windows below, and the brightest window opens `link`. A broken-out opening in the wall plays `preview`, a scroll-through capture of the site. Where `embed` is set (the site allows being shown inside another page) desktop visitors browse it in a panel at 80% of the screen; otherwise, and always on phones, it opens in a new tab. `slug` is the direct link to the tower (`…/#slug`).

After changing a project's site, refresh its preview:

```bash
node tools/capture-previews.mjs [slug]   # writes public/previews/<slug>.webp (needs Playwright)
```

## Layout

| Path | What it is |
|---|---|
| `src/scene/Sky.jsx` | Sky gradient, sun and stars; also bakes the reflection map |
| `src/scene/Sea.jsx`, `Ground.jsx` | Water with sun glints; ground with a wavy shoreline |
| `src/scene/Grass.jsx` | Instanced frost grass with wind |
| `src/scene/Petals.jsx` | GPU-animated petals drifting toward the sun |
| `src/scene/Ruins.jsx` | Towers (project hover/click targets) and the headland |
| `src/focus.js`, `src/scene/Facade.jsx`, `src/overlay/TowerUI.jsx` | Walking up to a project tower: its stages, the lit windows and opening, the controls and the browsing panel |
| `src/scene/Piano.jsx` | Procedural grand piano and empty bench |
| `src/scene/CameraRig.jsx` | Camera stops per section, scroll interpolation, mouse parallax |
| `src/scene/world.js` | Palette, sun direction, shared shader uniforms |
| `src/overlay/` | HTML text panels over the canvas |
| `src/audio/ambient.js` | Ambience: the layers, the mix per section (`MIX`), the piano duck, the tower hover/select sounds |
| `src/quality.js` | Quality tiers, the first guess per device, the remembered calibration |
| `src/scene/Perf.jsx` | Warm-up, load-time quality calibration, frame pacing, the readout's numbers |

Browsers without WebGL get a static render (`src/assets/fallback.jpg`) with the same text overlay. Reduced-motion settings slow the scene down and turn off smooth scrolling and parallax.
