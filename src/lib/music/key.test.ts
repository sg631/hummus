import { describe, expect, it } from 'vitest';
import { scalePitchClasses } from './key';

describe('scalePitchClasses', () => {
  it('lists a scale as pitch classes', () => {
    expect(scalePitchClasses('C', 'major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses('A', 'minor')).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(scalePitchClasses('F#', 'major pentatonic')).toEqual([6, 8, 10, 1, 3]);
  });

  it('falls back to all twelve for an unknown scale', () => {
    expect(scalePitchClasses('C', 'nonsense')).toHaveLength(12);
  });
});
