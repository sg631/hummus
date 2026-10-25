// A finished take → a NoteClip for a MIDI track, the way the test bench makes it: notes
// named, expression interpreted, rhythm quantized (Auto grid: straight, triplets, swing).
// The clip keeps its unquantized notes (`source`) so it can be quantized again later.
import { AUTO_GRID, requantize, type QuantizeSettings } from '$lib/music/quantize';
import type { TimeSignature } from '$lib/music/time';
import { secondsToTicks } from '$lib/music/time';
import type { NoteClip, PitchLine } from '$lib/music/types';
import { toClip } from './clip';
import { DEFAULT_EXPRESSION_SETTINGS, type ExpressionSettings } from './expression';
import { DEFAULT_NOTE_SETTINGS, buildNotes, type NoteSettings } from './notes';
import type { Transcription } from './types';

export interface TakeSettings {
  notes: NoteSettings;
  expression: ExpressionSettings;
  quantize: QuantizeSettings;
}

export const DEFAULT_TAKE_SETTINGS: TakeSettings = {
  notes: DEFAULT_NOTE_SETTINGS,
  expression: DEFAULT_EXPRESSION_SETTINGS,
  quantize: { grid: AUTO_GRID, strength: 1, durations: true, swing: 'auto' }
};

export function takeToClip(
  take: Transcription,
  bpm: number,
  timeSignature: TimeSignature,
  s: TakeSettings = DEFAULT_TAKE_SETTINGS
): NoteClip {
  const notes = buildNotes(take, s.notes, { samples: take.audio, sampleRate: take.sampleRate });
  const clip = toClip(notes, bpm, s.expression);
  const tuningCents = notes.length ? notes.reduce((sum, n) => sum + n.referenceCents, 0) / notes.length : 0;
  const source = { notes: clip.notes, bpm, timeSignature, quantize: { ...s.quantize }, tuningCents };
  return { ...clip, notes: requantize(source), source, pitchTrack: pitchLine(take, bpm) };
}

const VOICED = 0.5; // frames at least this surely voiced are part of the line

// The pitch transcription heard, frame by frame, as a line to draw (voiced frames only).
export function pitchLine(take: Transcription, bpm: number): PitchLine {
  const line: PitchLine = { ticks: [], midi: [] };
  const { times, hz, prob } = take.track;
  for (let i = 0; i < times.length; i++) {
    if (hz[i] <= 0 || prob[i] < VOICED) continue;
    line.ticks.push(secondsToTicks(times[i], bpm));
    line.midi.push(Math.round((69 + 12 * Math.log2(hz[i] / 440)) * 100) / 100);
  }
  return line;
}
