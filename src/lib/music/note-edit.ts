// Note editing on a MIDI track's clips, in absolute ticks (from the song's start), so the
// piano roll doesn't care which clip a note lives in. Pure functions on the data: they
// change the notes and clips passed in (which may be $state), nothing else.
import type { Note, NoteClip } from './types';

// A note and the clip it's in. Its position on the timeline is clip.start + note.start.
export interface Placed {
  note: Note;
  clip: NoteClip;
}

export const absStart = (p: Placed) => p.clip.start + p.note.start;
export const absEnd = (p: Placed) => absStart(p) + p.note.duration;

export function placedNotes(clips: NoteClip[]): Placed[] {
  return clips.flatMap((clip) => clip.notes.map((note) => ({ note, clip })));
}

// Moves a note to an absolute tick (never before the song starts).
export function setAbsStart(p: Placed, ticks: number) {
  p.note.start = Math.max(0, Math.round(ticks)) - p.clip.start;
}

// Nearest grid line; grid ≤ 1 means no snapping.
export function snapTo(ticks: number, grid: number): number {
  return grid > 1 ? Math.round(ticks / grid) * grid : Math.round(ticks);
}

// A clip should reach the end of its last note, so it's all drawn and played.
export function fitClip(clip: NoteClip) {
  clip.duration = Math.max(clip.duration, ...clip.notes.map((n) => n.start + n.duration));
}

// The clip new notes at `ticks` go into: the last one starting at or before it. If there's
// none, a new clip starting there is added.
export function clipFor(clips: NoteClip[], ticks: number): NoteClip {
  const before = clips.filter((c) => c.start <= ticks).sort((a, b) => b.start - a.start)[0];
  if (before) return before;
  clips.push({ id: crypto.randomUUID(), start: Math.max(0, ticks), duration: 0, notes: [] });
  return clips[clips.length - 1];
}

// Adds a note at an absolute tick; returns it (as stored, so it can be changed further).
export function addNote(clips: NoteClip[], note: Omit<Note, 'id' | 'start'> & { start: number }): Note {
  const clip = clipFor(clips, note.start);
  clip.notes.push({ ...note, id: crypto.randomUUID(), start: note.start - clip.start });
  fitClip(clip);
  return clip.notes[clip.notes.length - 1];
}

export function removeNotes(clips: NoteClip[], ids: Set<string>) {
  for (const clip of clips) {
    if (clip.notes.some((n) => ids.has(n.id))) clip.notes = clip.notes.filter((n) => !ids.has(n.id));
  }
}

// ---------- Copy and paste ----------

// Copied notes: starts relative to the earliest one, so they can be pasted anywhere.
export type Copied = Omit<Note, 'id'>[];

export function copyNotes(placed: Placed[]): Copied {
  if (!placed.length) return [];
  const first = Math.min(...placed.map(absStart));
  return placed.map((p) => {
    const { id: _id, ...rest } = structuredClone(p.note);
    return { ...rest, start: absStart(p) - first };
  });
}

// How long a copy lasts, from its first start to its last end.
export function copiedLength(copied: Copied): number {
  return Math.max(0, ...copied.map((n) => n.start + n.duration));
}

// Pastes at an absolute tick; returns the new notes.
export function pasteNotes(clips: NoteClip[], copied: Copied, at: number): Note[] {
  return copied.map((n) => addNote(clips, { ...structuredClone(n), start: at + n.start }));
}

// ---------- Changing several notes ----------

// Snaps starts (and ends, if `lengths`) to the grid.
export function quantizePlaced(placed: Placed[], grid: number, lengths = true) {
  for (const p of placed) {
    const start = snapTo(absStart(p), grid);
    const end = lengths ? Math.max(start + grid, snapTo(absEnd(p), grid)) : start + p.note.duration;
    setAbsStart(p, start);
    p.note.duration = end - start;
  }
}

// Swaps a note's pitch for the first of its alternatives (other pitches transcription
// thought it might be); the old pitch goes to the end of the list, so repeating cycles.
export function nextAlternative(note: Note) {
  if (!note.alternatives?.length) return;
  const [next, ...rest] = note.alternatives;
  note.alternatives = [...rest, note.pitch];
  note.pitch = next;
}
