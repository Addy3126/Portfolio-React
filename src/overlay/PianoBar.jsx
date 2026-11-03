import { useEffect, useRef, useState } from "react";
import { gymnopedie } from "../piano/demo";
import {
  hasTake,
  isBlack,
  isRecording,
  keys,
  noteName,
  piano,
  playSequence,
  replayTake,
  setOctave,
  startRecording,
  stopRecording,
  stopSequence,
  subscribe,
} from "../piano/engine";
import { KEYMAP, baseMidi } from "../piano/usePianoKeyboard";

// The controls shown while seated at the piano: which computer key plays which note (lit
// as they're played), the note just played, octave, sustain, the demo piece, recording
// and replay, and the way out.
export default function PianoBar({ onExit }) {
  const touch =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  const [, force] = useState(0);
  const [note, setNote] = useState(null);
  const noteTimer = useRef(null);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "on") {
          setNote({ name: noteName(e.midi), id: performance.now() });
          clearTimeout(noteTimer.current);
          noteTimer.current = setTimeout(() => setNote(null), 1400);
        }
        force((n) => n + 1);
      }),
    [],
  );
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const base = baseMidi();
  const whites = KEYMAP.filter(([, s]) => !isBlack(base + s));
  const blacks = KEYMAP.filter(([, s]) => isBlack(base + s));
  const whiteIndex = (semi) => whites.findIndex(([, s]) => s === semi - 1);
  const blur = (e) => e.currentTarget.blur(); // keep Space for the sustain pedal
  const playing = piano.mode !== "free";
  const rec = isRecording();

  return (
    <>
      {/* Outside the bar: its translate would make it the note's containing block. */}
      <div
        className={`piano-note ${note ? "show" : ""}`}
        key={note?.id}
        aria-hidden="true"
      >
        {note?.name}
      </div>
      <div className="piano-bar" role="region" aria-label="Piano controls">
        {!touch && (
          <div
            className="mini-keys"
            aria-hidden="true"
            style={{ "--n": whites.length }}
          >
            {whites.map(([code, s, label]) => (
              <span
                key={code}
                className={`mk white ${keys.down[base + s] ? "on" : ""}`}
              >
                <b>{label}</b>
                <i>{noteName(base + s)}</i>
              </span>
            ))}
            {blacks.map(([code, s, label]) => (
              <span
                key={code}
                className={`mk black ${keys.down[base + s] ? "on" : ""}`}
                style={{ "--i": whiteIndex(s) }}
              >
                <b>{label}</b>
              </span>
            ))}
          </div>
        )}

        <div className="piano-controls">
          <div className="octave">
            <button
              onClick={(e) => (setOctave(piano.octave - 1), blur(e))}
              aria-label="Octave down"
              disabled={piano.octave <= 1}
            >
              ‹{!touch && <kbd>Z</kbd>}
            </button>
            <span>
              {noteName(base)}–{noteName(base + 17)}
            </span>
            <button
              onClick={(e) => (setOctave(piano.octave + 1), blur(e))}
              aria-label="Octave up"
              disabled={piano.octave >= 6}
            >
              {!touch && <kbd>X</kbd>}›
            </button>
          </div>
          {!touch && (
            <span className={`pedal ${piano.sustain ? "on" : ""}`}>
              Space · sustain
            </span>
          )}
          <button
            onClick={(e) => {
              blur(e);
              if (piano.mode === "demo") stopSequence();
              else playSequence(gymnopedie(), "demo");
            }}
          >
            {piano.mode === "demo" ? "Stop" : "Play me something"}
          </button>
          <button
            className={rec ? "rec on" : "rec"}
            onClick={(e) => {
              blur(e);
              if (rec) stopRecording();
              else startRecording();
            }}
          >
            {rec ? "Stop recording" : "Record"}
          </button>
          <button
            disabled={!hasTake() || rec}
            onClick={(e) => {
              blur(e);
              if (piano.mode === "replay") stopSequence();
              else replayTake();
            }}
          >
            {piano.mode === "replay" ? "Stop" : "Replay"}
          </button>
          <button className="leave" onClick={onExit}>
            Leave the piano{!touch && <kbd>Esc</kbd>}
          </button>
        </div>
        <p className="piano-help">
          {touch
            ? "Tap or slide across the keys."
            : "Play with your keyboard, or click the keys."}
          {playing &&
            piano.mode === "demo" &&
            " Now playing: Satie, Gymnopédie No. 1."}
        </p>
      </div>
    </>
  );
}
