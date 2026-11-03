import { useEffect } from 'react'
import { allOff, noteOff, noteOn, piano, setOctave, setSustain, stopSequence } from './engine'

// Computer keys to semitones above C of the current octave, by physical key position
// (event.code), so it works the same on QWERTY, AZERTY and other layouts: the home row is
// the white keys, the row above the black keys, as in music software.
export const KEYMAP = [
  ['KeyA', 0, 'A'],
  ['KeyW', 1, 'W'],
  ['KeyS', 2, 'S'],
  ['KeyE', 3, 'E'],
  ['KeyD', 4, 'D'],
  ['KeyF', 5, 'F'],
  ['KeyT', 6, 'T'],
  ['KeyG', 7, 'G'],
  ['KeyY', 8, 'Y'],
  ['KeyH', 9, 'H'],
  ['KeyU', 10, 'U'],
  ['KeyJ', 11, 'J'],
  ['KeyK', 12, 'K'],
  ['KeyO', 13, 'O'],
  ['KeyL', 14, 'L'],
  ['KeyP', 15, 'P'],
  ['Semicolon', 16, ';'],
  ['Quote', 17, "'"],
]
const BY_CODE = new Map(KEYMAP.map(([code, semi]) => [code, semi]))
export const baseMidi = () => 12 * (piano.octave + 1)

// Keyboard control while playing: notes, Z / X octave, Space sustain, Esc to leave.
export default function usePianoKeyboard(active, onExit) {
  useEffect(() => {
    if (!active) return
    const held = new Map() // code -> midi (so an octave change mid-note releases the right key)
    const down = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Escape') {
        e.preventDefault()
        onExit()
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        setSustain(true)
        return
      }
      if (e.repeat) {
        if (BY_CODE.has(e.code)) e.preventDefault()
        return
      }
      if (e.code === 'KeyZ' || e.code === 'KeyX') {
        e.preventDefault()
        setOctave(piano.octave + (e.code === 'KeyX' ? 1 : -1))
        return
      }
      const semi = BY_CODE.get(e.code)
      if (semi === undefined) return
      e.preventDefault()
      if (piano.mode !== 'free') stopSequence()
      const midi = baseMidi() + semi
      held.set(e.code, midi)
      noteOn(midi, 0.72)
    }
    const up = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setSustain(false)
        return
      }
      const midi = held.get(e.code)
      if (midi !== undefined) {
        held.delete(e.code)
        noteOff(midi)
      }
    }
    const blur = () => {
      held.clear()
      allOff()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [active, onExit])
}
