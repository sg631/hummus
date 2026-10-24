// What was sung → what plays back. Non-destructive: the sung curve is never changed.
//
// The sung pitch (in cents around the note) splits into layers by speed:
//   offset  the note's overall pitch error
//   slow    movement over ~¼ s and longer: drift, scoops into the note, fall-offs
//   vibrato wobble a few times a second
//   jitter  anything faster: the voice's natural roughness and tracking noise
// Jitter is always removed (a synth makes it sound like a broken tone); the rest is kept
// by the amounts in the settings.
import { median } from '$lib/music/math';
import type { Interpretation } from '$lib/music/types';
import type { TranscribedNote } from './types';

export interface ExpressionSettings {
  correction: number; // 0–1: pull an off-pitch note onto the exact note
  vibrato: number;    // 0–1: keep vibrato (0 = none)
  drift: number;      // 0–1: keep slow movement: drift, scoops and fall-offs (0 = steady notes)
}

export const DEFAULT_EXPRESSION_SETTINGS: ExpressionSettings = {
  correction: 0.8,
  vibrato: 0.5,
  drift: 0.2
};

const BODY = [0.2, 0.8]; // the note's middle, away from attack and release
const SLOW_SEC = 0.25;   // averaging over this separates slow movement from vibrato
const JITTER_SEC = 0.05; // ...and over this, vibrato from jitter

export function interpretNote(note: TranscribedNote, s: ExpressionSettings): Interpretation {
  const t = note.curve.t;
  const sung = note.curve.pitch.map((m) => (m - note.pitch) * 100); // cents
  const base = { pitch: note.pitch, correction: s.correction, vibrato: s.vibrato, drift: s.drift };
  if (sung.length === 0) return { ...base, offsetCents: 0, driftCents: 0, curve: [] };

  const from = Math.floor(sung.length * BODY[0]);
  const to = Math.max(from + 1, Math.ceil(sung.length * BODY[1]));
  const offset = median(sung.slice(from, to));

  const slow = average(t, sung, SLOW_SEC);
  const smooth = average(t, sung, JITTER_SEC);
  const kept = (1 - s.correction) * offset;
  const curve = sung.map((_, i) => {
    const cents = kept + s.drift * (slow[i] - offset) + s.vibrato * (smooth[i] - slow[i]);
    return Math.round(cents * 10) / 10;
  });

  return {
    ...base,
    offsetCents: offset,
    driftCents: trend(t.slice(from, to), slow.slice(from, to)),
    curve
  };
}

// Centred moving average over `windowSec`, by time (frames can be unevenly spaced).
function average(t: number[], values: number[], windowSec: number): number[] {
  const half = windowSec / 2;
  const result = new Array<number>(values.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    while (hi < values.length && t[hi] <= t[i] + half) sum += values[hi++];
    while (t[lo] < t[i] - half) sum -= values[lo++];
    result[i] = sum / (hi - lo);
  }
  return result;
}

// Pitch change across the stretch, from a straight-line fit: steady movement counts,
// wobble around a steady pitch averages out.
function trend(t: number[], cents: number[]): number {
  const n = t.length;
  if (n < 2) return 0;
  const mt = t.reduce((a, b) => a + b, 0) / n;
  const mc = cents.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (t[i] - mt) * (cents[i] - mc);
    den += (t[i] - mt) ** 2;
  }
  return den > 0 ? (num / den) * (t[n - 1] - t[0]) : 0;
}
