import { initAudio } from '$lib/audio/engine';
import { startPitchTracking, type PitchTracker } from '$lib/audio/pitch-tracker';
import { readNote, toDecibels, tuneStatus, type NoteReading } from '$lib/music/tuning';
import type {
  AudioListener,
  AudioSource,
  FrameListener,
  PitchFrame,
  PitchSource
} from '$lib/music/types';

export interface LiveInputSettings {
  minClarity: number; // how confident pitchy must be (0–1)
  minDb: number;      // quieter than this counts as silence
  minHz: number;      // ignore pitches outside this range
  maxHz: number;
}


const DEFAULT_SETTINGS: LiveInputSettings = {
  minClarity: 0.9,
  minDb: -50,
  minHz: 60,
  maxHz: 1500
};

export class LiveInput implements PitchSource, AudioSource {
  // Reactive state: any component reading these updates automatically.
  listening = $state(false);
  reading = $state<NoteReading | null>(null); // last detected note
  active = $state(false);                     // is a note sounding right now?
  db = $state(-Infinity);                     // input level
  error = $state('');

  tune = $derived(this.reading && this.active ? tuneStatus(this.reading.cents) : null);

  settings: LiveInputSettings;

  private tracker: PitchTracker | null = null;
  private starting = false;
  //ignore vscode complaining here
  private listeners = new Set<FrameListener>();
  private audioListeners = new Set<AudioListener>();
  sampleRate = 0; // set once the mic starts
  deviceId = '';  // the microphone; '' = the system default. Change with useDevice().

  constructor(settings: Partial<LiveInputSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  async start() {
    if (this.tracker  || this.starting) return; // already running or starting
    this.starting = true;
    this.error = '';
    try {
      const context = await initAudio();
      this.sampleRate = context.sampleRate;
      this.tracker = await startPitchTracking(
        context,
        {
          onFrame: (frame) => this.handleFrame(frame),
          onBlock: (block, time) => {
            for (const listener of this.audioListeners) listener(block, time);
          }
        },
        this.deviceId
      );
      this.listening = true;
    } catch (e) {
      this.error =
        e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')
          ? 'The chosen microphone is not connected. Pick another one.'
          : e instanceof Error
            ? e.message
            : String(e);
    } finally {
      this.starting = false;
    }
  }

  // Switch microphones. If listening, restarts on the new one (don't call while recording).
  async useDevice(deviceId: string) {
    if (deviceId === this.deviceId) return;
    this.deviceId = deviceId;
    if (this.listening) {
      this.stop();
      await this.start();
    }
  }

  stop() {
    this.tracker?.stop();
    this.tracker = null;
    this.listening = false;
    this.active = false;
    this.db = -Infinity;
  }

  async toggle() {
    if (this.listening) this.stop();
    else await this.start();
  }

  // Lets other parts of the app (segmenter, recorder) receive every raw frame.
  // Returns a function that unsubscribes.
  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Raw mic audio, for recording and transcription.
  onAudio(listener: AudioListener): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }

  private handleFrame(frame: PitchFrame) {
    const { minClarity, minDb, minHz, maxHz } = this.settings;
    this.db = toDecibels(frame.rms);
    this.active =
      frame.clarity >= minClarity && this.db >= minDb && frame.hz >= minHz && frame.hz <= maxHz;
    if (this.active) this.reading = readNote(frame.hz);

    for (const listener of this.listeners) listener(frame);
  }
}

// One shared instance for the whole app, since there's one mic.
export const liveInput = new LiveInput();