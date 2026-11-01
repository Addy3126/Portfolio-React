# Nocturne Field

Aditya Sharma's portfolio: a real-time Three.js scene of an empty grand piano in a frosted field at twilight. Scrolling moves the camera between four stops: landing, About (at the piano), Projects (at the towers on the water) and Contact (at the shoreline).

Built with Vite, React 19, React Three Fiber, postprocessing and Lenis. Everything in the scene is generated in code. There are no model or texture files.

## Scripts

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
```

## Deployment

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). In the repository's Settings → Pages, **Source** must be set to **GitHub Actions**. You can also rerun a deploy by hand from the Actions tab.

## Editing content

All text lives in `src/content.js`. Entries marked `PLACEHOLDER` are waiting for real content. Each project in `projects` is attached to one lit tower (see `TOWERS` in `src/scene/Ruins.jsx`).

## Layout

| Path | What it is |
|---|---|
| `src/scene/Sky.jsx` | Sky gradient, sun, clouds, aurora and stars in one shader; also bakes the reflection map |
| `src/scene/Sea.jsx`, `Ground.jsx` | Water with sun glints; ground with a wavy shoreline |
| `src/scene/Grass.jsx` | Instanced frost grass with wind |
| `src/scene/Petals.jsx` | GPU-animated petals drifting toward the sun |
| `src/scene/Ruins.jsx` | Towers (project hover/click targets) and the headland |
| `src/scene/Piano.jsx` | Procedural grand piano and empty bench |
| `src/scene/CameraRig.jsx` | Camera stops per section, scroll interpolation, mouse parallax |
| `src/scene/world.js` | Palette, sun direction, shared shader uniforms |
| `src/overlay/` | HTML text panels over the canvas |
| `src/quality.js` | Picks a quality tier (try `?quality=low`, `mid` or `high`) |

Browsers without WebGL get a static render (`src/assets/fallback.jpg`) with the same text overlay. Reduced-motion settings slow the scene down and turn off smooth scrolling and parallax.
