// Choosing the grid per beat from played onsets.
import { describe, expect, it } from 'vitest';
import { AUTO_GRID, analyzeRhythm, quantizeNotes } from './quantize';
import { chooseGrid, fitRhythm } from './rhythm';


import { PPQ, type TimeSignature } from './time';

const estimateSwing = (onsets: number[], timeSignature?: TimeSignature) =>
  fitRhythm(onsets, { timeSignature }).measuredSwing;

// Seeded timing wobble, ±`spread` beats.
function humanize(beats: number[], spread = 0.04, seed = 1): number[] {
  let s = seed;
  const random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
  return beats.map((b) => Math.max(0, Math.round((b + 2 * spread * random()) * PPQ)));
}
const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);
const divisions = (onsets: number[], options = {}) =>
  chooseGrid(onsets, options).map((c) => (c.length === 2 * PPQ ? `${c.divisions}/2` : c.divisions));
const notesAt = (starts: number[], length = PPQ * 0.3) =>
  starts.map((start, i) => ({ id: String(i), pitch: 60, start, duration: Math.round(length), velocity: 0.8 }));

describe('rhythm quantization', () => {
  it.each([1, 2, 3])('hears straight eighths (seed %i)', (seed) => {
    expect(divisions(humanize(range(0, 4, 0.5), 0.04, seed))).toEqual([2, 2, 2, 2]);
  });

  it.each([1, 2, 3])('hears eighth triplets (seed %i)', (seed) => {
    expect(divisions(humanize(range(0, 4, 1 / 3), 0.04, seed))).toEqual([3, 3, 3, 3]);
  });

  it.each([1, 2, 3])('hears sixteenths (seed %i)', (seed) => {
    expect(divisions(humanize(range(0, 2, 0.25), 0.03, seed))).toEqual([4, 4]);
  });

  it.each([1, 2, 3])('hears quarter-note triplets (seed %i)', (seed) => {
    expect(divisions(humanize([0, 2 / 3, 4 / 3, 2.5, 3.5], 0.04, seed))).toEqual(['3/2', 2, 2]);
  });

  it.each([1, 2, 3])('switches feel where the rhythm clearly does (seed %i)', (seed) => {
    const onsets = humanize([...range(0, 2, 0.5), ...range(2, 4, 1 / 3), 4.5], 0.03, seed);
    expect(divisions(onsets)).toEqual([2, 2, 3, 3, 2]);
  });

  it('keeps quarter notes plain', () => {
    expect(divisions(humanize([0, 1, 2, 3], 0.05))).toEqual([1, 1, 1, 1]);
  });

  it('keeps lightly swung eighths straight', () => {
    expect(divisions(humanize([0, 0.55, 1, 1.55, 2, 2.55, 3, 3.55], 0.02))).toEqual([2, 2, 2, 2]);
  });

  it('reports no alternative where every grid places the notes alike', () => {
    expect(chooseGrid(humanize([0, 1, 2, 3], 0.03)).some((c) => c.alternative)).toBe(false);
  });

  it('reports a borderline swing as ambiguous', () => {
    const cells = chooseGrid([0, 0.6, 1, 1.6].map((b) => b * PPQ));
    expect(cells.some((c) => c.alternative)).toBe(true);
  });
});

describe('auto quantize', () => {
  it('snaps eighths, then triplets, each to their own grid', () => {
    const starts = humanize([0, 0.5, 1, 1.5, 2, 2 + 1 / 3, 2 + 2 / 3, 3], 0.03);
    const q = quantizeNotes(notesAt(starts), { grid: AUTO_GRID, strength: 1, durations: true, swing: 0.5 });
    expect(q.map((n) => n.start)).toEqual([0, 240, 480, 720, 960, 1120, 1280, 1440]);
    expect(q.slice(0, 4).every((n) => n.duration === 240)).toBe(true); // an eighth
    expect(q.slice(5, 7).every((n) => n.duration === 160)).toBe(true); // a triplet eighth
  });
});

