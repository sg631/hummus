// Notes as sheet music: a clip turned into ABC notation, which abcjs draws
// (components/app/SheetView.svelte).
//
//   toAbc(notes, { lengthTicks, timeSignature, key, scale, title })  // → "X:1\nM:4/4\n…"
//
// What it does to fit notation:
// - timing snaps to sixteenths (the smallest note shown)
// - notes that cross a bar line are split and tied
// - lengths that aren't one note value (5 sixteenths…) become tied notes
// - notes starting together become a chord, as long as the shortest of them (and cut at
//   the next note); overlaps that don't start together are cut where the next one starts
// - spelling follows the key: in-key notes take the key signature, others get ♯ (sharp
//   keys) or ♭ (flat keys); an accidental lasts to the end of its bar, as in print
// - the clef: bass if the notes sit mostly below middle C, else treble
import { Midi, Note as TNote, Scale } from 'tonal';
import { PPQ, type TimeSignature } from './time';
import type { Note } from './types';

const SIXTEENTH = PPQ / 4;
// Note values in sixteenths that are one symbol (plain or dotted), longest first.
const VALUES = [16, 12, 8, 6, 4, 3, 2, 1];

// ABC's name for a key: tonic, then the mode ('' major, 'm' minor…). Scales without a
// key signature of their own use their parent's.
export function abcKey(key: string, scale: string): string {
  const mode: Record<string, string> = {
    major: '',
    'major pentatonic': '',
    minor: 'm',
    'harmonic minor': 'm',
    'minor pentatonic': 'm',
    blues: 'm',
    dorian: 'Dor',
    mixolydian: 'Mix'
  };
  return `${key}${mode[scale] ?? ''}`;
}

// The key signature's letters and their alterations (+1 sharp, -1 flat), e.g. G major:
// { F: 1 }. Read from the scale with a key signature (major, minor, or the mode).
function signature(key: string, scale: string): Record<string, number> {
  const parent: Record<string, string> = { 'major pentatonic': 'major', 'minor pentatonic': 'minor', blues: 'minor', 'harmonic minor': 'minor', chromatic: 'major' };
  const notes = Scale.get(`${key} ${parent[scale] ?? scale}`).notes;
  const sig: Record<string, number> = {};
  for (const n of notes) {
    const alt = TNote.get(n).alt;
    if (alt) sig[TNote.get(n).letter] = alt;
  }
  return sig;
}

// How to spell a pitch in this key: letter, alteration (-1, 0, +1), octave.
function spell(pitch: number, key: string, scale: string, flats: boolean): { letter: string; alt: number; octave: number } {
  const parent: Record<string, string> = { 'major pentatonic': 'major', 'minor pentatonic': 'minor', blues: 'minor', chromatic: 'major' };
  const inKey = Scale.get(`${key} ${parent[scale] ?? scale}`).notes.find((n) => TNote.chroma(n) === pitch % 12);
  const name = inKey ?? TNote.pitchClass(Midi.midiToNoteName(pitch, { sharps: !flats }));
  const n = TNote.get(name);
  // The octave follows the letter (B♯ is in the octave below the C it sounds as).
  const octave = Math.floor((pitch - n.alt) / 12) - 1;
  return { letter: n.letter, alt: n.alt, octave };
}

// A letter and octave in ABC: C (middle C), c (an octave up), c' …, C, (an octave down) …
function abcLetter(letter: string, octave: number): string {
  if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
  return letter + ','.repeat(Math.max(0, 4 - octave));
}

// A length in sixteenths, as ABC (with L:1/16): "" for 1, "2", "3"…
const len = (n: number) => (n === 1 ? '' : String(n));

// Splits a length (sixteenths) into note values, longest first.
function pieces(length: number): number[] {
  const out: number[] = [];
  let left = length;
  while (left > 0) {
    const v = VALUES.find((x) => x <= left)!;
    out.push(v);
    left -= v;
  }
  return out;
}

export interface AbcOptions {
  lengthTicks: number; // how long the clip is (filled with rests to the end of its last bar)
  timeSignature: TimeSignature;
  key: string;
  scale: string;
  title?: string;
  barsPerLine?: number;
}

