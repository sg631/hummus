// ---------- Pitch input ----------

export interface PitchFrame {
  time: number;    // seconds (live input: on the AudioContext clock)
  hz: number;
  clarity: number; // 0–1
  rms: number;
}

export type FrameListener = (frame: PitchFrame) => void;

// Anything that emits pitch frames: the live mic, a replayed contour, a test.
export interface PitchSource {
  onFrame(listener: FrameListener): () => void; // returns unsubscribe
}

// `time` is when the block's first sample was captured, on the same clock as PitchFrame.time.
export type AudioListener = (block: Float32Array, time: number) => void;

// Anything that emits raw mono audio: the live mic, a decoded file, a test.
export interface AudioSource {
  readonly sampleRate: number;
  onAudio(listener: AudioListener): () => void; // returns unsubscribe
}

// ---------- What was sung (captured, never modified) ----------

// One entry per frame. Times are seconds from the note's start: expression like
// vibrato happens in real time, so it shouldn't stretch if the tempo changes.
export interface NoteCurve {
  t: number[];     // seconds from the note's start
  pitch: number[]; // smoothed fractional MIDI
  raw: number[];   // unsmoothed fractional MIDI
  db: number[];    // loudness
}

// ---------- What was meant (derived by the interpreter) ----------

export interface Interpretation {
  pitch: number;       // intended MIDI note
  offsetCents: number; // how far off the note was sung (median of its middle)
  correction: number;  // 0–1, how much of that offset was corrected
  driftCents: number;  // pitch change from the start to the end of the note's middle
  vibrato: number;     // 0–1, how much of the sung vibrato was kept
  drift: number;       // 0–1, how much slow movement (drift, scoops, fall-offs) was kept
  curve: number[];     // playback pitch in cents relative to `pitch`, one per curve frame
}

// ---------- Notes and clips ----------

export interface Note {
  id: string;
  pitch: number;    // MIDI note (the interpreted pitch, once interpreted)
  alternatives?: number[]; // other MIDI notes the singing could have been (ambiguous audio)
  start: number;    // ticks, relative to the clip's start
  duration: number; // ticks
  velocity: number; // 0–1
  curve?: NoteCurve;
  interpretation?: Interpretation;
}

export interface NoteClip {
  id: string;
  start: number;    // ticks, position on the timeline
  duration: number; // ticks
  notes: Note[];
}

// ---------- Project ----------

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  timeSignature: [number, number];
  key: string;
  scale: string;
  tracks: Track[];
}

interface TrackBase {
  id: string;
  name: string;
  volume: number; // dB
  pan: number;    // -1 to 1
  mute: boolean;
  solo: boolean;
  effects: EffectConfig[];
}

export interface InstrumentTrack extends TrackBase {
  type: 'instrument';
  instrument: SynthConfig;
  clips: NoteClip[];
}

export interface AudioTrack extends TrackBase {
  type: 'audio';
  clips: AudioClip[];
}

export type Track = InstrumentTrack | AudioTrack;

export interface AudioClip {
  id: string;
  recordingId: string;
  start: number;     // ticks
  trimStart: number; // seconds into the recording
  duration: number;  // ticks
}

export interface SynthConfig {
  kind: 'synth' | 'fm' | 'am' | 'mono';
  options: Record<string, unknown>;
}

export interface EffectConfig {
  id: string;
  kind: 'reverb' | 'delay' | 'filter' | 'distortion' | 'chorus';
  enabled: boolean;
  params: Record<string, number>;
}