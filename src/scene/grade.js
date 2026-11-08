import * as THREE from 'three'
import { lookNew } from '../quality'
import { shared } from './world'

// The colour grade's settings per section, blended as the camera moves between them (read
// by the grade pass on both renderers): warm highlights and cool shadows (split toning),
// and how strong the contrast curve is. The new look widens the range a little and lets it
// travel with the evening: warmest at the landing, cooler and deeper by the Contact stop.
const OLD = { high: [1.07, 1.0, 0.93], shadow: [0.9, 0.94, 1.08], curve: 0.22 }
const STOPS = [
  { high: [1.1, 1.0, 0.9], shadow: [0.86, 0.92, 1.12], curve: 0.32 }, // landing
  { high: [1.08, 1.0, 0.92], shadow: [0.87, 0.93, 1.11], curve: 0.3 }, // about
  { high: [1.05, 1.0, 0.95], shadow: [0.85, 0.91, 1.14], curve: 0.34 }, // projects
  { high: [1.04, 0.99, 0.96], shadow: [0.84, 0.9, 1.16], curve: 0.34 }, // contact
]
const a = new THREE.Vector3()
const b = new THREE.Vector3()

export function updateGrade(progress) {
  if (!lookNew) {
    shared.uGradeHigh.value.fromArray(OLD.high)
    shared.uGradeShadow.value.fromArray(OLD.shadow)
    shared.uGradeCurve.value = OLD.curve
    return
  }
  const p = THREE.MathUtils.clamp(progress, 0, STOPS.length - 1)
  const i = Math.min(Math.floor(p), STOPS.length - 2)
  const t = p - i
  const s0 = STOPS[i]
  const s1 = STOPS[i + 1]
  shared.uGradeHigh.value.copy(a.fromArray(s0.high).lerp(b.fromArray(s1.high), t))
  shared.uGradeShadow.value.copy(a.fromArray(s0.shadow).lerp(b.fromArray(s1.shadow), t))
  shared.uGradeCurve.value = THREE.MathUtils.lerp(s0.curve, s1.curve, t)
}
