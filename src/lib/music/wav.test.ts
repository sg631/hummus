import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from './wav';

describe('wav', () => {
  it('round-trips 32-bit float exactly', () => {
    const a = new Float32Array([0, 0.5, -0.25, 1, -1, 0.123]);
    const { channels, sampleRate } = decodeWav(encodeWav([a], 48000, 32));
    expect(sampleRate).toBe(48000);
    expect(Array.from(channels[0])).toEqual(Array.from(a));
  });
  it('writes 16-bit stereo, close enough', () => {
    const l = new Float32Array([0.5, -0.5]);
    const r = new Float32Array([0.25, 0]);
    const { channels } = decodeWav(encodeWav([l, r], 44100, 16));
    expect(channels).toHaveLength(2);
    expect(channels[0][0]).toBeCloseTo(0.5, 3);
    expect(channels[1][0]).toBeCloseTo(0.25, 3);
  });
});
