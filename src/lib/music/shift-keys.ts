// Shift keys: hold keys while singing to move the notes you sing up or down, e.g. to
// write a part higher or lower than your voice goes.
//
//   1 … 9, 0   up that many semitones (0 = 10)
//   − (held)   …down instead
//   Z X C V    octaves: −2, −1, +1, +2 (adds to the number)
//   ` (held)   slide: changing the shift while holding it glides to the new note
//
// Uses physical key positions (KeyboardEvent.code), so keyboard layout doesn't matter.
// These keys are spread out, so common keyboards register them together without trouble
// (no "ghosting"). While recording, the times the shift changed are kept; afterwards:
// - a note takes the shift held as it starts (a key pressed just after still counts)
// - changing the shift while a note is held splits it there: the rest is a new note at
//   the new shift, attacked again, or slid into (legato + glide) if ` was held
import { requantize } from './quantize';
import { secondsToTicks, ticksToSeconds } from './time';
import type { Note, NoteClip } from './types';

const DIGITS: Record<string, number> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8, Digit9: 9, Digit0: 10,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad6: 6, Numpad7: 7, Numpad8: 8, Numpad9: 9, Numpad0: 10
};
const OCTAVES: Record<string, number> = { KeyZ: -24, KeyX: -12, KeyC: 12, KeyV: 24 };
const MINUS = ['Minus', 'NumpadSubtract'];
const SLIDE = ['Backquote'];

export function isShiftKey(code: string): boolean {
  return code in DIGITS || code in OCTAVES || MINUS.includes(code) || SLIDE.includes(code);
}

export function isSlideKey(code: string): boolean {
  return SLIDE.includes(code);
}

// The shift for the keys held, in the order pressed. If several numbers (or several
// octave keys) are held, the last one pressed counts.
export function shiftFromKeys(held: string[]): number {
  const digit = held.filter((c) => c in DIGITS).at(-1);
  const octave = held.filter((c) => c in OCTAVES).at(-1);
  const minus = held.some((c) => MINUS.includes(c));
  const semitones = digit ? DIGITS[digit] : 0;
  return (minus ? -semitones : semitones) + (octave ? OCTAVES[octave] : 0);
}

// From `time` (seconds from the take's start) on, notes are shifted by `shift` semitones.
// `slide`: the slide key was held as it changed.
export interface ShiftChange {
  time: number;
  shift: number;
  slide?: boolean;
}

const GRACE_SEC = 0.12; // a key pressed this soon after a note starts counts for all of it
const MIN_PART_SEC = 0.08; // a split never leaves a piece shorter than this
const SLIDE_SEC = 0.08; // how long a slide into the new note takes

export function shiftAt(changes: ShiftChange[], seconds: number): number {
  let shift = 0;
  for (const c of changes) {
    if (c.time > seconds) break;
    shift = c.shift;
  }
  return shift;
}

// Moves the notes of a recorded clip by the shift keys held while singing (see the top of
// this file), splitting notes where the shift changed while they were held. Works on the
// clip's source (the notes as sung) and quantizes again, so the new notes are quantized too.
export function applyShifts(clip: NoteClip, changes: ShiftChange[], bpm: number) {
  if (!changes.length) return;
  const source = clip.source;
  if (!source) {
    // Not a recorded clip: just move each note by the shift at its start.
    for (const n of clip.notes) shiftNote(n, shiftAt(changes, ticksToSeconds(n.start, bpm) + GRACE_SEC));
    return;
  }
  source.notes = source.notes.flatMap((n) => splitByShifts(n, changes, bpm));
  clip.notes = requantize(source);
}

function shiftNote(n: Note, shift: number) {
  if (!shift) return;
  n.pitch = Math.max(0, Math.min(127, n.pitch + shift));
  n.alternatives = n.alternatives?.map((a) => a + shift);
  if (n.interpretation) n.interpretation = { ...n.interpretation, pitch: n.interpretation.pitch + shift };
}

// One sung note → one piece per shift held while it sounded.
function splitByShifts(n: Note, changes: ShiftChange[], bpm: number): Note[] {
  const start = ticksToSeconds(n.start, bpm);
  const end = ticksToSeconds(n.start + n.duration, bpm);
  const first = shiftAt(changes, Math.min(start + GRACE_SEC, (start + end) / 2));

  // Where it splits: changes to a different shift, well inside the note.
  const cuts: ShiftChange[] = [];
  let current = first;
  for (const c of changes) {
    if (c.time <= start + GRACE_SEC || c.time >= end - MIN_PART_SEC || c.shift === current) continue;
    if (cuts.length && c.time - cuts[cuts.length - 1].time < MIN_PART_SEC) cuts.pop(); // a quick change: keep the later
    if (c.shift === (cuts.length ? cuts[cuts.length - 1].shift : first)) continue;
    cuts.push(c);
    current = c.shift;
  }

  // Pieces between the cuts (just the one note when there are none).
  const bounds = [start, ...cuts.map((c) => c.time), end];
  return bounds.slice(0, -1).map((from, i) =>
    piece(
      n,
      from - start,
      bounds[i + 1] - start,
      i === 0 ? first : cuts[i - 1].shift,
      { first: i === 0, last: i === cuts.length, slideIn: i > 0 && !!cuts[i - 1].slide, slideOut: i < cuts.length && !!cuts[i].slide },
      bpm
    )
  );
}

// The part of a note from `from` to `to` seconds into it, moved by `shift`.
function piece(
  n: Note,
  from: number,
  to: number,
  shift: number,
  o: { first: boolean; last: boolean; slideIn: boolean; slideOut: boolean },
  bpm: number
): Note {
  const fromTicks = o.first ? 0 : secondsToTicks(from, bpm);
  const toTicks = o.last ? n.duration : secondsToTicks(to, bpm);
  const out: Note = { ...n, id: o.first ? n.id : crypto.randomUUID(), start: n.start + fromTicks, duration: toTicks - fromTicks };

  // The sung pitch curve: just this piece's frames, timed from its own start.
  if (n.curve) {
    const keep = n.curve.t.map((t, i) => (t >= from && (o.last || t < to) ? i : -1)).filter((i) => i >= 0);
    const pick = (a: number[]) => keep.map((i) => a[i]);
    out.curve = { t: keep.map((i) => n.curve!.t[i] - from), pitch: pick(n.curve.pitch), raw: pick(n.curve.raw), db: pick(n.curve.db) };
    if (n.interpretation) {
      out.interpretation = {
        ...n.interpretation,
        curve: pick(n.interpretation.curve),
        scoop: o.first ? n.interpretation.scoop : undefined,
        fall: o.last ? n.interpretation.fall : undefined
      };
    }
  }
  // Into a slide: no new attack (legato), and the next piece glides from this pitch.
  if (!o.last) out.articulation = { kind: o.slideOut ? 'legato' : 'normal', accent: o.first && !!n.articulation?.accent, accentDb: o.first ? (n.articulation?.accentDb ?? 0) : 0 };
  else if (!o.first) out.articulation = n.articulation && { ...n.articulation, accent: false, accentDb: 0 };
  if (o.slideIn) out.expression = { ...n.expression, glide: SLIDE_SEC };
  shiftNote(out, shift);
  return out;
}

// "+12", "−3", "0": for showing the current shift.
export function formatShift(shift: number): string {
  return shift > 0 ? `+${shift}` : shift < 0 ? `−${-shift}` : '0';
}
