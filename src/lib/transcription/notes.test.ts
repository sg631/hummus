import { describe, expect, it } from 'vitest';
import { interpretNote } from './expression';
import { DEFAULT_NOTE_SETTINGS, alternatives, buildNotes, tuningReference } from './notes';
import type { Analysis } from './types';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// An analysis with the given notes ([fractional MIDI, start, duration]) and a pitch
// track that holds each note's pitch (plus optional vibrato, in cents).
function analysis(notes: [number, number, number][], vibrato = 0): Analysis {
  const track = { times: [] as number[], hz: [] as number[], prob: [] as number[] };
  for (let t = 0; t < 10; t += 0.006) {
    const n = notes.find(([, start, length]) => t >= start && t < start + length);
    track.times.push(t);
    track.hz.push(n ? hz(n[0] + (vibrato / 100) * Math.sin(2 * Math.PI * 5 * t)) : 0);
    track.prob.push(n ? 0.9 : 0.1);
  }
  return {
    notes: notes.map(([midi, time, duration]) => ({ time, duration, freq: hz(midi), clarity: 0.9 })),
    track
  };
}

const pitches = (a: Analysis, s = DEFAULT_NOTE_SETTINGS) => buildNotes(a, s).map((n) => n.pitch);

describe('tuningReference', () => {
  const spans = [0, 1, 2, 3].map((i) => ({ start: i, end: i + 0.8 }));

  it('is the offset the other notes share', () => {
    const sung = [59.7, 61.7, 63.7, 64.7]; // all 30 cents flat
    // Three other notes (2.4 s of singing): close to their shared -30.
    expect(tuningReference(0, spans, sung, 8)).toBeLessThan(-20);
    expect(tuningReference(0, spans, sung, 8)).toBeGreaterThan(-30);
  });

  it('trusts a single other note only partly', () => {
    const r = tuningReference(0, spans.slice(0, 2), [60, 61.7], 8); // the other note: -30
    expect(r).toBeLessThan(-10);
    expect(r).toBeGreaterThan(-25);
  });

  it('averages across the ±50 wrap', () => {
    // +45, -45, +45 are all near the halfway point; a plain average would say +15.
    const long = [0, 3, 6, 9].map((i) => ({ start: i, end: i + 2.5 }));
    const r = tuningReference(0, long, [60, 61.45, 62.55, 63.45], 8);
    expect(Math.abs(r)).toBeGreaterThan(25); // ~45 with full trust; the wrong answers are ~12–15
  });
});

describe('alternatives', () => {
  const steady = (m: number) => Array(100).fill(m);

  it('is empty for a clearly sung note', () => {
    expect(alternatives(62.2, steady(62.2))).toEqual([]);
  });

  it('gives the neighbour for a note near halfway', () => {
    expect(alternatives(62.6, steady(62.6))).toEqual([62]); // D+60: named Eb, could be D
    expect(alternatives(61.6, steady(61.6))).toEqual([61]);
  });

  it('gives where a never-settling scoop starts and ends', () => {
    const scoop = Array.from({ length: 100 }, (_, i) => 58.1 + (1.9 * i) / 99); // Bb up to C
    expect(alternatives(59, scoop)).toEqual([58, 60]);
  });
});

