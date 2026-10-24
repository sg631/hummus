// Notes while you sing: the mic is streamed through the analysis as it arrives. Notes
// appear once the note model is sure of them (a couple of seconds behind the voice);
// the pitch track follows much closer. Stopping decides whatever is still pending.
import type { AudioSource } from '$lib/music/types';
import { StreamingAnalyzer } from './analyze';
import { AudioRecorder } from './recorder';
import type { Transcription } from './types';

const UPDATE_MS = 250; // how often to report progress

export class LiveTranscriber {
  private recorder: AudioRecorder | null = null;
  private analyzer: StreamingAnalyzer | null = null;
  private zero: number | null = null; // source time of the take's first sample
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  // `onUpdate` gets the take so far (its audio is a view: use it before the next update).
  constructor(
    private source: AudioSource,
    private onUpdate: (take: Transcription) => void = () => {}
  ) {}

  // The source must already be running (it knows its sample rate).
  // `at`: source-clock time where the take begins (e.g. the downbeat after a count-in).
  // Audio before it is dropped. Without it, the take begins with the next block.
  start(at?: number) {
    const rate = this.source.sampleRate;
    this.recorder = new AudioRecorder(rate);
    this.analyzer = new StreamingAnalyzer(rate);
    this.zero = at ?? null;
    this.unsubscribe = this.source.onAudio((block, time) => {
      this.zero ??= time;
      const skip = Math.round((this.zero - time) * rate); // samples before the take begins
      if (skip >= block.length) return;
      const kept = skip > 0 ? block.subarray(skip) : block;
      this.recorder!.append(kept);
      this.analyzer!.write(kept);
    });
    this.timer = setInterval(() => this.onUpdate(this.snapshot(false)), UPDATE_MS);
  }

  // Stop listening and finish the analysis. The result is the take's source of truth.
  stop(): Transcription {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    this.analyzer?.end();
    return this.snapshot(true);
  }

  private snapshot(final: boolean): Transcription {
    const recorder = this.recorder!;
    const analysis = this.analyzer!.current;
    return {
      notes: [...analysis.notes],
      track: {
        times: [...analysis.track.times],
        hz: [...analysis.track.hz],
        prob: [...analysis.track.prob]
      },
      audio: final ? recorder.toArray() : recorder.view(),
      sampleRate: recorder.sampleRate,
      duration: recorder.duration
    };
  }
}
