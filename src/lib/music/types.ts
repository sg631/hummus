import type { DrumSound, SwingUnit } from './drums';
import type { EffectType } from './effects';
import type { InstrumentPreset } from './instruments';
import type { NoteExpression } from './note-expression';
import type { QuantizeSettings } from './quantize';
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
  expression?: NoteExpression; // slides, glide, vibrato, bend amount: edited in the piano roll
}

// A melody clip: notes, played wherever the playlist places it (track.placements).
export interface NoteClip {
  id: string;
  name?: string;    // shown in the playlist and the clip picker
  start: number;    // ticks: 0 for clips in the playlist (where it plays is the placement's start)
  duration: number; // ticks
  notes: Note[];
  // A recorded clip: its notes as sung, before quantizing, so they can be quantized again
  // with other settings (requantize in quantize.ts). Dropped once notes are edited by hand.
  source?: ClipSource;
  // A recorded clip: the pitch transcription heard, frame by frame (drawn in the piano
  // roll under the notes). Kept when notes are edited.
  pitchTrack?: PitchLine;
}

export interface PitchLine {
  ticks: number[]; // from the clip's start
  midi: number[];  // fractional MIDI pitch (A440)
}

export interface ClipSource {
  notes: Note[];                // as sung (ticks at `bpm`), not quantized
  bpm: number;                  // the tempo it was recorded at
  timeSignature: TimeSignature; // ...and time signature
  quantize: QuantizeSettings;   // the settings `notes` of the clip were quantized with
  tuningCents?: number;         // the singer's own tuning, cents from A440 (notes are named against it)
}

// ---------- Project ----------
//
// The whole song: everything the app saves and plays. Positions are in ticks (PPQ per
// quarter note, see time.ts), so changing `bpm` speeds everything up or slows it down
// without moving any note.

export interface Project {
  name: string;
  bpm: number;                  // quarter notes per minute
  timeSignature: TimeSignature; // e.g. [4, 4]
  key: string;                  // tonic, e.g. 'C', 'F#' (KEY_TONICS in key.ts)
  scale: string;                // e.g. 'major', 'minor' (SCALES in key.ts)
  detune: number;               // cents, the whole song's tuning shift (−100 … 100; 0 = A440)
  transpose: number;            // semitones, the whole song's key shift (−12 … 12); drums aren't shifted
  masterVolume: number;         // dB, everything (0 = as mixed)
  instruments: InstrumentPreset[]; // your own instrument presets (built-in ones: instruments.ts)
  tracks: Track[];
}

// Every kind of track. Check `kind` to know which one you have:
//   if (track.kind === 'midi') { track.clips … }
export type Track = MidiTrack | VoiceTrack | DrumTrack;

// What every track has.
interface TrackBase {
  id: string;
  name: string;
  volume: number; // dB: 0 is as recorded, -6 about half as loud, -60 near silent
  pan: number;    // -1 left … 0 centre … 1 right
  mute: boolean;
  solo?: boolean; // when any track is soloed, only soloed tracks play
  collapsed?: boolean; // shown as just its title row in the track list
  // Swing on this track only (0.5 = straight … 0.75 hard swing; see drums.ts). Melody and
  // drum tracks; voice recordings play as recorded.
  swing: number;
  swingUnit: SwingUnit; // which notes swing: 8 (off-beat eighths) or 16 (sixteenths)
  effects: Effect[]; // played in order: the sound goes through the first, then the next…
}

// One effect on a track. Which effects exist, and their settings, is in effects.ts.
export interface Effect {
  id: string;
  type: EffectType;               // 'reverb', 'delay', 'chorus'…
  enabled: boolean;               // off: the sound skips it
  params: Record<string, number>; // its settings, by EffectParam.key, e.g. { decay: 2, mix: 0.3 }
}

// Notes played by an instrument: a sung melody (transcribed), chords, or notes drawn in
// the piano roll.
export interface MidiTrack extends TrackBase {
  kind: 'midi';
  instrument: string; // an InstrumentPreset id: built in ('piano'…) or one of project.instruments
  poly?: boolean;     // polyphonic: notes can overlap (chords); no pitch bends or slurs
  clips: NoteClip[];  // each clip's notes, stored once
  placements: Placement[]; // where the clips play (the playlist)
  current?: string;   // the clip the piano roll edits
}

// One block in the playlist: a clip (or drum pattern) playing from `start` for `length`
// ticks (default: its content once; longer loops it, shorter cuts it). Copies of a block
// are more placements of the same clip: nothing is stored twice (music/arrange.ts).
export interface Placement {
  id: string;
  clipId: string; // a NoteClip id (melody) or DrumPattern id (drums)
  start: number;  // ticks
  length?: number; // ticks
}

// Recorded audio, played back as it is (a voice on top, not transcribed).
export interface VoiceTrack extends TrackBase {
  kind: 'voice';
  clips: VoiceClip[];
}

export interface VoiceClip {
  id: string;
  start: number;         // ticks, where it starts on the timeline
  audio: Float32Array;   // the recording, mono
  sampleRate: number;
  recordedBpm: number;   // the tempo it was sung to (playing at another tempo stretches it)
  edit?: VoiceEdit;      // trims, speed, pitch… (the audio itself is never changed)
}

// Changes to how a recording plays, all optional. The voice editor sets them.
export interface VoiceEdit {
  trimStart?: number; // seconds into the recording where it starts playing
  trimEnd?: number;   // …and stops (default: the end)
  speed?: number;     // 0.5 = half speed … 2 = double (pitch unchanged)
  pitch?: number;     // semitones up or down (speed unchanged)
  gain?: number;      // dB
  fadeIn?: number;    // seconds
  fadeOut?: number;   // seconds
  reverse?: boolean;
}

// A drum loop: rows of steps, repeated for the whole song.
// Drums: the rows (instruments) are the track's; the steps are in patterns, played where
// the playlist places them. With no placements, the current pattern loops for the whole song.
export interface DrumTrack extends TrackBase {
  kind: 'drums';
  rows: DrumRow[];
  patterns: DrumPattern[];
  placements: Placement[];
  current?: string; // the pattern the drum grid edits
}

export interface DrumPattern {
  id: string;
  name: string;
  bars: number; // how long it is (1–8 bars), each a bar of sixteenths in the song's meter
  steps: Record<string, boolean[]>; // by DrumRow id
}

// One sound and when it plays.
// Each row is an instrument of its own, with volume, pan, mute and effects like a track.
export interface DrumRow {
  id: string;
  sound: DrumSound;  // 'kick', 'snare'… (DRUM_SOUNDS in drums.ts); its steps are in patterns
  volume: number;    // dB, 0 = normal
  pan: number;       // -1 left … 1 right
  mute: boolean;
  swing?: number;    // this sound's own swing (0.5–0.75); missing = the track's
  effects: Effect[];
}
