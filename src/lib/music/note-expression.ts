// A note's pitch over time: the sung curve (slides, vibrato kept by transcription) plus
// expression added by hand in the piano roll (slide in, slide out, glide from the note
// before, vibrato). One function, used by playback (audio/playback.ts bends the synth by
// it) and by the piano roll (draws it over the note), so what you see is what you hear.
import type { Note } from './types';

// Edited by hand; every part optional (missing = none).
export interface NoteExpression {
  bend?: number; // 0–1.5: how much of the sung pitch curve plays (1 = as interpreted, 0 = flat)
  slideIn?: { semitones: number; sec: number }; // start this far off and slide onto the note
  slideOut?: { semitones: number; sec: number }; // slide off the note at its end
  glide?: number; // seconds: slide in from the previous note's pitch
  vibrato?: { cents: number; hz: number }; // a steady vibrato on top
}

const VIBRATO_FADE_SEC = 0.15; // vibrato grows in over this, as singers do

// Cents (relative to note.pitch) at `t` seconds into the note. `previous` is the pitch of
// the note before (for glide), `duration` the note's length in seconds.
export function detuneAt(note: Note, t: number, duration: number, previous?: number): number {
  const e = note.expression ?? {};
  let cents = (e.bend ?? 1) * sungCents(note, t);

  if (e.glide && e.glide > 0 && previous !== undefined && t < e.glide) {
    cents += (previous - note.pitch) * 100 * ease(1 - t / e.glide);
  }
  if (e.slideIn && e.slideIn.sec > 0 && t < e.slideIn.sec) {
    cents += e.slideIn.semitones * 100 * ease(1 - t / e.slideIn.sec);
  }
  if (e.slideOut && e.slideOut.sec > 0) {
    const from = duration - e.slideOut.sec;
    if (t > from) cents += e.slideOut.semitones * 100 * ease((t - from) / e.slideOut.sec);
  }
  if (e.vibrato && e.vibrato.cents > 0) {
    cents += e.vibrato.cents * Math.sin(2 * Math.PI * e.vibrato.hz * t) * Math.min(1, t / VIBRATO_FADE_SEC);
  }
  return cents;
}

// Slides start fast and settle: x² of the remaining distance (1 → 0).
function ease(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c;
}

// The interpreted sung curve at t (linear between frames; held at the ends; 0 if none).
function sungCents(note: Note, t: number): number {
  const curve = note.interpretation?.curve;
  const times = note.curve?.t;
  if (!curve || !times || curve.length !== times.length || curve.length === 0) return 0;
  if (t <= times[0]) return curve[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
      return curve[i - 1] + (curve[i] - curve[i - 1]) * f;
    }
  }
  return curve[curve.length - 1];
}

// Whether the note bends at all (anything to draw or schedule).
export function bends(note: Note): boolean {
  const e = note.expression;
  const sung = (e?.bend ?? 1) > 0 && !!note.interpretation?.curve?.some((c) => Math.abs(c) >= 1);
  return sung || !!(e && (e.glide || e.slideIn?.semitones || e.slideOut?.semitones || e.vibrato?.cents));
}