describe('swing', () => {
  const swung = (place: number, beats = 4) => Array.from({ length: beats }, (_, b) => [b, b + place]).flat();

  it.each([0.58, 0.62, 2 / 3, 0.7])('measures swing at %f', (place) => {
    expect(estimateSwing(humanize(swung(place), 0.02))).toBeCloseTo(place, 1);
  });

  it('measures straight eighths as straight', () => {
    expect(estimateSwing(humanize(swung(0.5), 0.02))).toBe(0.5);
  });

  it("doesn't guess swing from too few off-beats", () => {
    expect(estimateSwing(humanize([0, 0.62, 1, 2, 3]))).toBeNull();
  });

  it('reads triplet swing as swung eighths, not triplets, when the take swings', () => {
    const onsets = humanize(swung(2 / 3), 0.02);
    const { swing, cells } = analyzeRhythm(notesAt(onsets), { grid: AUTO_GRID, strength: 1, durations: true, swing: 'auto' });
    expect(swing).toBeCloseTo(2 / 3, 1);
    expect(cells.map((c) => c.divisions)).toEqual([2, 2, 2, 2]);
  });

  it('snaps off-beats to the swing, keeping the feel', () => {
    const q = quantizeNotes(notesAt(humanize(swung(0.62), 0.02)), { grid: AUTO_GRID, strength: 1, durations: false, swing: 0.62 });
    expect(q.map((n) => n.start % PPQ)).toEqual([0, 298, 0, 298, 0, 298, 0, 298]); // 0.62 of a beat
  });

  it('can be told to play it straight', () => {
    const q = quantizeNotes(notesAt(humanize(swung(0.58), 0.02)), { grid: AUTO_GRID, strength: 1, durations: false, swing: 0.5 });
    expect(q.map((n) => n.start % PPQ)).toEqual([0, 240, 0, 240, 0, 240, 0, 240]);
  });
});

describe('time signatures', () => {
  const dotted = PPQ * 1.5; // the beat of 6/8

  it('hears eighths in 6/8 as the plain split of its beat', () => {
    const onsets = humanize([0, 1, 2, 3, 4, 5].map((e) => e / 3), 0.02).map((t) => Math.round(t * 1.5));
    expect(chooseGrid(onsets, { timeSignature: [6, 8] }).map((c) => [c.length, c.divisions])).toEqual([
      [dotted, 3],
      [dotted, 3]
    ]);
  });

  it('hears duplets in 6/8 as a tuplet', () => {
    const onsets = humanize([0, 0.5, 1, 1.5], 0.02).map((t) => Math.round(t * 1.5));
    expect(chooseGrid(onsets, { timeSignature: [6, 8] }).map((c) => c.divisions)).toEqual([2, 2]);
  });

  it('beats eighths in 7/8', () => {
    const eighth = PPQ / 2;
    const onsets = [0, 1, 2, 3, 4, 5, 6].map((e) => e * eighth + 7);
    expect(chooseGrid(onsets, { timeSignature: [7, 8] }).every((c) => c.length === eighth)).toBe(true);
  });

  it("doesn't swing compound time", () => {
    expect(estimateSwing([0, 300, 720, 1020, 1440, 1740, 2160, 2460], [6, 8])).toBeNull();
  });
});

// A singer: a line of [beat] positions (x.5 = the off-beat eighth), swung, with timing
// wobble and a steady lateness in seconds, at a tempo.
function sung(line: number[], swing: number, bpm: number, lateSec: number, seed = 1) {
  let s = seed;
  const random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
  const beatSec = 60 / bpm;
  return line.map((b) => {
    const place = Math.floor(b) + (b % 1 ? swing : 0);
    return Math.max(0, Math.round((place + (0.06 * random() + lateSec) / beatSec) * PPQ));
  });
}
// two bars of a swing line: eighths, a push, long notes
const LINE = [0, 0.5, 1, 1.5, 2, 2.5, 3.5, 4.5, 5, 5.5, 6, 7, 7.5];

describe('swing as sung', () => {
  it.each([
    [100, 0.6, 0.04],
    [140, 0.66, 0.04],
    [180, 0.66, 0.04],
    [180, 0.72, 0],
    [220, 0.6, 0.04]
  ])('reads a swing line at %i BPM (swing %f, %f s late) as swung eighths, not sixteenths', (bpm, swing, late) => {
    const notes = notesAt(sung(LINE, swing, bpm, late));
    const r = analyzeRhythm(notes, { grid: AUTO_GRID, strength: 1, durations: true, swing: 'auto' }, [4, 4], bpm);
    expect(r.cells.every((c) => c.divisions <= 2)).toBe(true);
    expect(r.measuredSwing).not.toBeNull();
    // ±30 ms of wobble is ±0.11 beat at 220 BPM: from 13 notes the swing scatters a few
    // hundredths either way (the grid, which is what's heard, doesn't)
    expect(Math.abs(r.measuredSwing! - swing)).toBeLessThan(0.1);
  });

  it("measures the singer's lateness", () => {
    const late = 0.04; // s
    const r = analyzeRhythm(notesAt(sung(LINE, 0.62, 120, late)), { grid: AUTO_GRID, strength: 1, durations: true }, [4, 4], 120);
    expect(Math.abs(r.offset - late * 2 * PPQ)).toBeLessThan(0.02 * 2 * PPQ); // within 20 ms
  });

  it('never puts two notes on one tick', () => {
    for (const bpm of [140, 180, 220]) {
      const notes = notesAt(sung(LINE, 0.72, bpm, 0.04));
      const q = quantizeNotes(notes, { grid: AUTO_GRID, strength: 1, durations: false, swing: 'auto' }, [4, 4], bpm);
      expect(new Set(q.map((n) => n.start)).size).toBe(q.length);
    }
  });
});
