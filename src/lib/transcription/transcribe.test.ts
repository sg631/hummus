// The whole analysis (pYIN's HMM on neural pitch + the adapted Tony note model) on synthetic singing.
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPRESSION_SETTINGS, interpretNote } from './expression';
import { DEFAULT_NOTE_SETTINGS, buildNotes } from './notes';
import { RATE, breathyVoice, synth, voice, withBackground, withBurst } from './testing';
import { transcribeAudio } from './transcribe';

function transcribe(audio: Float32Array, settings = DEFAULT_NOTE_SETTINGS) {
  return buildNotes(transcribeAudio(audio, RATE), settings, { samples: audio, sampleRate: RATE });
}

const pitches = (audio: Float32Array, settings = DEFAULT_NOTE_SETTINGS) =>
  transcribe(audio, settings).map((n) => n.pitch);

// Notes one after another: [pitch or pitch-over-time, seconds] pairs; null is silence.
function phrase(parts: [number | ((t: number) => number) | null, number][]) {
  return (t: number) => {
    let at = 0;
    for (const [pitch, length] of parts) {
      if (t < at + length) return typeof pitch === 'function' ? pitch(t - at) : pitch;
      at += length;
    }
    return null;
  };
}

const seeds = [1, 2];

describe('transcription of synthetic singing', () => {
  it('separates notes, keeping vibrato inside one', () => {
    const vibrato = (t: number) => 67 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t);
    const notes = transcribe(synth(phrase([[60, 0.6], [null, 0.1], [64, 0.6], [null, 0.1], [vibrato, 1.2]]), 3));
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(notes[0].start).toBeLessThan(0.1);
    expect(notes[2].end).toBeGreaterThan(2.4);
  });

  it.each(seeds)('holds one note drifting around the halfway point (seed %i)', (seed) => {
    const drift = (t: number) => (t < 2.5 ? 60.5 + 0.15 * Math.sin(2 * Math.PI * 0.8 * t) : null);
    expect(pitches(voice(drift, 2.8, seed))).toHaveLength(1);
  });

  // 64.7 next to a note 30¢ sharp sits at the halfway point of the singer's tuning (±2¢
  // of tracker difference tips it), so it may be named either way, with the other as an
  // alternative.
  it.each(seeds)('names slightly sharp and flat notes (seed %i)', (seed) => {
    const notes = transcribe(voice(phrase([[60.3, 1], [null, 0.2], [64.7, 1]]), 2.5, seed));
    expect(notes.map((n) => n.pitch)).toHaveLength(2);
    expect(notes[0].pitch).toBe(60);
    expect([notes[1].pitch, ...notes[1].alternatives]).toContain(65);
  });

  it.each(seeds)('separates a legato semitone step (seed %i)', (seed) => {
    expect(pitches(voice(phrase([[60, 1], [61, 1]]), 2.3, seed))).toEqual([60, 61]);
  });

  it.each(seeds)('transcribes a legato scale (seed %i)', (seed) => {
    const scale = phrase([[60, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5]]);
    expect(pitches(voice(scale, 2.8, seed))).toEqual([60, 62, 64, 65, 67]);
  });

  it.each(seeds)('keeps a repeated note ("da da") as two notes (seed %i)', (seed) => {
    const gain = (t: number) => (t >= 0.8 && t < 0.86 ? 0.05 : 1);
    expect(pitches(voice((t) => (t < 1.8 ? 62 : null), 2.1, seed, gain))).toEqual([62, 62]);
  });

  it('names a wide-vibrato note by its center', () => {
    const wide = (t: number) => (t < 1.5 ? 67 + 0.5 * Math.sin(2 * Math.PI * 5.5 * t) : null);
    expect(pitches(voice(wide, 1.8))).toEqual([67]);
  });

  it('names a note reached by a legato glide by where it settles', () => {
    const glide = (t: number) => (t < 0.25 ? 62 + 2 * (t / 0.25) : 64);
    expect(pitches(voice(phrase([[62, 0.8], [glide, 0.85]]), 1.9))).toEqual([62, 64]);
  });
});

