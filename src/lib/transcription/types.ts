import type { NoteCurve } from '$lib/music/types';

// pYIN's smoothed pitch track: one entry per analysis frame (~5.8 ms apart).
export interface PitchTrack {
  times: number[]; // seconds from the take's start
  hz: number[];    // 0 where unvoiced
  prob: number[];  // 0–1, how surely the frame is voiced
}

// A note as Tony's note model found it (before naming against the singer's tuning).
export interface DetectedNote {
  time: number;     // seconds from the take's start
  duration: number; // seconds
  freq: number;     // Hz, median pitch of the note's frames
  clarity: number;  // 0–1, mean voiced probability
}

// What the analysis produced for one take. Everything after it is derived and cheap,
// so settings can change after recording without analysing again.
export interface Analysis {
  notes: DetectedNote[];
  track: PitchTrack;
}

// Everything captured from one take. The source of truth: notes are derived from it.
export interface Transcription extends Analysis {
  audio: Float32Array; // the recording, mono
  sampleRate: number;
  duration: number;    // seconds
}

// A transcribed note in real time (seconds). Converted to ticks only when it goes into a clip.
export interface TranscribedNote {
  id: string;
  pitch: number;          // MIDI note
  alternatives: number[]; // other MIDI notes the audio could be, most likely first ([] = clear)
  start: number;          // seconds from the take's start
  end: number;            // seconds
  velocity: number;       // 0–1
  curve: NoteCurve;       // what was sung, times relative to `start`
  sung: number;           // fractional MIDI of the note's pitch as sung
  referenceCents: number; // the singer's own tuning around this note, cents from A440
}
