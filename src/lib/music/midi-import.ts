// Reading a MIDI file (File → Import MIDI): its parts become tracks of this song.
// - a part with notes → a melody track (polyphonic if notes overlap), with an instrument
//   picked from its General MIDI program (piano, strings, bass…)
// - the drum channel (10) → a drum track: General MIDI drum notes become drum sounds, each
//   bar a pattern; identical bars share one pattern, placed wherever it repeats
// Times are converted to our ticks (480 per quarter note).
import { Midi } from '@tonejs/midi';
import type { DrumSound } from './drums';
import { PPQ, barTicks, type TimeSignature } from './time';
import type { ClipControllers, DrumPattern, DrumRow, Note, Placement } from './types';
import { BEND_RANGE } from './midi';

export interface ImportedMelody {
  kind: 'midi';
  name: string;
  instrument: string; // a preset id
  poly: boolean;
  notes: Note[];
  controllers?: ClipControllers; // the part's pitch bends and mod wheel
}

export interface ImportedDrums {
  kind: 'drums';
  name: string;
  rows: DrumRow[];
  patterns: DrumPattern[];
  placements: Placement[];
}

export interface ImportedMidi {
  bpm: number | null;
  timeSignature: TimeSignature | null;
  tracks: (ImportedMelody | ImportedDrums)[];
}

// General MIDI program families → our instruments.
function instrumentFor(family: string, name: string): string {
  const n = name.toLowerCase();
  if (n.includes('sax')) return n.includes('soprano') ? 'sample-soprano_sax' : n.includes('baritone') ? 'sample-baritone_sax' : n.includes('tenor') ? 'sample-tenor_sax' : 'sample-alto_sax';
  if (n.includes('violin') || n.includes('fiddle')) return 'sample-violin';
  if (n.includes('cello')) return 'sample-cello';
  if (n.includes('contrabass')) return 'sample-contrabass';
  if (n.includes('flute') || n.includes('piccolo')) return 'sample-flute';
  if (n.includes('clarinet')) return 'sample-clarinet';
  if (n.includes('trumpet')) return 'sample-trumpet';
  if (n.includes('trombone')) return 'sample-trombone';
  if (n.includes('tuba')) return 'sample-tuba';
  if (n.includes('horn')) return 'sample-french-horn';
  if (n.includes('harp')) return 'sample-harp';
  if (n.includes('xylophone') || n.includes('marimba')) return 'sample-xylophone';
  if (n.includes('nylon')) return 'sample-guitar-nylon';
  switch (family) {
    case 'piano': return 'sample-piano';
    case 'organ': return 'sample-organ';
    case 'guitar': return n.includes('acoustic') ? 'sample-guitar-acoustic' : 'sample-guitar-electric';
    case 'bass': return 'sample-bass-electric';
    case 'strings':
    case 'ensemble': return 'sample-violin';
    case 'brass': return 'sample-trumpet';
    case 'reed': return 'sample-clarinet';
    case 'pipe': return 'sample-flute';
    case 'synth lead': return 'lead';
    case 'synth pad': return 'synth';
    case 'chromatic percussion': return 'bell';
    default: return 'piano';
  }
}

// General MIDI drum notes → our synthesized drum sounds.
const GM_DRUMS: Record<number, DrumSound> = {
  35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare', 41: 'tomlow', 42: 'hihat', 43: 'tomlow', 44: 'hihat',
  45: 'tommid', 46: 'openhat', 47: 'tommid', 48: 'tomhigh', 49: 'crash', 50: 'tomhigh', 51: 'ride', 52: 'crash', 53: 'ride',
  54: 'shaker', 55: 'crash', 56: 'cowbell', 57: 'crash', 59: 'ride', 69: 'shaker', 70: 'shaker', 82: 'shaker'
};

