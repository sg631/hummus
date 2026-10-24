import { describe, expect, it } from 'vitest';
import { analyzeLatency, CLAP_ANALYSIS, LOOPBACK_ANALYSIS } from './latency';

const RATE = 48000;

function seeded(seed: number): () => number {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

// Background noise with a short noise burst (a click or clap) at each given time.
function recording(seconds: number, bursts: number[], seed = 1, noise = 0.002): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = (random() - 0.5) * 2 * noise;
  for (const t of bursts) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < RATE * 0.02 && start + i < out.length; i++) {
      out[start + i] += (random() - 0.5) * 0.8 * Math.exp(-i / (RATE * 0.004));
    }
  }
  return out;
}

const clicks = (n: number, first = 0.5, interval = 0.5) =>
  Array.from({ length: n }, (_, i) => first + i * interval);

describe('analyzeLatency', () => {
  it('measures a fixed loopback delay to within a millisecond', () => {
    const expected = clicks(8);
    const audio = recording(5, expected.map((t) => t + 0.0734));
    const result = analyzeLatency(audio, RATE, 0, expected, LOOPBACK_ANALYSIS);

    expect(result.kept).toBe(8);
    expect(result.latency!).toBeCloseTo(0.0734, 3);
    expect(result.spread).toBeLessThan(0.001);
  });

  it('works on the context clock (recording starting later than zero)', () => {
    const start = 12.345;
    const expected = clicks(6).map((t) => t + start);
    const audio = recording(4, clicks(6).map((t) => t + 0.05));
    const result = analyzeLatency(audio, RATE, start, expected, LOOPBACK_ANALYSIS);

    expect(result.latency!).toBeCloseTo(0.05, 3);
  });

  it('marks missing clicks and still measures from the rest', () => {
    const expected = clicks(8);
    const heard = expected.filter((_, i) => i !== 2 && i !== 5).map((t) => t + 0.04);
    const result = analyzeLatency(recording(5, heard), RATE, 0, expected, LOOPBACK_ANALYSIS);

    expect(result.hits[2].delay).toBeNull();
    expect(result.hits[5].delay).toBeNull();
    expect(result.kept).toBe(6);
    expect(result.latency!).toBeCloseTo(0.04, 3);
  });

  it('drops an outlier (an echo or a cough)', () => {
    const expected = clicks(8);
    const heard = expected.map((t, i) => t + (i === 3 ? 0.2 : 0.06));
    const result = analyzeLatency(recording(5, heard), RATE, 0, expected, LOOPBACK_ANALYSIS);

    expect(result.hits[3].outlier).toBe(true);
    expect(result.kept).toBe(7);
    expect(result.latency!).toBeCloseTo(0.06, 3);
  });

  it('averages human claps, early or late', () => {
    const expected = clicks(10, 0.6, 0.6);
    const random = seeded(7);
    const heard = expected.map((t) => t + 0.09 + (random() - 0.5) * 0.03); // ±15 ms timing
    const result = analyzeLatency(recording(7, heard), RATE, 0, expected, CLAP_ANALYSIS);

    expect(result.kept).toBeGreaterThanOrEqual(9);
    expect(result.latency!).toBeGreaterThan(0.08);
    expect(result.latency!).toBeLessThan(0.1);
  });

  it('gives no result from silence', () => {
    const result = analyzeLatency(recording(5, []), RATE, 0, clicks(8), LOOPBACK_ANALYSIS);
    expect(result.latency).toBeNull();
    expect(result.kept).toBe(0);
  });
});
