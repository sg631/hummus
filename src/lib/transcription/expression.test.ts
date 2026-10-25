// What was sung → what plays back, on made-up pitch curves (cents around one note).
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPRESSION_SETTINGS, interpretNote } from './expression';
import type { TranscribedNote } from './types';

const STEP = 256 / 44100; // pYIN's frame spacing

// A note at MIDI 60 whose sung pitch is `cents(t)` around it, for `seconds`.
function note(cents: (t: number) => number, seconds: number): TranscribedNote {
  const t = Array.from({ length: Math.round(seconds / STEP) }, (_, i) => i * STEP);
  const pitch = t.map((x) => 60 + cents(x) / 100);
  return {
    id: 'n', pitch: 60, alternatives: [], start: 0, end: seconds, velocity: 0.8,
    curve: { t, pitch, raw: pitch, db: t.map(() => -20) }, sung: 60, referenceCents: 0,
    articulation: { kind: 'normal', accent: false, accentDb: 0 }
  };
}

// Seeded, smoothed random movement: a voice's unsteadiness, not periodic.
function wobble(seed: number, depth: number) {
  let s = seed;
  const random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
  const points = Array.from({ length: 200 }, random); // a new random point every 30 ms
  return (t: number) => {
    const x = t / 0.03;
    const i = Math.floor(x);
    const f = (1 - Math.cos(Math.PI * (x - i))) / 2;
    return depth * 2 * (points[i] + (points[i + 1] - points[i]) * f);
  };
}

const only = { ...DEFAULT_EXPRESSION_SETTINGS, correction: 1, drift: 0, vibrato: 1 }; // the vibrato band alone
const middle = (c: number[], t: number[], end: number) => c.filter((_, i) => t[i] > 0.2 && t[i] < end - 0.2);
const peak = (values: number[]) => Math.max(...values.map(Math.abs));

describe('vibrato', () => {
  it.each([4.5, 5.5, 7])('keeps real vibrato (%f Hz)', (rate) => {
    const n = note((t) => 40 * Math.sin(2 * Math.PI * rate * t), 1.5);
    const { curve } = interpretNote(n, only);
    expect(peak(middle(curve, n.curve.t, 1.5))).toBeGreaterThan(20);
  });

  it.each([1, 2, 3, 4])("drops a voice's random unsteadiness (seed %i)", (seed) => {
    const n = note(wobble(seed, 25), 1.5);
    expect(peak(interpretNote(n, only).curve)).toBe(0);
  });

  it('keeps a quick scoop into the note out of the vibrato band', () => {
    const scoop = (t: number) => (t < 0.06 ? -150 * (1 - t / 0.06) : 0);
    const { curve } = interpretNote(note(scoop, 0.8), only);
    expect(peak(curve)).toBe(0);
  });

  it('fades vibrato in at the start of the note', () => {
    const n = note((t) => 40 * Math.sin(2 * Math.PI * 5.5 * t + 1), 1.5);
    const { curve } = interpretNote(n, only);
    expect(Math.abs(curve[0])).toBe(0);
  });
});

describe('edges and gestures (defaults)', () => {
  const play = (cents: (t: number) => number, seconds: number) => interpretNote(note(cents, seconds), DEFAULT_EXPRESSION_SETTINGS);
  const settled = (from: number, depth: number, seconds: number) => (t: number) =>
    t < seconds ? from + (depth - from) * (t / seconds) : depth;

  it('plays a quick step into the note as a clean start (just changing note)', () => {
    const r = play(settled(-150, 0, 0.04), 0.8);
    expect(peak(r.curve)).toBeLessThan(5);
    expect(r.scoop).toBeUndefined();
  });

  it('plays a slow small drift in as a clean start', () => {
    const r = play(settled(-90, 0, 0.2), 0.8);
    expect(peak(r.curve)).toBeLessThan(5);
  });

  it('keeps a clear scoop in full, and reports it', () => {
    const r = play(settled(-200, 0, 0.2), 0.8);
    expect(r.scoop?.cents).toBeLessThan(-150);
    expect(Math.min(...r.curve)).toBeLessThan(-150); // played, not a fraction of it
  });

  it('keeps a clear fall in full, and reports it', () => {
    const r = play((t) => (t < 0.6 ? 0 : -300 * ((t - 0.6) / 0.25)), 0.85);
    expect(r.fall?.cents).toBeLessThan(-200);
    expect(Math.min(...r.curve)).toBeLessThan(-200);
  });

  it('drops a quick release at the end', () => {
    const r = play((t) => (t < 0.77 ? 0 : -150 * ((t - 0.77) / 0.03)), 0.8);
    expect(peak(r.curve)).toBeLessThan(5);
    expect(r.fall).toBeUndefined();
  });

  it("corrects the note's pitch error fully, and drops wander inside it", () => {
    const r = play((t) => 35 + 20 * Math.sin(2 * Math.PI * 1.2 * t), 1.5);
    expect(peak(r.curve)).toBeLessThan(5);
  });

  it('can keep a fraction of a gesture, or none', () => {
    const n = note(settled(-200, 0, 0.2), 0.8);
    expect(Math.min(...interpretNote(n, { ...DEFAULT_EXPRESSION_SETTINGS, gestures: 0 }).curve)).toBeGreaterThan(-5);
  });
});
