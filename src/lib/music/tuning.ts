import { Midi } from 'tonal';

export interface NoteReading {
  hz: number;
  midi: number;  // nearest note as a MIDI number
  name: string;  // e.g. "A4"
  cents: number; // -50 to +50, how far from that note
}

export function readNote(hz: number, sharps = true): NoteReading {
  const exact = Midi.freqToMidi(hz);
  const midi = Math.round(exact);
  return {
    hz,
    midi,
    name: Midi.midiToNoteName(midi, { sharps }),
    cents: Math.round((exact - midi) * 100)
  };
}

export function toDecibels(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

// Average loudness → velocity: -50 dB is quiet, -10 dB is loud.
export function dbToVelocity(db: number): number {
  return Math.max(0.1, Math.min(1, (db + 50) / 40));
}

// Fractional MIDI number → Hz (works for in-between pitches, which slides need).
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export type TuneStatus = 'in' | 'close' | 'off';

export function tuneStatus(cents: number, inTune = 10, close = 25): TuneStatus {
  const c = Math.abs(cents);
  return c <= inTune ? 'in' : c <= close ? 'close' : 'off';
}