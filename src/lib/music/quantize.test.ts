import { describe, expect, it } from 'vitest';
import { requantize } from './quantize';
import type { ClipSource } from './types';

describe('requantize', () => {
  const source: ClipSource = {
    notes: [
      { id: 'a', pitch: 60, start: 10, duration: 230, velocity: 0.8 },
      { id: 'b', pitch: 62, start: 500, duration: 470, velocity: 0.8 }
    ],
    bpm: 100,
    timeSignature: [4, 4],
    quantize: { grid: 480, strength: 1, durations: true }
  };

  it('quantizes a recorded clip from its notes as sung', () => {
    expect(requantize(source).map((n) => n.start)).toEqual([0, 480]);
  });

  it('can undo it: strength 0 gives the notes as sung', () => {
    expect(requantize({ ...source, quantize: { ...source.quantize, strength: 0 } }).map((n) => n.start)).toEqual([10, 500]);
  });
});
