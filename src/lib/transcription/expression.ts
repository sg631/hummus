// What was sung → what plays back. Non-destructive: the sung curve is never changed.
//
// A note's sung pitch (cents around the note) is read as parts:
//   offset   the note's overall pitch error
//   edges    how the voice got into and out of the note
//   drift    slow wander in its body (over ~¼ s and longer)
//   vibrato  periodic wobble 4–8 times a second in its body
//   jitter   anything faster: the voice's roughness and tracking noise
//
// Kept or dropped by what they are, not by a fraction of everything. A fraction of a
// pitch error is still a pitch error, and a fraction of a scoop is just a flat attack: on
// real takes that made playback slide where nothing was meant and lose the gestures that
// were. So by default the offset, the drift and the jitter go; the quick step into and
// out of each note (the mechanics of changing note: tens of ms, often a semitone or two)
// goes; and a clear gesture at an edge (a scoop into the note, a slide from the last, a
// fall off it: at least `gestureCents` deep and `gestureSec` long) stays in full. Vibrato
// is kept only where it really is periodic: anything else in that band (unsteadiness)
// would sound like a wavering, out-of-tune note on a steady synth tone.
import { median } from '$lib/music/math';
import type { Gesture, Interpretation } from '$lib/music/types';
import type { TranscribedNote } from './types';

export interface ExpressionSettings {
  correction: number;   // 0–1: pull the note's pitch error onto the exact note
  vibrato: number;      // 0–1: keep (real) vibrato
  drift: number;        // 0–1: keep slow wander inside the note
  gestures: number;     // 0–1: keep scoops, slides and falls at its edges
  gestureCents: number; // an edge movement this deep...
  gestureSec: number;   // ...and this long is a gesture; shorter or shallower is mechanics
}

export const DEFAULT_EXPRESSION_SETTINGS: ExpressionSettings = {
  correction: 1,
  vibrato: 0.5,
  drift: 0,
  gestures: 1,
  gestureCents: 150,
  gestureSec: 0.15
};

const HELD_CENTS = 50;   // the note's pitch: the 100¢ band its frames crowd into most
const SETTLED_CENTS = 30; // within this of its pitch, the voice has arrived
const SLOW_SEC = 0.25;   // averaging over this separates slow movement from vibrato
const JITTER_SEC = 0.05; // ...and over this, vibrato from jitter
const VIBRATO_HZ = [4, 8];    // sung vibrato's rate
const PERIODIC = 0.5;         // autocorrelation at the vibrato's period: above this, it's vibrato
const EDGE_SEC = 0.1;         // vibrato fades in and out over this at the body's edges

export function interpretNote(note: TranscribedNote, s: ExpressionSettings): Interpretation {
  const t = note.curve.t;
  const sung = note.curve.pitch.map((m) => (m - note.pitch) * 100); // cents
  const base = { pitch: note.pitch, correction: s.correction, vibrato: s.vibrato, drift: s.drift, gestures: s.gestures };
  if (sung.length === 0) return { ...base, offsetCents: 0, driftCents: 0, curve: [] };

  const smooth = average(t, sung, JITTER_SEC);
  const offset = heldPitch(smooth);

  // the body: from where the voice first settles to where it last leaves
  let first = smooth.findIndex((c) => Math.abs(c - offset) <= SETTLED_CENTS);
  if (first < 0) first = 0;
  let last = smooth.length - 1;
  while (last > first && Math.abs(smooth[last] - offset) > SETTLED_CENTS) last--;
  const scoop = gesture(t, smooth, offset, 0, first, s);
  const fall = gesture(t, smooth, offset, last + 1, smooth.length, s);

  // body layers, measured with the edges held at the note's pitch (so they can't leak in)
  const held = sung.map((c, i) => (i < first || i > last ? offset : c));
  const slow = average(t, held, SLOW_SEC);
  const band = average(t, held, JITTER_SEC).map((v, i) => v - slow[i]);
  const bodyStart = t[first];
  const bodyEnd = t[last];
  const inBody = (i: number) => i >= first && i <= last;
  const vibrato = isVibrato(t, band, bodyStart, bodyEnd) ? s.vibrato : 0;

  const kept = (1 - s.correction) * offset;
  const curve = sung.map((_, i) => {
    let cents = kept;
    if (inBody(i)) cents += s.drift * (slow[i] - offset) + vibrato * edgeFade(t[i], bodyStart, bodyEnd) * band[i];
    else if ((i < first && scoop) || (i > last && fall)) cents += s.gestures * (smooth[i] - offset);
    return Math.round(cents * 10) / 10;
  });

  return {
    ...base,
    offsetCents: offset,
    driftCents: trend(t.slice(first, last + 1), slow.slice(first, last + 1)),
    ...(scoop ? { scoop } : {}),
    ...(fall ? { fall } : {}),
    curve
  };
}

