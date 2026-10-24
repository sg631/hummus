// The analysis itself is pYIN (pitch track) and Tony's note model (notes), from
// @audio/pitch-pyin. This file only adapts it to our types, offline or streaming.
import { notes, track, type Note, type Track } from '@audio/pitch-pyin';
import type { Analysis, DetectedNote, PitchTrack } from './types';

// The singing voice's range, a little wide on both sides (C2 is 65 Hz, C6 1047 Hz).
const RANGE = { minFreq: 60, maxFreq: 1400 };

// Whole recording at once (imported audio, tests).
export function analyzeAudio(audio: Float32Array, sampleRate: number): Analysis {
  const options = { fs: sampleRate, ...RANGE };
  return { notes: notes(audio, options).map(toDetected), track: toTrack(track(audio, options)) };
}

// Streaming: feed blocks as they arrive. Results only grow: each call returns what has
// been decided so far (notes lag the voice by a couple of seconds, the track much less).
export class StreamingAnalyzer {
  private writeNotes;
  private writeTrack;
  private result: Analysis = { notes: [], track: { times: [], hz: [], prob: [] } };

  constructor(sampleRate: number) {
    const options = { fs: sampleRate, ...RANGE };
    this.writeNotes = notes(options);
    this.writeTrack = track(options);
  }

  // Everything decided so far.
  get current(): Analysis {
    return this.result;
  }

  write(block: Float32Array): Analysis {
    this.add(this.writeNotes(block), this.writeTrack(block));
    return this.result;
  }

  // No more audio: decide everything still pending.
  end(): Analysis {
    this.add(this.writeNotes(), this.writeTrack());
    return this.result;
  }

  private add(found: Note[], decided: Track) {
    for (const n of found) this.result.notes.push(toDetected(n));
    const t = this.result.track;
    for (let i = 0; i < decided.times.length; i++) {
      t.times.push(decided.times[i]);
      t.hz.push(decided.f0[i]);
      t.prob.push(decided.prob[i]);
    }
  }
}

function toDetected(n: Note): DetectedNote {
  return { time: n.time, duration: n.duration, freq: n.freq, clarity: n.clarity };
}

function toTrack(t: Track): PitchTrack {
  return { times: Array.from(t.times), hz: Array.from(t.f0), prob: Array.from(t.prob) };
}
