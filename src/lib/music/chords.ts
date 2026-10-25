// Chords for people who don't know chords: pick a key and a progression from a list, get
// a NoteClip of chords (one chord per bar) to put on a MIDI track.
//
// Tonal (already installed) does the music theory:
//   import { Chord, Progression } from 'tonal';
//   Progression.fromRomanNumerals('C', ['I', 'V', 'vi', 'IV'])  // ['C', 'G', 'Am', 'F']
//   Chord.get('Am').notes                                       // ['A', 'C', 'E']
//   Chord.getChord('maj', 'C4').notes  / Note.midi('C4') → 60  // with octaves, for MIDI numbers
import type { NoteClip } from './types';
import type { TimeSignature } from './time';

export const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

// Progressions that sound good in any key. Add your own.
export const PROGRESSIONS = [
  { name: 'Pop (I–V–vi–IV)', numerals: ['I', 'V', 'vi', 'IV'] },
  { name: 'Sad (vi–IV–I–V)', numerals: ['vi', 'IV', 'I', 'V'] },
  { name: 'Classic (I–IV–V–I)', numerals: ['I', 'IV', 'V', 'I'] },
  { name: 'Jazz (ii–V–I)', numerals: ['ii', 'V', 'I', 'I'] }
] as const;

// TODO(you): a clip with one chord per bar:
// 1. chord names: Progression.fromRomanNumerals(key, numerals)
// 2. for each chord i, its notes (e.g. Chord.get(name).notes) as MIDI numbers around
//    octave 4 (Note.midi(noteName + '4')),
// 3. one Note per chord note: { id: crypto.randomUUID(), pitch, start: i * barTicks(ts),
//    duration: barTicks(ts), velocity: 0.6 }  (barTicks is in time.ts)
// 4. return { id: crypto.randomUUID(), start: 0, duration: numerals.length * barTicks(ts), notes }
export function chordClip(key: string, numerals: readonly string[], timeSignature: TimeSignature): NoteClip {
  throw new Error(`TODO: chordClip(${key}, ${numerals.join('-')}, ${timeSignature.join('/')})`);
}
