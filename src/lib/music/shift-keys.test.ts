import { describe, expect, it } from 'vitest';
import { applyShifts, shiftAt, shiftFromKeys } from './shift-keys';
import type { NoteClip } from './types';

describe('shift keys', () => {
  it('reads numbers, minus and octave keys', () => {
    expect(shiftFromKeys([])).toBe(0);
    expect(shiftFromKeys(['Digit3'])).toBe(3);
    expect(shiftFromKeys(['Minus', 'Digit3'])).toBe(-3);
    expect(shiftFromKeys(['Digit0'])).toBe(10);
    expect(shiftFromKeys(['KeyC'])).toBe(12);
    expect(shiftFromKeys(['KeyZ'])).toBe(-24);
    expect(shiftFromKeys(['KeyV', 'Minus', 'Digit2'])).toBe(22);
    expect(shiftFromKeys(['Minus'])).toBe(0);
  });

  it('uses the last number pressed when several are held', () => {
    expect(shiftFromKeys(['Digit2', 'Digit5'])).toBe(5);
  });

  it('finds the shift at a time', () => {
    const changes = [
      { time: 1, shift: 12 },
      { time: 2, shift: 0 }
    ];
    expect([shiftAt(changes, 0.5), shiftAt(changes, 1.5), shiftAt(changes, 3)]).toEqual([0, 12, 0]);
  });

  it('moves notes (and the take re-quantizing starts from) by the shift held as they start', () => {
    // At 120 BPM a beat (480 ticks) is 0.5 s.
    const note = (id: string, start: number) => ({ id, pitch: 60, start, duration: 480, velocity: 0.8, alternatives: [61] });
    const clip: NoteClip = {
      id: 'c', start: 0, duration: 1920,
      notes: [note('a', 0), note('b', 960)],
      source: { notes: [note('a', 0), note('b', 960)], bpm: 120, timeSignature: [4, 4], quantize: { grid: 0, strength: 1, durations: true } }
    };
    applyShifts(clip, [{ time: 0.1, shift: 12 }, { time: 0.6, shift: 0 }], 120); // a's middle: 0.25 s, b's: 1.25 s
    expect(clip.notes.map((n) => n.pitch)).toEqual([72, 60]);
    expect(clip.source!.notes.map((n) => n.pitch)).toEqual([72, 60]);
    expect(clip.notes[0].alternatives).toEqual([73]);
  });

  // At 120 BPM: 480 ticks = 0.5 s. One note held for 2 s (0–1920 ticks).
  const held = (): NoteClip => {
    const n = { id: 'a', pitch: 60, start: 0, duration: 1920, velocity: 0.8 };
    return { id: 'c', start: 0, duration: 1920, notes: [{ ...n }], source: { notes: [{ ...n }], bpm: 120, timeSignature: [4, 4], quantize: { grid: 0, strength: 1, durations: true } } };
  };

  it('splits a held note where the shift changes: a new attack', () => {
    const clip = held();
    applyShifts(clip, [{ time: 1, shift: 12 }], 120);
    expect(clip.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([[60, 0, 960], [72, 960, 960]]);
    expect(clip.notes[0].articulation?.kind).toBe('normal');
    expect(clip.notes[1].expression?.glide).toBeUndefined();
  });

  it('slides into the new note when the slide key was held', () => {
    const clip = held();
    applyShifts(clip, [{ time: 1, shift: 7, slide: true }], 120);
    expect(clip.notes.map((n) => n.pitch)).toEqual([60, 67]);
    expect(clip.notes[0].articulation?.kind).toBe('legato');
    expect(clip.notes[1].expression?.glide).toBeGreaterThan(0);
  });

  it('ignores a change right at the start (it counts for the whole note)', () => {
    const clip = held();
    applyShifts(clip, [{ time: 0.05, shift: -12 }], 120);
    expect(clip.notes.map((n) => n.pitch)).toEqual([48]);
  });
});
