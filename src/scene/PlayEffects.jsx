import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { WHITE_MIDI, subscribe } from '../piano/engine'
import { lilyGeometry } from './flower'
import { PIANO_POS, SUN_DIR, shared } from './world'

// What the field does when the piano is played (both renderers):
// - a ring of blue light spreads over the grass from the piano (shared uRippleT / uRippleA,
//   drawn by the ground and grass shaders), one ring per note, the last four at a time;
// - a single small lily lifts off the struck key and drifts away toward the sun, fading.
const KEY_W = 1.22 / 52
const KEY_Z0 = -0.61
function keyPosition(midi, out) {
  const w = WHITE_MIDI.indexOf(midi)
  const z = w >= 0 ? KEY_Z0 + (w + 0.5) * KEY_W : KEY_Z0 + (WHITE_MIDI.indexOf(midi - 1) + 1) * KEY_W
  return out.set(PIANO_POS.x - 0.14, 0.8, PIANO_POS.z + z)
}

const POOL = 28
const LIFE = 4.5 // seconds

export default function PlayEffects() {
  const fx = useMemo(() => {
    const mesh = new THREE.InstancedMesh(
      lilyGeometry({ detail: 'low' }),
      new THREE.MeshStandardMaterial({
        color: '#1d1747',
        emissive: '#4f6cff',
        emissiveIntensity: 0.55,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
      POOL,
    )
    mesh.frustumCulled = false
    const hide = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, hide)
    return {
      mesh,
      petals: Array.from({ length: POOL }, () => ({
        age: LIFE,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        spin: 0,
        ph: 0,
      })),
      next: 0,
      lastPetal: 0,
      ripple: 0,
      lastRipple: -1,
    }
  }, [])

  useEffect(() => {
    const flow = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize()
    return subscribe((e) => {
      if (e.type !== 'on') return
      const now = shared.uTime.value
      // Ring: notes struck together share one ring (brighter), otherwise a new one.
      const T = shared.uRippleT.value
      const A = shared.uRippleA.value
      const comps = ['x', 'y', 'z', 'w']
      if (now - fx.lastRipple < 0.09) {
        const c = comps[(fx.ripple + 3) % 4]
        A[c] = Math.min(1.6, A[c] + e.vel * 0.35)
      } else {
        const c = comps[fx.ripple]
        T[c] = now
        A[c] = 0.5 + e.vel * 0.7
        fx.ripple = (fx.ripple + 1) % 4
        fx.lastRipple = now
      }
      // Petal: at most one every 70 ms, so runs and chords don't flood the air.
      const t = performance.now()
      if (t - fx.lastPetal < 70) return
      fx.lastPetal = t
      const pt = fx.petals[fx.next]
      fx.next = (fx.next + 1) % POOL
      keyPosition(e.midi, pt.p)
      pt.v.set((Math.random() - 0.5) * 0.15, 0.32 + e.vel * 0.25, (Math.random() - 0.5) * 0.15).addScaledVector(flow, 0.18)
      pt.age = 0
      pt.spin = (Math.random() - 0.5) * 2
      pt.ph = Math.random() * 6.28
    })
  }, [fx])

  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      s: new THREE.Vector3(),
    }),
    [],
  )
  // On tall screens the camera sits right over the keys, so the lilies are drawn smaller.
  const portrait = useThree((s) => s.size.width < s.size.height)
  const scale = portrait ? 0.022 : 0.045
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1)
    // Faded rings: amplitude to zero, so the field shaders skip the ripple entirely.
    const now = shared.uTime.value
    const T = shared.uRippleT.value
    const A = shared.uRippleA.value
    for (const c of ['x', 'y', 'z', 'w']) if (A[c] && now - T[c] > 6) A[c] = 0
    let any = false
    fx.petals.forEach((pt, i) => {
      if (pt.age >= LIFE) return
      any = true
      pt.age += d
      pt.v.y -= d * 0.05 // drifts, slowly losing lift
      pt.v.x += Math.sin(pt.age * 1.7 + pt.ph) * d * 0.06
      pt.p.addScaledVector(pt.v, d)
      const k = pt.age >= LIFE ? 0 : Math.min(1, pt.age * 6) * (1 - Math.max(0, (pt.age - LIFE + 1.2) / 1.2))
      tmp.q.setFromEuler(tmp.e.set(Math.sin(pt.age * 1.3 + pt.ph) * 0.6, pt.age * pt.spin + pt.ph, Math.cos(pt.age + pt.ph) * 0.5))
      tmp.m.compose(pt.p, tmp.q, tmp.s.setScalar(scale * k))
      fx.mesh.setMatrixAt(i, tmp.m)
    })
    if (any) fx.mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive object={fx.mesh} />
}
