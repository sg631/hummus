import { describe, expect, it } from 'vitest';
import { stepsPerBar, stepsPerBeat, swingOffset } from './drums';

describe('swingOffset', () => {
  it('moves nothing when straight', () => {
    for (let step = 0; step < 16; step++) expect(swingOffset(step, 0.5, 8)).toBeCloseTo(0);
  });

  it('delays off-beat eighths in eighth swing, never the beat', () => {
    expect(swingOffset(0, 2 / 3, 8)).toBeCloseTo(0);
    expect(swingOffset(4, 2 / 3, 8)).toBeCloseTo(0);
    // The "and" lands at 2/3 of the beat (step 2.667 instead of 2).
    expect(swingOffset(2, 2 / 3, 8)).toBeCloseTo(2 / 3);
    // Sixteenths in between move proportionally, staying in order.
    expect(1 + swingOffset(1, 2 / 3, 8)).toBeLessThan(2 + swingOffset(2, 2 / 3, 8));
    expect(3 + swingOffset(3, 2 / 3, 8)).toBeLessThan(4);
  });

  it('delays off-beat sixteenths in sixteenth swing', () => {
    expect(swingOffset(0, 0.75, 16)).toBeCloseTo(0);
    expect(swingOffset(1, 0.75, 16)).toBeCloseTo(0.5); // at 3/4 of the eighth: 1.5 sixteenths
    expect(swingOffset(2, 0.75, 16)).toBeCloseTo(0);
  });
});

describe('steps follow the time signature', () => {
  it('has one bar of sixteenths', () => {
    expect(stepsPerBar([4, 4])).toBe(16);
    expect(stepsPerBar([3, 4])).toBe(12);
    expect(stepsPerBar([6, 8])).toBe(12);
    expect(stepsPerBar([7, 8])).toBe(14);
    expect(stepsPerBar([5, 4])).toBe(20);
  });

  it('groups them by the counted beat', () => {
    expect(stepsPerBeat([4, 4])).toBe(4);
    expect(stepsPerBeat([6, 8])).toBe(6); // dotted quarters
    expect(stepsPerBeat([7, 8])).toBe(2); // eighths
  });
});