describe('buildNotes', () => {
  it('names notes relative to the singer\'s tuning', () => {
    // A singer 35 cents flat, with one note 62 cents flat (absolutely nearer Eb than E).
    const a = analysis([[59.65, 0, 0.6], [61.65, 0.7, 0.6], [63.38, 1.4, 0.6], [66.65, 2.1, 0.6], [63.65, 2.8, 0.6]]);
    expect(pitches(a)).toEqual([60, 62, 64, 67, 64]);
    expect(pitches(a, { ...DEFAULT_NOTE_SETTINGS, relativeTuning: false })).toEqual([60, 62, 63, 67, 64]);
  });

  it('names an in-tune singer\'s notes exactly', () => {
    expect(pitches(analysis([[60, 0, 0.5], [61, 0.5, 0.5], [62, 1, 0.5]]))).toEqual([60, 61, 62]);
  });

  it('attaches the pitch track inside each note as its curve', () => {
    const [note] = buildNotes(analysis([[69, 1, 0.5]], 30));
    expect(note.curve.t.length).toBeGreaterThan(70);
    expect(note.curve.t[0]).toBeGreaterThanOrEqual(0);
    expect(Math.max(...note.curve.pitch) - Math.min(...note.curve.pitch)).toBeGreaterThan(0.5);
  });

  it('drops notes shorter than the minimum', () => {
    const a = analysis([[60, 0, 0.12], [62, 0.5, 0.5]]);
    expect(pitches(a, { ...DEFAULT_NOTE_SETTINGS, minNoteSec: 0.2 })).toEqual([62]);
  });

  it('measures velocity from the audio', () => {
    const rate = 8000;
    const samples = new Float32Array(rate * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = (i < rate ? 0.05 : 0.5) * Math.sin(i / 3);
    const [soft, loud] = buildNotes(analysis([[60, 0.2, 0.6], [62, 1.2, 0.6]]), DEFAULT_NOTE_SETTINGS, {
      samples,
      sampleRate: rate
    });
    expect(loud.velocity).toBeGreaterThan(soft.velocity);
  });
});

describe('interpretNote', () => {
  // Sung 30 cents sharp with ±40 cents of vibrato.
  const [note] = buildNotes(analysis([[69.3, 0.5, 1.2]], 40), {
    ...DEFAULT_NOTE_SETTINGS,
    relativeTuning: false
  });

  it('measures and corrects the offset', () => {
    const interp = interpretNote(note, { correction: 1, vibrato: 1, drift: 1 });
    expect(interp.offsetCents).toBeGreaterThan(20);
    expect(interp.offsetCents).toBeLessThan(40);
    const mid = interp.curve.slice(20, -20);
    expect(Math.abs(mid.reduce((a, b) => a + b, 0) / mid.length)).toBeLessThan(10);
  });

  const range = (c: number[]) => Math.max(...c) - Math.min(...c);

  it('keeps vibrato by its own amount', () => {
    expect(range(interpretNote(note, { correction: 1, vibrato: 1, drift: 0 }).curve)).toBeGreaterThan(50);
    expect(range(interpretNote(note, { correction: 1, vibrato: 0, drift: 0 }).curve)).toBeLessThan(10);
  });

  it('reports no drift for vibrato around a steady pitch', () => {
    expect(Math.abs(interpretNote(note, { correction: 1, vibrato: 1, drift: 1 }).driftCents)).toBeLessThan(15);
  });

  it('always removes fast jitter', () => {
    // ±20 cents at 30 Hz: roughness, not vibrato.
    const [rough] = buildNotes(analysis([[60, 0.5, 1]], 0), DEFAULT_NOTE_SETTINGS);
    rough.curve.pitch = rough.curve.t.map((t) => 60 + 0.2 * Math.sin(2 * Math.PI * 30 * t));
    expect(range(interpretNote(rough, { correction: 1, vibrato: 1, drift: 1 }).curve)).toBeLessThan(12);
  });

  it('keeps slow drift by its own amount', () => {
    const [sag] = buildNotes(analysis([[60, 0.5, 1]], 0), DEFAULT_NOTE_SETTINGS);
    sag.curve.pitch = sag.curve.t.map((t) => 60 - 0.4 * t); // sags 40 cents over the note
    const interp = interpretNote(sag, { correction: 1, vibrato: 0, drift: 1 });
    expect(interp.driftCents).toBeLessThan(-15);
    expect(range(interpretNote(sag, { correction: 1, vibrato: 0, drift: 0 }).curve)).toBeLessThan(1);
  });
});
