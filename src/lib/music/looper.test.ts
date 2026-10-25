import { describe, expect, it } from 'vitest';
import { foldNotes, lastPassNotes, slicePasses } from './looper';

describe('looper', () => {
  it('folds every pass onto one loop', () => {
    const loop = 1920;
    const notes = [
      { id: 'a', pitch: 60, start: 480, duration: 480, velocity: 0.8 },
      { id: 'b', pitch: 64, start: 1920 + 960, duration: 480, velocity: 0.8 }, // second pass
      { id: 'c', pitch: 67, start: 1800, duration: 480, velocity: 0.8 } // runs past the loop's end
    ];
    expect(foldNotes(notes, loop).map((n) => [n.start, n.duration])).toEqual([[480, 480], [960, 480], [1800, 120]]);
  });

  it('cuts a take into passes, dropping a tiny last one', () => {
    const sr = 1000;
    expect(slicePasses(new Float32Array(2100), sr, 1).map((p) => p.length)).toEqual([1000, 1000]); // 0.1 s left: dropped
    expect(slicePasses(new Float32Array(2500), sr, 1).map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(slicePasses(new Float32Array(100), sr, 1)).toHaveLength(1); // a short take still counts
  });

  it('keeps just the last full pass when replacing', () => {
    const loop = 1000;
    const notes = [0, 1000, 2000, 2900].map((start, i) => ({ id: String(i), pitch: 60 + i, start, duration: 100, velocity: 0.8 }));
    expect(lastPassNotes(notes, loop, 3200).map((n) => n.pitch)).toEqual([62, 63]); // stopped early in pass 4: pass 3
    expect(lastPassNotes(notes, loop, 3700).map((n) => n.pitch)).toEqual([]); // pass 4 got past halfway, and is empty
  });
});