// Where the voice held: the median of the frames in the 100¢ band holding the most of
// them. Not the median of the note's middle: anything else inside the note (a dip, a long
// scoop) would shift that, and the edges would then be read against the wrong pitch.
function heldPitch(cents: number[]): number {
  const sorted = [...cents].sort((a, b) => a - b);
  let best = [0, 0]; // [from, to) indices of the most crowded band
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (j < sorted.length && sorted[j] - sorted[i] <= 2 * HELD_CENTS) j++;
    if (j - i > best[1] - best[0]) best = [i, j];
  }
  return median(sorted.slice(best[0], best[1]));
}

// The movement over frames [from, to) at a note's edge, if it's a gesture: deep and long
// enough. Its cents are its furthest point from the note's pitch (signed).
function gesture(
  t: number[],
  smooth: number[],
  offset: number,
  from: number,
  to: number,
  s: ExpressionSettings
): Gesture | undefined {
  if (to - from < 2) return undefined;
  const sec = t[to - 1] - t[from];
  let peak = 0;
  for (let i = from; i < to; i++) if (Math.abs(smooth[i] - offset) > Math.abs(peak)) peak = smooth[i] - offset;
  if (sec < s.gestureSec || Math.abs(peak) < s.gestureCents) return undefined;
  return { cents: Math.round(peak), sec: Math.round(sec * 1000) / 1000 };
}

// Whether the vibrato band (inside the body, away from its edges) repeats with a
// vibrato's period, for at least two cycles: normalized autocorrelation at some lag
// within the vibrato rates. A voice's random unsteadiness, and a single bend, don't repeat.
export function isVibrato(t: number[], band: number[], start: number, end: number): boolean {
  const body = band.filter((_, i) => t[i] >= start + EDGE_SEC && t[i] <= end - EDGE_SEC);
  if (body.length < 3) return false;
  const step = median(t.slice(1).map((v, i) => v - t[i])); // frame spacing
  const shortest = Math.round(1 / VIBRATO_HZ[1] / step);
  const longest = Math.round(1 / VIBRATO_HZ[0] / step);
  let best = -1;
  for (let lag = Math.max(1, shortest); lag <= longest && 2 * lag <= body.length; lag++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i + lag < body.length; i++) {
      ab += body[i] * body[i + lag];
      aa += body[i] * body[i];
      bb += body[i + lag] * body[i + lag];
    }
    if (aa > 0 && bb > 0) best = Math.max(best, ab / Math.sqrt(aa * bb));
  }
  return best >= PERIODIC;
}

// 0 at the body's edges rising to 1 over EDGE_SEC (raised cosine), so vibrato fades in and out.
function edgeFade(time: number, start: number, end: number): number {
  const d = Math.min(time - start, end - time) / EDGE_SEC;
  return d >= 1 ? 1 : d <= 0 ? 0 : (1 - Math.cos(Math.PI * d)) / 2;
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
