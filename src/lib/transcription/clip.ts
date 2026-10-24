// Transcribed notes (seconds) → the app's clip format (ticks). Curves stay in seconds.
import { secondsToTicks } from '$lib/music/time';
import type { Note, NoteClip } from '$lib/music/types';
import { DEFAULT_EXPRESSION_SETTINGS, interpretNote, type ExpressionSettings } from './expression';
import type { TranscribedNote } from './types';

export function toNotes(
  notes: TranscribedNote[],
  bpm: number,
  s: ExpressionSettings = DEFAULT_EXPRESSION_SETTINGS
): Note[] {
  return notes.map((n) => ({
    id: n.id,
    pitch: n.pitch,
    ...(n.alternatives.length ? { alternatives: n.alternatives } : {}),
    start: secondsToTicks(n.start, bpm),
    duration: Math.max(1, secondsToTicks(n.end - n.start, bpm)),
    velocity: n.velocity,
    curve: n.curve,
    interpretation: interpretNote(n, s)
  }));
}

export function toClip(
  notes: TranscribedNote[],
  bpm: number,
  s: ExpressionSettings = DEFAULT_EXPRESSION_SETTINGS,
  id: string = crypto.randomUUID()
): NoteClip {
  const converted = toNotes(notes, bpm, s);
  const duration = converted.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
  return { id, start: 0, duration, notes: converted };
}
