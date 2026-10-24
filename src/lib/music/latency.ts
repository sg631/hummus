// Finds when each expected sound (click or clap) actually arrived in a recording,
// and turns the delays into one latency figure. Pure: no audio APIs.
import { median } from './math';

export interface LatencyAnalysisOptions {
  searchBefore: number;  // seconds before each expected time to look (claps can be early)
  searchAfter: number;   // seconds after it
  minSnrDb: number;      // a hit must be this much louder than the background
  outlierSec: number;    // hits further than this from the median (beyond the spread) are dropped
}

export const LOOPBACK_ANALYSIS: LatencyAnalysisOptions = {
  searchBefore: 0.005,
  searchAfter: 0.45,
  minSnrDb: 12,
  outlierSec: 0.004
};

export const CLAP_ANALYSIS: LatencyAnalysisOptions = {
  searchBefore: 0.15,
  searchAfter: 0.3,
  minSnrDb: 12,
  outlierSec: 0.03
};

export interface ClickHit {
  expected: number;     // seconds (recording clock)
  delay: number | null; // seconds after `expected`; null = not found
  outlier: boolean;
}

export interface LatencyResult {
  latency: number | null; // seconds: mean delay of the kept hits; null if too few
  spread: number;         // seconds: standard deviation of the kept hits
  hits: ClickHit[];
  kept: number;           // hits used for the result
}

const ENVELOPE_SEC = 0.001; // loudness measured over 1 ms
const ONSET_SHARE = 0.25;   // onset = where loudness first reaches this share of the way to the peak
const MIN_KEPT = 3;

// `samples[0]` was captured at `startTime`; `expected` are the times each sound should arrive
// with zero latency (same clock).
export function analyzeLatency(
  samples: Float32Array,
  sampleRate: number,
  startTime: number,
  expected: number[],
  o: LatencyAnalysisOptions
): LatencyResult {
  const envelope = rmsEnvelope(samples, Math.max(1, Math.round(ENVELOPE_SEC * sampleRate)));
  const toIndex = (t: number) => Math.round((t - startTime) * sampleRate);

  const delays = expected.map((t) => {
    const from = Math.max(0, toIndex(t - o.searchBefore));
    const to = Math.min(envelope.length, toIndex(t + o.searchAfter));
    if (to - from < 2) return null;
    const onset = findOnset(envelope, from, to, o.minSnrDb);
    return onset === null ? null : startTime + onset / sampleRate - t;
  });

  // Drop hits far from the rest: echoes, coughs, a missed clap.
  const found = delays.filter((d): d is number => d !== null);
  const center = found.length ? median(found) : 0;
  const deviation = found.length ? median(found.map((d) => Math.abs(d - center))) : 0;
  const limit = 3 * deviation + o.outlierSec;

  const hits: ClickHit[] = expected.map((t, i) => {
    const delay = delays[i];
    return { expected: t, delay, outlier: delay !== null && Math.abs(delay - center) > limit };
  });
  const keptDelays = hits.filter((h) => h.delay !== null && !h.outlier).map((h) => h.delay!);
  if (keptDelays.length < MIN_KEPT) {
    return { latency: null, spread: 0, hits, kept: keptDelays.length };
  }
  const mean = keptDelays.reduce((a, b) => a + b, 0) / keptDelays.length;
  const variance = keptDelays.reduce((a, d) => a + (d - mean) ** 2, 0) / keptDelays.length;
  return { latency: mean, spread: Math.sqrt(variance), hits, kept: keptDelays.length };
}

// Short-window loudness, one value per sample (centered window).
function rmsEnvelope(samples: Float32Array, window: number): Float32Array {
  const out = new Float32Array(samples.length);
  const half = Math.floor(window / 2);
  let sum = 0;
  for (let i = 0; i < samples.length + half; i++) {
    if (i < samples.length) sum += samples[i] * samples[i];
    if (i - window >= 0) sum -= samples[i - window] * samples[i - window];
    const center = i - half;
    if (center >= 0 && center < samples.length) out[center] = Math.sqrt(Math.max(0, sum) / window);
  }
  return out;
}

// First rise to ONSET_SHARE of the way from the background to the loudest point,
// or null if the loudest point isn't clearly above the background.
function findOnset(env: Float32Array, from: number, to: number, minSnrDb: number): number | null {
  let peak = 0;
  let peakAt = from;
  for (let i = from; i < to; i++) {
    if (env[i] > peak) {
      peak = env[i];
      peakAt = i;
    }
  }
  const background = percentile(env.subarray(from, to), 0.2);
  if (peak <= 0 || 20 * Math.log10(peak / Math.max(background, 1e-9)) < minSnrDb) return null;

  const threshold = background + ONSET_SHARE * (peak - background);
  let i = peakAt;
  while (i > from && env[i - 1] >= threshold) i--;
  return i;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}
