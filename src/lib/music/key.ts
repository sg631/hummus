// The song's key: a tonic and a scale, chosen by the user (never guessed from the singing).
// Used to show which piano roll rows are in the scale.
import { Note, Scale } from 'tonal';

export const KEY_TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const SCALES = [
  'major',
  'minor',
  'harmonic minor',
  'dorian',
  'mixolydian',
  'major pentatonic',
  'minor pentatonic',
  'blues',
  'chromatic'
] as const;

// The scale's pitch classes, 0 (C) to 11 (B). Unknown key or scale: all twelve.
export function scalePitchClasses(key: string, scale: string): number[] {
  const chromas = Scale.get(`${key} ${scale}`).notes.map((n) => Note.chroma(n));
  const valid = chromas.filter((c): c is number => typeof c === 'number' && !Number.isNaN(c));
  return valid.length ? valid : [...Array(12).keys()];
}
