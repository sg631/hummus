import { describe, expect, it } from 'vitest';
import { findOnsets, slices } from './slice';

// A test recording: decaying noise bursts ("hits") at the given seconds.
function hits(times: number[], sr = 8000, length = 2): Float32Array {
  const audio = new Float32Array(sr * length);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const t of times) {
    const start = Math.round(t * sr);
    for (let i = 0; i < sr * 0.2 && start + i < audio.length; i++) audio[start + i] += noise() * 0.8 * Math.exp(-i / (sr * 0.03));
  }
  return audio;
}

describe('slicing', () => {
  it('finds where each hit starts', () => {
    const sr = 8000;
    const found = findOnsets(hits([0.1, 0.5, 0.9, 1.4], sr), sr).map((i) => i / sr);
    expect(found).toHaveLength(4);
    [0.1, 0.5, 0.9, 1.4].forEach((t, i) => expect(Math.abs(found[i] - t)).toBeLessThan(0.025));
  });

  it('finds nothing in silence', () => {
    expect(findOnsets(new Float32Array(8000), 8000)).toEqual([]);
  });

  it('cuts between onsets', () => {
    expect(slices([0, 100, 100, 50], 300)).toEqual([
      { start: 0, end: 50 },
      { start: 50, end: 100 },
      { start: 100, end: 300 }
    ]);
  });
});
