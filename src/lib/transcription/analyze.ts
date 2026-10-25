// The analysis: pYIN's pitch HMM (@audio/pitch-pyin) over a small neural network's pitch
// estimates (@audio/neural-pitch, MIT weights) instead of YIN's. YIN loses breathy or
// quiet singing over room noise (on our tests it found no notes at all where the network
// found every one). Notes come from Tony's note model, adapted (note-model.ts).
// This file only adapts them to our types; offline is the stream run all at once.
import { candidates } from '@audio/neural-pitch';
import { track } from '@audio/pitch-pyin';
import { NoteTracker, type ModelNote } from './note-model';
import type { Analysis, DetectedNote } from './types';

// The singing voice's range, a little wide on both sides (C2 is 65 Hz, C6 1047 Hz).
const RANGE = { minFreq: 60, maxFreq: 1400 };

// Whole recording at once (imported audio, tests).
export function analyzeAudio(audio: Float32Array, sampleRate: number): Analysis {
  const analyzer = new StreamingAnalyzer(sampleRate);
  analyzer.write(audio);
  return analyzer.end();
}

// Streaming: feed blocks as they arrive. Results only grow: each call returns what has
// been decided so far (notes lag the voice by a couple of seconds, the track much less).
export class StreamingAnalyzer {
  private writeTrack;
  private notes: NoteTracker;
  private levels: FrameLevels;
  private hop: number;
  private result: Analysis = { notes: [], track: { times: [], hz: [], prob: [] } };

  constructor(private sampleRate: number) {
    this.hop = Math.round((sampleRate * 256) / 44100); // pYIN's hop (its default)
    this.writeTrack = track({ fs: sampleRate, ...RANGE, candidates });
    this.notes = new NoteTracker(sampleRate / this.hop, RANGE.minFreq, RANGE.maxFreq);
    // The level window: half of pYIN's frame (as its own level), centred on the frame.
    const frameSize = 2 ** Math.ceil(Math.log2((2 * sampleRate) / RANGE.minFreq));
    this.levels = new FrameLevels(this.hop, frameSize >> 1);
  }

  // Everything decided so far.
  get current(): Analysis {
    return this.result;
  }

  write(block: Float32Array): Analysis {
    this.levels.write(block);
    this.add(this.writeTrack(block), false);
    return this.result;
  }

  // No more audio: decide everything still pending.
  end(): Analysis {
    this.levels.end();
    this.add(this.writeTrack(), true);
    return this.result;
  }

  private add(decided: { times: Float64Array; f0: Float32Array; prob: Float32Array }, last: boolean) {
    const t = this.result.track;
    for (let i = 0; i < decided.times.length; i++) {
      const time = decided.times[i];
      t.times.push(time);
      t.hz.push(decided.f0[i]);
      t.prob.push(decided.prob[i]);
      const frame = Math.round((time * this.sampleRate) / this.hop);
      const found = this.notes.push({ time, f0: decided.f0[i], prob: decided.prob[i], rms: this.levels.at(frame) });
      this.result.notes.push(...found.map(toDetected));
    }
    if (last) this.result.notes.push(...this.notes.end().map(toDetected));
  }
}

// RMS level of `window` samples centred on each frame (frame i at sample i·hop), as the
// audio arrives. Past the end, the window is zero-padded.
class FrameLevels {
  private samples = new Float32Array(48000 * 10);
  private length = 0;
  private levels: number[] = [];
  private ended = false;

  constructor(
    private hop: number,
    private window: number
  ) {}

  write(block: Float32Array) {
    if (this.length + block.length > this.samples.length) {
      const grown = new Float32Array(Math.max(this.samples.length * 2, this.length + block.length));
      grown.set(this.samples.subarray(0, this.length));
      this.samples = grown;
    }
    this.samples.set(block, this.length);
    this.length += block.length;
    this.measure();
  }

  end() {
    this.ended = true;
    this.measure();
  }

  at(frame: number): number {
    return this.levels[frame] ?? 0;
  }

  private measure() {
    const half = this.window >> 1;
    for (let i = this.levels.length; ; i++) {
      const centre = i * this.hop;
      if (!this.ended && centre + half > this.length) break;
      if (this.ended && centre > this.length) break;
      let sum = 0;
      for (let j = Math.max(0, centre - half); j < Math.min(this.length, centre + half); j++) {
        sum += this.samples[j] * this.samples[j];
      }
      this.levels.push(Math.sqrt(sum / this.window));
    }
  }
}

function toDetected(n: ModelNote): DetectedNote {
  return { time: n.time, duration: n.duration, freq: n.freq, clarity: n.clarity, endedBy: n.endedBy };
}
