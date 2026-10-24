// The whole analysis (pYIN + Tony's note model) on synthetic singing.
import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_SETTINGS, buildNotes } from './notes';
import { RATE, synth, voice, withBackground, withBurst } from './testing';
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

  it.each(seeds)('names slightly sharp and flat notes (seed %i)', (seed) => {
    expect(pitches(voice(phrase([[60.3, 1], [null, 0.2], [64.7, 1]]), 2.5, seed))).toEqual([60, 65]);
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
