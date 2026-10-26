// Recording a take: count-in, metronome, and the mic streamed through transcription.
// The same recording gives both a MIDI clip (takeToClip) and a voice clip (take.audio).
//
//   await recorder.start({ bpm, timeSignature, countInBars: 1, metronome: true, playAlong })
//   const result = recorder.stop();   // { take, bpm, timeSignature } or null
//   recorder.cancel();                // throw it away (e.g. stopped during the count-in)
//
// Read `recorder.recording`, `recorder.countingIn`, `recorder.beat` and `recorder.live`
// in components: they're reactive.
import * as Tone from 'tone';
import { sync } from '$lib/audio/sync';
import { Metronome } from '$lib/audio/metronome';
import { initAudio } from '$lib/audio/engine';
import { beatTicks, ticksToSeconds, type TimeSignature } from '$lib/music/time';
import { latency } from '$lib/state/latency.svelte';
import { liveInput } from '$lib/state/live-input.svelte';
import { LiveTranscriber, type Transcription } from '$lib/transcription';

export interface RecordOptions {
  bpm: number;
  timeSignature: TimeSignature;
  countInBars: number; // bars of clicks before the take starts
  metronome: boolean;  // click while recording
  // Schedule anything that should play while you sing (the other tracks). Called after the
  // transport is reset and before it starts. Project tick 0 is at transport tick
  // `offsetTicks` (after the count-in), so add it to everything you schedule.
  playAlong?: (offsetTicks: number) => void;
  // Looper: after the count-in, the transport loops `loopTicks` ticks (the play-along with
  // it) while the take keeps recording; each pass can be layered afterwards.
  loopTicks?: number;
  // false: no microphone (recording what's played on a keyboard: state/live-keys). The
  // count-in, clicks and play-along work the same; the result has no take.
  mic?: boolean;
  // Where in the song the take starts (ticks): lines the start up with the guide's backing
  // track (audio/sync.ts). Without the guide it's not used.
  songTick?: number;
}

export interface RecordedTake {
  take: Transcription | null;   // the audio, pitch track and notes (null without the mic); see transcription/types.ts
  bpm: number;                  // what it was recorded at
  timeSignature: TimeSignature;
}

export class Recorder {
  recording = $state(false);
  beat = $state<number | null>(null); // current beat (count-in beats first), null when stopped
  countInBeats = $state(0);
  countingIn = $derived(this.recording && this.beat !== null && this.beat < this.countInBeats);
  live = $state.raw<Transcription | null>(null); // the take so far, while recording
  takeStart = 0; // AudioContext time of the take's time 0 (the downbeat after the count-in)

  private transcriber: LiveTranscriber | null = null;
  private metronome: Metronome | null = null;
  private options: RecordOptions | null = null;

  // Returns false if recording couldn't start (e.g. microphone permission denied).
  async start(options: RecordOptions): Promise<boolean> {
    await initAudio();
    const mic = options.mic ?? true;
    if (mic) {
      await liveInput.start();
      if (!liveInput.listening) return false;
    }

    this.options = options;
    this.live = null;
    this.countInBeats = options.countInBars * options.timeSignature[0];
    const countInTicks = this.countInBeats * beatTicks(options.timeSignature);

    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(); // clear anything scheduled before
    transport.position = 0;
    transport.bpm.value = options.bpm;
    transport.timeSignature = options.timeSignature;
    transport.loop = !!options.loopTicks;
    if (options.loopTicks) {
      transport.loopStart = `${countInTicks}i`;
      transport.loopEnd = `${countInTicks + options.loopTicks}i`;
    }

    this.metronome ??= new Metronome();
    this.metronome.timeSignature = options.timeSignature;
    this.metronome.enabled = options.metronome;
    this.metronome.onBeat = (b) => (this.beat = b);
    this.metronome.schedule();
    options.playAlong?.(countInTicks);

    // Transport time 0 starts the count-in; the take starts on the downbeat after it, so
    // the take's time 0 is bar 1, beat 1 and the quantize grid lines up with the clicks.
    const startAt = sync.startAt?.(options.countInBars, options.songTick ?? 0) ?? Tone.now() + 0.1;
    const downbeat = startAt + ticksToSeconds(countInTicks, options.bpm);
    this.takeStart = downbeat;
    transport.start(startAt);

    if (mic) {
      this.transcriber = new LiveTranscriber(liveInput, (t) => (this.live = t));
      // The mic hears you sing on a click a little after it was scheduled.
      this.transcriber.start(downbeat + latency.value);
    }
    this.recording = true;
    return true;
  }

  stop(): RecordedTake | null {
    if (!this.options) return null;
    const take = this.transcriber?.stop() ?? null;
    const { bpm, timeSignature } = this.options;
    this.reset();
    return { take, bpm, timeSignature };
  }

  // Turn the click on or off while recording.
  setMetronome(on: boolean) {
    if (this.metronome) this.metronome.enabled = on;
  }

  cancel() {
    this.transcriber?.stop();
    this.reset();
  }

  private reset() {
    this.recording = false;
    Tone.getTransport().stop();
    Tone.getTransport().loop = false;
    this.metronome?.unschedule();
    Tone.getDraw().cancel(0);
    this.beat = null;
    this.transcriber = null;
    this.live = null;
  }
}

export const recorder = new Recorder();
