import { cellAt, cellStep, fitRhythm, snapToCell, type GridCell } from './rhythm';
import { PPQ, type TimeSignature } from './time';
import type { Note } from './types';

// Grid "Auto": each beat gets the subdivision the timing fits best (straight, triplet,
// swung), following the time signature; see rhythm.ts.
export const AUTO_GRID = -1;

export interface QuantizeSettings {
  grid: number;       // ticks per grid step; 0 = off; AUTO_GRID = chosen per beat
  strength: number;   // 0–1: how far notes move toward the grid
  durations: boolean; // also snap note ends
  // Auto grid only: where off-beat eighths go, 0.5 (straight) to 0.75 (2/3: triplet
  // swing), or 'auto' to measure it from the take (straight if it can't tell).
  swing?: number | 'auto';
}

// What the Auto grid decided for a take.
export interface RhythmAnalysis {
  cells: GridCell[];
  offset: number;                // ticks the singer sat behind (+) or ahead of the beat, removed first
  swing: number;                 // the swing used
  measuredSwing: number | null;  // the take's own (null: too few off-beat eighths to tell)
  ambiguous: GridCell[];         // beats whose rhythm could be read another way
}

export function analyzeRhythm(
  notes: Note[],
  s: QuantizeSettings,
  timeSignature: TimeSignature = [4, 4],
  bpm = 100
): RhythmAnalysis {
  const fixed = s.swing === undefined || s.swing === 'auto' ? undefined : s.swing;
  const fit = fitRhythm(
    notes.map((n) => n.start),
    { timeSignature, bpm, swing: fixed }
  );
  return { ...fit, ambiguous: fit.cells.filter((c) => c.alternative) };
}

export const GRID_OPTIONS = [
  { label: 'Off', ticks: 0 },
  { label: 'Auto', ticks: AUTO_GRID },
  { label: '1/4', ticks: PPQ },
  { label: '1/8', ticks: PPQ / 2 },
  { label: '1/16', ticks: PPQ / 4 },
  { label: '1/8T', ticks: PPQ / 3 } // triplets
] as const;

// Move a value toward the nearest grid line, by `strength`.
function snap(value: number, grid: number, strength: number): number {
  const target = Math.round(value / grid) * grid;
  return Math.round(value + (target - value) * strength);
}

// `timeSignature` and `bpm` shape the Auto grid (its beat, compound time, timing spread).
export function quantizeNotes(
  notes: Note[],
  s: QuantizeSettings,
  timeSignature: TimeSignature = [4, 4],
  bpm = 100
): Note[] {
  if (s.grid === AUTO_GRID) return quantizeAuto(notes, s, timeSignature, bpm);
  if (s.grid <= 0 || s.strength <= 0) return notes;
  return notes.map((n) => {
    const start = snap(n.start, s.grid, s.strength);
    let end = n.start + n.duration;
    if (s.durations) end = snap(end, s.grid, s.strength);
    if (end <= start) end = start + (s.durations ? s.grid : 1); // never zero-length
    return { ...n, start, duration: end - start };
  });
}

// Onsets to the grid chosen for them; ends to the grid where they fall, at least one
// step of it after the start.
function quantizeAuto(notes: Note[], s: QuantizeSettings, timeSignature: TimeSignature, bpm: number): Note[] {
  if (s.strength <= 0 || notes.length === 0) return notes;
  const { cells, offset } = analyzeRhythm(notes, s, timeSignature, bpm);
  const toward = (value: number, target: number) => Math.round(value + (target - value) * s.strength);
  // the grid point a position belongs to, judged with the singer's offset removed
  const target = (tick: number) => snapToCell(tick - offset, cellAt(cells, tick - offset));
  return notes.map((n) => {
    const start = toward(n.start, target(n.start));
    let end = n.start + n.duration;
    if (s.durations) {
      const cell = cellAt(cells, end - offset);
      end = Math.max(toward(end, target(end)), start + Math.max(1, Math.round(cellStep(cell) * s.strength)));
    }
    if (end <= start) end = start + 1;
    return { ...n, start, duration: end - start };
  });
}

// Singing is one note at a time: trim any note that runs into the next.
export function removeOverlaps(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const result: Note[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const note = { ...sorted[i] };
    const next = sorted[i + 1];
    if (next && note.start + note.duration > next.start) {
      note.duration = next.start - note.start;
    }
    if (note.duration > 0) result.push(note);
  }
  return result;
}