// "Play me something": the opening of Erik Satie's Gymnopédie No. 1 (1888, public domain),
// as a sequence for engine.playSequence: [ms, kind (1 on, 0 off, 2/3 pedal), midi, vel].
const BEAT = 820 // ms per quarter (Lent et douloureux)
const BAR = BEAT * 3

// Melody per bar from bar 5 (1-indexed): [beat, midi, beats] ; F#5 = 78, A5 = 81, etc.
const M = {
  5: [[1, 78, 1], [2, 81, 1]],
  6: [[0, 79, 1], [1, 78, 1], [2, 73, 1]],
  7: [[0, 71, 1], [1, 73, 1], [2, 74, 1]],
  8: [[0, 69, 3]],
  9: [[0, 66, 11.5]],
  13: [[1, 78, 1], [2, 81, 1]],
  14: [[0, 79, 1], [1, 78, 1], [2, 73, 1]],
  15: [[0, 71, 1], [1, 73, 1], [2, 74, 1]],
  16: [[0, 69, 3]],
  17: [[0, 73, 3]],
  18: [[0, 78, 3]],
  19: [[0, 76, 8]],
}
const BARS = 21

export function gymnopedie() {
  const ev = []
  const note = (t, midi, dur, vel) => {
    ev.push([t, 1, midi, vel])
    ev.push([t + dur, 0, midi, 0])
  }
  for (let b = 1; b <= BARS; b++) {
    const t0 = (b - 1) * BAR
    const g = b % 2 === 1 // G major 7 on odd bars, D major 7 on even ones
    ev.push([t0 + 10, 2, 0, 0]) // pedal down just after the bass
    ev.push([t0 + BAR - 30, 3, 0, 0]) // and up before the next bar
    note(t0, g ? 43 : 38, BAR - 60, 0.5)
    for (const m of g ? [59, 62, 66] : [57, 61, 66]) note(t0 + BEAT, m, BEAT * 2 - 60, 0.34)
    for (const [beat, midi, beats] of M[b] || []) note(t0 + beat * BEAT, midi, beats * BEAT - 40, 0.62)
  }
  // Close on a soft G major 7.
  const tEnd = BARS * BAR
  for (const m of [43, 59, 62, 66, 71]) note(tEnd, m, BAR * 1.5, 0.38)
  return ev.sort((a, b) => a[0] - b[0])
}
