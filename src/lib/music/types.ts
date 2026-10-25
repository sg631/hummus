import type { TimeSignature } from './time';

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

// A scoop into a note (or slide from the last), or a fall off it.
export interface Gesture {
  cents: number; // its furthest point from the note's pitch (−200: from two semitones below)
  sec: number;   // how long it lasts
}

export interface Interpretation {
  pitch: number;       // intended MIDI note
  offsetCents: number; // how far off the note was sung (median of its middle)
  correction: number;  // 0–1, how much of that offset was corrected
  driftCents: number;  // pitch change across the note's body (after it settles, before it leaves)
  vibrato: number;     // 0–1, how much of the sung vibrato was kept
  drift: number;       // 0–1, how much slow wander inside the note was kept
  gestures: number;    // 0–1, how much of its scoop and fall was kept
  scoop?: Gesture;     // a clear scoop into it (or slide from the note before)
  fall?: Gesture;      // a clear fall off it
  curve: number[];     // playback pitch in cents relative to `pitch`, one per curve frame
}

// ---------- Notes and clips ----------

// How a note was sung, from the audio.
export interface Articulation {
  // legato: slurred into the next note (no new attack); staccato: cut short, then a rest;
  // normal: anything else (a new attack, or held up to a rest).
  kind: 'legato' | 'normal' | 'staccato';
  accent: boolean;  // attacked clearly louder than the notes around it
  accentDb: number; // how much louder its attack was than theirs (dB; 0 if unknown)
}

export interface Note {
  id: string;
  pitch: number;    // MIDI note (the interpreted pitch, once interpreted)
  alternatives?: number[]; // other MIDI notes the singing could have been (ambiguous audio)
  start: number;    // ticks, relative to the clip's start
  duration: number; // ticks
  velocity: number; // 0–1
  curve?: NoteCurve;
  interpretation?: Interpretation;
  articulation?: Articulation;
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
  timeSignature: TimeSignature;
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