export function toAbc(notes: Note[], o: AbcOptions): string {
  const [beats, unit] = o.timeSignature;
  const bar = (beats * 16) / unit; // sixteenths per bar
  const beat = unit === 8 && beats % 3 === 0 ? 6 : 16 / unit; // beam groups: dotted quarters in 6/8…
  const flats = Object.values(signature(o.key, o.scale)).some((a) => a < 0) || /b/.test(o.key);
  const sig = signature(o.key, o.scale);
  const q = (t: number) => Math.round(t / SIXTEENTH);

  // Onsets → chords: notes starting on the same sixteenth.
  const groups = new Map<number, number[]>();
  const ends = new Map<number, number>();
  for (const n of notes) {
    const s = q(n.start);
    const e = Math.max(s + 1, q(n.start + n.duration));
    if (!groups.has(s)) groups.set(s, []);
    if (!groups.get(s)!.includes(n.pitch)) groups.get(s)!.push(n.pitch);
    ends.set(s, Math.min(ends.get(s) ?? Infinity, e));
  }
  const starts = [...groups.keys()].sort((a, b) => a - b);
  const total = Math.max(1, Math.ceil(Math.max(q(o.lengthTicks), ...starts.map((s) => ends.get(s)!)) / bar)) * bar;

  // Events: chords and rests filling the clip.
  type Ev = { at: number; length: number; pitches: number[] };
  const events: Ev[] = [];
  let at = 0;
  starts.forEach((s, i) => {
    if (s > at) events.push({ at, length: s - at, pitches: [] });
    const end = Math.min(ends.get(s)!, starts[i + 1] ?? Infinity);
    events.push({ at: s, length: end - s, pitches: groups.get(s)!.sort((a, b) => a - b) });
    at = end;
  });
  if (at < total) events.push({ at, length: total - at, pitches: [] });

  // Written out: split at bar lines (tied), beamed by beat, accidentals per bar.
  const avg = notes.length ? notes.reduce((a, n) => a + n.pitch, 0) / notes.length : 72;
  const clef = avg < 57 ? ' clef=bass' : '';
  let body = '';
  let barAccidentals: Record<string, number> = {};
  const perLine = o.barsPerLine ?? 4;
  const pitchText = (p: number) => {
    const s = spell(p, o.key, o.scale, flats);
    const id = `${s.letter}${s.octave}`;
    const current = barAccidentals[id] ?? sig[s.letter] ?? 0;
    let acc = '';
    if (s.alt !== current) {
      acc = s.alt === 1 ? '^' : s.alt === -1 ? '_' : s.alt === 2 ? '^^' : s.alt === -2 ? '__' : '=';
      barAccidentals[id] = s.alt;
    }
    return acc + abcLetter(s.letter, s.octave);
  };

  for (const ev of events) {
    let pos = ev.at;
    let left = ev.length;
    while (left > 0) {
      const inBar = pos % bar;
      if (inBar === 0 && pos > 0) {
        const n = pos / bar;
        body += n % perLine === 0 ? ' |\n' : ' | ';
        barAccidentals = {};
      }
      const room = bar - inBar;
      const chunk = Math.min(left, room);
      // Rests start on the beat: what's left of this one first, then whole values.
      const toBeat = (beat - (pos % beat)) % beat;
      const parts = !ev.pitches.length && toBeat && chunk > toBeat ? [...pieces(toBeat), ...pieces(chunk - toBeat)] : pieces(chunk);
      for (const v of parts) {
        if ((pos % bar) % beat === 0 && !body.endsWith(' ') && !body.endsWith('\n')) body += ' '; // a new beat: a new beam
        const last = left - v === 0;
        if (!ev.pitches.length) body += `z${len(v)}`;
        else {
          const names = ev.pitches.map(pitchText);
          const tie = last ? '' : '-';
          body += (names.length > 1 ? `[${names.join('')}]` : names[0]) + len(v) + tie;
        }
        pos += v;
        left -= v;
      }
    }
  }
  body += ' |]';

  return [`X:1`, o.title ? `T:${o.title}` : '', `M:${beats}/${unit}`, `L:1/16`, `K:${abcKey(o.key, o.scale)}${clef}`, body.trim()].filter(Boolean).join('\n');
}
