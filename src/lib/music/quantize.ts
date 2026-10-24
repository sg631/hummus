import { PPQ } from './time';
import type { Note } from './types';

export interface QuantizeSettings {
  grid: number;       // ticks per grid step; 0 = off
  strength: number;   // 0–1: how far notes move toward the grid
  durations: boolean; // also snap note ends
}

export const GRID_OPTIONS = [
  { label: 'Off', ticks: 0 },
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

export function quantizeNotes(notes: Note[], s: QuantizeSettings): Note[] {
  if (s.grid <= 0 || s.strength <= 0) return notes;
  return notes.map((n) => {
    const start = snap(n.start, s.grid, s.strength);
    let end = n.start + n.duration;
    if (s.durations) end = snap(end, s.grid, s.strength);
    if (end <= start) end = start + (s.durations ? s.grid : 1); // never zero-length
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