import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { reducedMotion, tier } from '../quality'

// Drifting clouds for both renderers. The cloud layer is ray-marched, far too heavy to redo
// every frame, so the sky keeps a short chain of baked cube maps: the one on screen, the one
// it is fading into, and the next one, baked a strip at a time in the background with the
// cloud field moved a little further downwind. The sky shader cross-fades between the two
// shown ones. Each re-bake is spread over ~200 frames (one strip of one face every few
// frames), so the cost per frame stays tiny.
export const DRIFT = !reducedMotion && tier !== 'low' && tier !== 'minimal'
export const DRIFT_SIZE = tier === 'mid' ? 512 : 768
// ?drift=fast: whole faces every frame and a short fade (for checking it works).
const fast = new URLSearchParams(window.location.search).get('drift') === 'fast'
const PERIOD = fast ? 6 : 20 // seconds per cross-fade
const WIND = [0.13, 0, -0.17] // cloud-field shift per period, in sky units
const STRIPS = fast ? 1 : 8 // per cube face
const EVERY = fast ? 1 : 4 // frames between strips

// renderer: the three renderer; cubeCamera: a CubeCamera (its six children are used);
// bakeScene: scene holding the bake sphere; setShift(x, y, z): moves the cloud field for
// the bake; makeTarget(size): a cube render target; first: the texture of the initial bake;
// show(frontTexture, backTexture, blend): updates the sky material.
export function useCloudDrift({ enabled, renderer, cubeCamera, bakeScene, setShift, makeTarget, first, show }) {
  const pool = useMemo(() => (enabled ? [0, 1, 2].map(() => makeTarget(DRIFT_SIZE)) : []), [enabled, makeTarget])
  useEffect(() => () => pool.forEach((t) => t.dispose()), [pool])

  const st = useRef({ k: 0, t0: null, bake: null, frame: 0, ready: false })
  const tex = (k) => (k === 0 ? first : pool[(k - 1) % 3].texture)

  const startBake = (k) => {
    st.current.bake = { k, target: pool[(k - 1) % 3], face: 0, strip: 0 }
  }

  useFrame(({ clock }) => {
    if (!enabled || !first) return
    const s = st.current
    if (!s.bake && s.t0 === null && !s.ready) startBake(1)
    // Bake one strip of the pending cube every few frames.
    if (s.bake && ++s.frame % EVERY === 0) {
      const b = s.bake
      const size = b.target.width
      const h = size / STRIPS
      const cam = cubeCamera.children[b.face]
      if (cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
        cubeCamera.coordinateSystem = renderer.coordinateSystem
        cubeCamera.updateCoordinateSystem()
      }
      setShift(WIND[0] * b.k, WIND[1] * b.k, WIND[2] * b.k)
      const prev = renderer.getRenderTarget()
      const autoClear = renderer.autoClear
      const scissorTest = renderer.getScissorTest()
      renderer.autoClear = false
      b.target.scissor.set(0, b.strip * h, size, h)
      b.target.scissorTest = true
      renderer.setScissorTest(true)
      renderer.setRenderTarget(b.target, b.face)
      renderer.render(bakeScene, cam)
      renderer.setRenderTarget(prev)
      renderer.setScissorTest(scissorTest)
      b.target.scissorTest = false
      renderer.autoClear = autoClear
      if (++b.strip === STRIPS) {
        b.strip = 0
        if (++b.face === 6) {
          s.bake = null
          if (b.k === 1) {
            // First drift cube ready: start fading into it.
            s.ready = true
            s.t0 = clock.elapsedTime
            startBake(2)
          }
        }
      }
    }
    if (!s.ready) {
      show(tex(0), tex(0), 0)
      return
    }
    let blend = (clock.elapsedTime - s.t0) / PERIOD
    if (blend >= 1) {
      if (s.bake) blend = 1 // next cube not ready yet: hold
      else {
        s.k++
        s.t0 = clock.elapsedTime
        blend = 0
        startBake(s.k + 2)
      }
    }
    window.__drift = { k: s.k, blend: Math.round(blend * 100) / 100, baking: s.bake ? `${s.bake.face}/${s.bake.strip}` : null }
    show(tex(s.k), tex(s.k + 1), Math.min(1, blend))
  })
}