// Quick notes and slides: Tony's note model merged legato steps under ~¼ s into one note
// named by the median of both. Glides must still stay inside their notes.
describe('transcription of quick notes, slides and glides', () => {
  const glide = (from: number, to: number, seconds: number) => (t: number) =>
    t < seconds ? from + (to - from) * (t / seconds) : to;
  const run = (length: number) =>
    phrase([[null, 0.2], ...[60, 62, 64, 65, 67, 65, 64, 62].map((p): [number, number] => [p, length]), [60, 0.5]]);

  it.each([0.15, 0.12, 0.1])('transcribes a legato run, %f s a note', (length) => {
    expect(pitches(voice(run(length), 9 * length + 0.9))).toEqual([60, 62, 64, 65, 67, 65, 64, 62, 60]);
  });

  it('keeps an 80 ms grace note between two notes', () => {
    expect(pitches(voice(phrase([[null, 0.2], [60, 0.5], [64, 0.08], [62, 0.6]]), 1.6))).toEqual([60, 64, 62]);
  });

  it.each([
    [62, 64, 0.1],
    [60, 67, 0.15],
    [64, 60, 0.2],
    [64, 65, 0.2]
  ])('splits a slide from %i to %i (%f s) into its two notes', (from, to, seconds) => {
    const notes = transcribe(voice(phrase([[null, 0.2], [from, 0.6], [glide(from, to, seconds), 0.6]]), 1.6));
    expect(notes.map((n) => n.pitch)).toEqual([from, to]);
    expect(Math.abs(notes[1].sung - to)).toBeLessThan(0.1); // named by where it lands, not in between
  });

  it.each([
    [60, 0.15],
    [61, 0.1]
  ])('keeps a scoop up from %i (%f s) inside its note', (from, seconds) => {
    expect(pitches(voice(phrase([[null, 0.2], [glide(from, 62, seconds), 0.8]]), 1.3))).toEqual([62]);
  });

  it('keeps a fall-off inside its note', () => {
    const fall = (t: number) => (t < 0.6 ? 65 : 65 - (3 * (t - 0.6)) / 0.3);
    expect(pitches(voice(phrase([[null, 0.2], [fall, 0.9]]), 1.4))).toEqual([65]);
  });

  // A real take: up to a note (overshooting a little), down in a quick U below where the
  // phrase started, then up to the note again. The U was read as a "fall" and merged into
  // the high note, whose playback then bumped 2½ semitones above anything sung.
  it('keeps a quick dip between two notes as a note of its own', () => {
    const line = (a: number, b: number, d: number) => (t: number) => a + (b - a) * Math.min(1, t / d);
    const dip = phrase([
      [null, 0.2], [60, 0.5], [line(60, 64.3, 0.1), 0.1], [line(64.3, 64, 0.15), 0.2],
      [line(64, 58.5, 0.1), 0.1], [line(58.5, 60, 0.2), 0.2], [null, 0.08], [64, 0.4], [null, 0.2]
    ]);
    const notes = transcribe(voice(dip, 2.1));
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 59, 64]);
    for (const n of notes) {
      const played = interpretNote(n, DEFAULT_EXPRESSION_SETTINGS).curve;
      expect(Math.max(...played)).toBeLessThan(50); // nothing above the note that wasn't sung
    }
  });

  it('keeps vibrato of ±0.7 semitones as one note', () => {
    const wide = (t: number) => 64 + 0.7 * Math.sin(2 * Math.PI * 5.5 * t);
    expect(pitches(voice(phrase([[null, 0.2], [wide, 1.5]]), 2))).toEqual([64]);
  });
});

// Re-articulation: a new consonant on the same pitch is a new note; loudness wobble isn't.
describe('re-articulation', () => {
  const held = (t: number) => (t > 0.2 && t < 1.7 ? 62 : null);
  const dips = (gain: number, seconds: number) => (t: number) =>
    [0.7, 1.2].some((at) => t >= at && t < at + seconds) ? gain : 1;

  it.each([
    [0.05, 0.06],
    [0.3, 0.05],
    [0.5, 0.04] // a soft consonant: 6 dB down for 40 ms
  ])('splits "la la la" at dips to %f for %f s', (gain, seconds) => {
    expect(pitches(voice(held, 2, 1, dips(gain, seconds)))).toEqual([62, 62, 62]);
  });

  it('keeps a swell (crescendo) as one note', () => {
    const swell = (t: number) => 0.35 + 0.65 * Math.min(1, Math.max(0, (t - 0.4) / 0.8));
    expect(pitches(voice(held, 2, 1, swell))).toEqual([62]);
  });

  it('keeps a tremolo (±2 dB, 5 Hz) as one note', () => {
    expect(pitches(voice(held, 2, 1, (t) => 10 ** ((2 * Math.sin(2 * Math.PI * 5 * t)) / 20)))).toEqual([62]);
  });
});

