# Nocturne Field

Aditya Sharma's portfolio: a real-time Three.js scene of an empty grand piano in a frosted field at twilight. Scrolling moves the camera between four stops: landing, About (at the piano), Projects (at the towers on the water) and Contact (at the shoreline).

Built with Vite, React 19, React Three Fiber (WebGPU with a WebGL fallback), postprocessing and Lenis. The piano, grass, flowers, sea, sky and ruins are generated in code; the large rocks are photo scans and the ground, ruins and rocks use scanned surface textures (Poly Haven, CC0), and the playable piano uses the Salamander Grand Piano samples (CC BY 3.0).

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

All text lives in `src/content.js`. Each project in `projects` is attached to one lit tower (see `TOWERS` in `src/scene/Ruins.jsx`); a project's `link` is optional (use `note` for private work).

## Layout

| Path | What it is |
|---|---|
| `src/scene/Sky.jsx` | Sky gradient, sun and stars; also bakes the reflection map |
| `src/scene/Sea.jsx`, `Ground.jsx` | Water with sun glints; ground with a wavy shoreline |
| `src/scene/Grass.jsx` | Instanced frost grass with wind |
| `src/scene/Petals.jsx` | GPU-animated petals drifting toward the sun |
| `src/scene/Ruins.jsx` | Towers (project hover/click targets) and the headland |
| `src/scene/Piano.jsx` | Procedural grand piano and empty bench |
| `src/scene/CameraRig.jsx` | Camera stops per section, scroll interpolation, mouse parallax |
| `src/scene/world.js` | Palette, sun direction, shared shader uniforms |
| `src/overlay/` | HTML text panels over the canvas |
| `src/quality.js` | Quality tiers, the first guess per device, the remembered calibration |
| `src/scene/Perf.jsx` | Warm-up, load-time quality calibration, frame pacing, the readout's numbers |

Browsers without WebGL get a static render (`src/assets/fallback.jpg`) with the same text overlay. Reduced-motion settings slow the scene down and turn off smooth scrolling and parallax.
