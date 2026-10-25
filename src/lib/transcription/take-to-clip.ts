// A finished take → a NoteClip for a MIDI track, the way the test bench makes it: notes
// named, expression interpreted, rhythm quantized (Auto grid: straight, triplets, swing).
import { AUTO_GRID, quantizeNotes, removeOverlaps, type QuantizeSettings } from '$lib/music/quantize';
import type { TimeSignature } from '$lib/music/time';
import type { NoteClip } from '$lib/music/types';
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
  return { ...clip, notes: removeOverlaps(quantizeNotes(clip.notes, s.quantize, timeSignature, bpm)) };
}