// Articulation, read from how notes end and how hard they start.
describe('articulation', () => {
  const kinds = (audio: Float32Array) => transcribe(audio).map((n) => n.articulation.kind);

  it('marks a slurred run legato, up to its last note', () => {
    const run = phrase([[null, 0.2], [60, 0.3], [62, 0.3], [64, 0.3], [65, 0.6], [null, 0.3]]);
    expect(kinds(voice(run, 2))).toEqual(['legato', 'legato', 'legato', 'normal']);
  });

  it('marks short notes with rests between them staccato', () => {
    const detached = phrase([[null, 0.2], [62, 0.12], [null, 0.28], [64, 0.12], [null, 0.28], [65, 0.6], [null, 0.3]]);
    expect(kinds(voice(detached, 2))).toEqual(['staccato', 'staccato', 'normal']);
  });

  it('marks re-articulated notes ("la la") normal, not legato', () => {
    const dips = (t: number) => ([0.7, 1.2].some((at) => t >= at && t < at + 0.05) ? 0.3 : 1);
    expect(kinds(voice((t) => (t > 0.2 && t < 1.7 ? 62 : null), 2, 1, dips))).toEqual(['normal', 'normal', 'normal']);
  });

  it('marks an accented note', () => {
    const melody = phrase([[null, 0.2], [60, 0.4], [null, 0.1], [62, 0.4], [null, 0.1], [64, 0.4], [null, 0.1], [65, 0.4], [null, 0.3]]);
    const hit = (t: number) => (t >= 1.2 && t < 1.27 ? 2.5 : 1); // the third note's first 70 ms, +8 dB
    expect(transcribe(voice(melody, 2.4, 1, hit)).map((n) => n.articulation.accent)).toEqual([false, false, true, false]);
  });
});

// Quiet, breathy singing over room noise: YIN found no notes at all here.
describe('breathy singing', () => {
  const scale = phrase([
    [null, 0.3], [60, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [null, 0.15],
    [67, 0.4], [65, 0.4], [64, 0.4], [62, 0.4], [60, 0.8], [null, 0.3]
  ]);
  it.each([
    [1.5, 1],
    [2, 4],
    [3, 8]
  ])('transcribes a scale with breath %f over room noise ×%i', (breath, room) => {
    expect(pitches(breathyVoice(scale, 5.4, breath, room))).toEqual([60, 62, 64, 65, 67, 67, 65, 64, 62, 60]);
  });
});

// The complaints from a real take.
describe('transcription of a real-world take', () => {
  // C D E G E C, all ~35 cents flat; the first E 62 cents flat.
  const flatSinger = phrase([
    [59.65, 0.6], [null, 0.1], [61.65, 0.6], [null, 0.1], [63.38, 0.6], [null, 0.1],
    [66.65, 0.6], [null, 0.1], [63.65, 0.6], [null, 0.1], [59.65, 0.6]
  ]);

  it("names notes relative to the singer's own tuning", () => {
    const notes = transcribe(voice(flatSinger, 4.5));
    expect(notes.map((n) => n.pitch)).toEqual([60, 62, 64, 67, 64, 60]);
    expect(notes[1].referenceCents).toBeLessThan(-15);
  });

  it('can name notes against A440 instead', () => {
    const absolute = { ...DEFAULT_NOTE_SETTINGS, relativeTuning: false };
    expect(pitches(voice(flatSinger, 4.5), absolute)).toEqual([60, 62, 63, 67, 64, 60]);
  });

  it.each(seeds)('finds no note in a cut-off gap with a breath in it (seed %i)', (seed) => {
    const audio = withBurst(voice(phrase([[50, 1], [null, 0.4], [48, 1]]), 2.7, seed), 1.1, 0.2, 0.15);
    expect(pitches(audio)).toEqual([50, 48]);
  });

  it.each(seeds)('treats a wobbly attack as part of its note (seed %i)', (seed) => {
    const attack = (t: number) => (t < 0.2 ? 48 - 0.8 * (1 - t / 0.2) : 48);
    expect(pitches(voice(phrase([[50, 1], [null, 0.25], [attack, 1.2]]), 2.7, seed))).toEqual([50, 48]);
  });

  it.each(seeds)('ignores steady background noise (seed %i)', (seed) => {
    const melody = phrase([[null, 0.5], [60, 0.8], [null, 0.6], [64, 0.8], [null, 0.6]]);
    expect(pitches(withBackground(voice(melody, 3.3, seed), 0.03, seed))).toEqual([60, 64]);
  });
});
