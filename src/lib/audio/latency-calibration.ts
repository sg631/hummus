// Plays clicks at known times and records the mic, to measure how late sound arrives.
import * as Tone from 'tone';
import {
  analyzeLatency,
  CLAP_ANALYSIS,
  LOOPBACK_ANALYSIS,
  type LatencyResult
} from '$lib/music/latency';
import type { AudioSource } from '$lib/music/types';

export type CalibrationMode =
  | 'loopback' // speakers: the mic hears the clicks themselves
  | 'clap';    // headphones: clap (or say "ta") on each click

export interface CalibrationOptions {
  mode: CalibrationMode;
  clicks: number;      // how many to play
  intervalSec: number; // time between clicks
  volumeDb: number;    // click loudness
}

export const DEFAULT_CALIBRATION: Record<CalibrationMode, CalibrationOptions> = {
  loopback: { mode: 'loopback', clicks: 8, intervalSec: 0.5, volumeDb: -6 },
  clap: { mode: 'clap', clicks: 12, intervalSec: 0.6, volumeDb: -10 }
};

const LEAD_IN_SEC = 0.5; // before the first click, so the mic settles

// The source must already be running. `onClick(i)` fires as each click is heard (for UI).
export async function measureLatency(
  source: AudioSource,
  options: CalibrationOptions,
  onClick?: (index: number) => void,
  signal?: AbortSignal
): Promise<LatencyResult> {
  const analysis = options.mode === 'loopback' ? LOOPBACK_ANALYSIS : CLAP_ANALYSIS;
  const click =
    options.mode === 'loopback'
      ? // A sharp noise burst: its onset is easy to pinpoint.
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.0005, decay: 0.01, sustain: 0, release: 0.005 }
        })
      : // A clear beep to clap along to.
        new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.01 }
        });
  click.volume.value = options.volumeDb;
  click.toDestination();

  // Record raw mic audio with its context-clock start time.
  const chunks: Float32Array[] = [];
  let startTime: number | null = null;
  const unsubscribe = source.onAudio((block, time) => {
    startTime ??= time;
    chunks.push(block.slice());
  });

  try {
    const first = Tone.now() + LEAD_IN_SEC;
    const times = Array.from({ length: options.clicks }, (_, i) => first + i * options.intervalSec);
    times.forEach((t, i) => {
      if (click instanceof Tone.NoiseSynth) click.triggerAttackRelease(0.01, t);
      else click.triggerAttackRelease(1320, 0.05, t);
      Tone.getDraw().schedule(() => onClick?.(i), t);
    });

    // Wait until the last click (and its echo through the mic) has been recorded.
    const end = times[times.length - 1] + analysis.searchAfter + 0.1;
    await waitUntil(end, signal);

    const samples = concat(chunks);
    if (startTime === null || samples.length === 0) {
      throw new Error('No audio from the microphone.');
    }
    return analyzeLatency(samples, source.sampleRate, startTime, times, analysis);
  } finally {
    unsubscribe();
    Tone.getDraw().cancel(0);
    click.dispose();
  }
}

// Resolve once the audio clock reaches `time`, or reject when aborted.
function waitUntil(time: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal?.aborted) return reject(new DOMException('Calibration cancelled', 'AbortError'));
      if (Tone.getContext().currentTime >= time) return resolve();
      setTimeout(check, 50);
    };
    check();
  });
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
