import { describe, expect, it } from 'vitest';
import { bends, detuneAt } from './note-expression';
import type { Note } from './types';

const base: Note = { id: 'n', pitch: 60, start: 0, duration: 480, velocity: 0.8 };

describe('detuneAt', () => {
  it('is flat with no curve or expression', () => {
    expect(detuneAt(base, 0.2, 1)).toBe(0);
    expect(bends(base)).toBe(false);
  });

  it('follows the sung curve, scaled by bend', () => {
    const sung: Note = {
      ...base,
      curve: { t: [0, 0.1, 0.2], pitch: [], raw: [], db: [] },
      interpretation: { pitch: 60, offsetCents: 0, correction: 1, driftCents: 0, vibrato: 0, drift: 0, gestures: 1, curve: [-200, 0, 0] }
    };
    expect(detuneAt(sung, 0.05, 1)).toBeCloseTo(-100);
    expect(detuneAt({ ...sung, expression: { bend: 0.5 } }, 0, 1)).toBeCloseTo(-100);
    expect(detuneAt({ ...sung, expression: { bend: 0 } }, 0, 1)).toBeCloseTo(0);
  });

  it('slides in from below and settles on the note', () => {
    const n: Note = { ...base, expression: { slideIn: { semitones: -2, sec: 0.2 } } };
    expect(detuneAt(n, 0, 1)).toBeCloseTo(-200);
    expect(detuneAt(n, 0.1, 1)).toBeCloseTo(-50); // eased
    expect(detuneAt(n, 0.3, 1)).toBe(0);
  });

  it('slides out at the end', () => {
    const n: Note = { ...base, expression: { slideOut: { semitones: -12, sec: 0.25 } } };
    expect(detuneAt(n, 0.5, 1)).toBe(0);
    expect(detuneAt(n, 1, 1)).toBeCloseTo(-1200);
  });

  it('glides from the previous pitch', () => {
    const n: Note = { ...base, expression: { glide: 0.1 } };
    expect(detuneAt(n, 0, 1, 55)).toBeCloseTo(-500);
    expect(detuneAt(n, 0.2, 1, 55)).toBe(0);
    expect(detuneAt(n, 0, 1)).toBe(0); // first note: nothing to glide from
  });

  it('adds vibrato that fades in', () => {
    const n: Note = { ...base, expression: { vibrato: { cents: 30, hz: 5 } } };
    expect(detuneAt(n, 0, 1)).toBeCloseTo(0);
    expect(detuneAt(n, 0.25, 1)).toBeCloseTo(30); // a peak (5 Hz: 1.25 cycles), after the fade
    expect(bends(n)).toBe(true);
  });
});