export function parseMidi(bytes: ArrayBuffer, fallbackSignature: TimeSignature = [4, 4]): ImportedMidi {
  const midi = new Midi(bytes);
  const scale = PPQ / (midi.header.ppq || PPQ);
  const ts = (midi.header.timeSignatures[0]?.timeSignature as TimeSignature | undefined) ?? null;
  const signature: TimeSignature = ts ?? fallbackSignature;
  const out: ImportedMidi = { bpm: midi.header.tempos[0] ? Math.round(midi.header.tempos[0].bpm) : null, timeSignature: ts, tracks: [] };

  midi.tracks.forEach((t, i) => {
    if (!t.notes.length) return;
    const name = t.name?.trim() || t.instrument.name || `Part ${i + 1}`;
    if (t.channel === 9 || t.instrument.percussion) {
      out.tracks.push(drumsFrom(t.notes, scale, signature, name));
      return;
    }
    const notes: Note[] = t.notes.map((n) => ({
      id: crypto.randomUUID(),
      pitch: n.midi,
      start: Math.round(n.ticks * scale),
      duration: Math.max(1, Math.round(n.durationTicks * scale)),
      velocity: Math.max(0.05, Math.min(1, n.velocity))
    }));
    notes.sort((a, b) => a.start - b.start);
    const poly = notes.some((n, k) => k > 0 && n.start < notes[k - 1].start + notes[k - 1].duration - 10);
    // Pitch bends (±2 semitones, MIDI's usual range) and the mod wheel (CC 1).
    const bend = t.pitchBends.map((b) => ({ tick: Math.round(b.ticks * scale), value: Math.round(b.value * BEND_RANGE * 10) / 10 }));
    const mod = (t.controlChanges[1] ?? []).map((c) => ({ tick: Math.round(c.ticks * scale), value: Math.round(c.value * 100) / 100 }));
    const controllers = bend.length || mod.length ? { ...(bend.length ? { bend } : {}), ...(mod.length ? { mod } : {}) } : undefined;
    out.tracks.push({ kind: 'midi', name, instrument: instrumentFor(t.instrument.family, t.instrument.name), poly, notes, controllers });
  });
  return out;
}

// Drum notes → rows (one per sound used), a pattern per distinct bar, placements.
function drumsFrom(notes: { midi: number; ticks: number; velocity: number }[], scale: number, signature: TimeSignature, name: string): ImportedDrums {
  const bar = barTicks(signature);
  const step = PPQ / 4;
  const perBar = Math.round(bar / step);
  const rows: DrumRow[] = [];
  const rowFor = new Map<DrumSound, DrumRow>();
  const bars = new Map<number, Map<string, boolean[]>>(); // bar index → row id → steps
  for (const n of notes) {
    const sound = GM_DRUMS[n.midi];
    if (!sound) continue;
    let row = rowFor.get(sound);
    if (!row) {
      row = { id: crypto.randomUUID(), sound, volume: 0, pan: 0, mute: false, effects: [] };
      rowFor.set(sound, row);
      rows.push(row);
    }
    const t = Math.round((n.ticks * scale) / step); // to the nearest sixteenth
    const b = Math.floor(t / perBar);
    const s = t - b * perBar;
    const steps = bars.get(b) ?? new Map<string, boolean[]>();
    bars.set(b, steps);
    const rowSteps = steps.get(row.id) ?? Array<boolean>(perBar).fill(false);
    rowSteps[s] = true;
    steps.set(row.id, rowSteps);
  }
  // Identical bars share a pattern.
  const patterns: DrumPattern[] = [];
  const byKey = new Map<string, DrumPattern>();
  const placements: Placement[] = [];
  for (const b of [...bars.keys()].sort((x, y) => x - y)) {
    const steps = Object.fromEntries(bars.get(b)!);
    const key = JSON.stringify(rows.map((r) => steps[r.id] ?? []));
    let pattern = byKey.get(key);
    if (!pattern) {
      pattern = { id: crypto.randomUUID(), name: `Pattern ${patterns.length + 1}`, bars: 1, steps };
      byKey.set(key, pattern);
      patterns.push(pattern);
    }
    placements.push({ id: crypto.randomUUID(), clipId: pattern.id, start: b * bar });
  }
  return { kind: 'drums', name, rows, patterns, placements };
}
