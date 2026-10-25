import { describe, expect, it } from 'vitest';
import {
  absStart,
  addNote,
  clipFor,
  copiedLength,
  copyNotes,
  nextAlternative,
  pasteNotes,
  placedNotes,
  quantizePlaced,
  removeNotes,
  snapTo
} from './note-edit';
import type { Note, NoteClip } from './types';

const note = (id: string, start: number, pitch = 60, duration = 240): Note => ({ id, pitch, start, duration, velocity: 0.8 });

describe('note editing', () => {
  it('works in absolute ticks across clips', () => {
    const clips: NoteClip[] = [{ id: 'c', start: 960, duration: 480, notes: [note('a', 0), note('b', 240)] }];
    expect(placedNotes(clips).map(absStart)).toEqual([960, 1200]);
  });

  it('adds into the clip before the point, or a new clip', () => {
    const clips: NoteClip[] = [{ id: 'c', start: 960, duration: 0, notes: [] }];
    const n = addNote(clips, { pitch: 62, start: 1440, duration: 480, velocity: 0.8 });
    expect(n.start).toBe(480);
    expect(clips[0].duration).toBe(960);
    expect(clipFor(clips, 0)).not.toBe(clips[0]); // before every clip: a new one
    expect(clips).toHaveLength(2);
  });

  it('copies and pastes relative to the first note', () => {
    const clips: NoteClip[] = [{ id: 'c', start: 0, duration: 960, notes: [note('a', 480), note('b', 720, 64)] }];
    const copied = copyNotes(placedNotes(clips));
    expect(copied.map((n) => n.start)).toEqual([0, 240]);
    expect(copiedLength(copied)).toBe(480);
    const pasted = pasteNotes(clips, copied, 1920);
    expect(pasted.map((n) => n.start)).toEqual([1920, 2160]);
    expect(new Set(clips[0].notes.map((n) => n.id)).size).toBe(4); // new ids
  });

  it('removes notes by id', () => {
    const clips: NoteClip[] = [{ id: 'c', start: 0, duration: 960, notes: [note('a', 0), note('b', 240)] }];
    removeNotes(clips, new Set(['a']));
    expect(clips[0].notes.map((n) => n.id)).toEqual(['b']);
  });

  it('quantizes starts and ends to the grid', () => {
    const clips: NoteClip[] = [{ id: 'c', start: 0, duration: 960, notes: [note('a', 130, 60, 200)] }];
    quantizePlaced(placedNotes(clips), 120);
    expect(clips[0].notes[0]).toMatchObject({ start: 120, duration: 240 });
    expect(snapTo(130, 0)).toBe(130);
  });

  it('cycles through alternatives', () => {
    const n: Note = { ...note('a', 0), pitch: 60, alternatives: [61, 59] };
    nextAlternative(n);
    expect([n.pitch, n.alternatives]).toEqual([61, [59, 60]]);
    nextAlternative(n);
    nextAlternative(n);
    expect(n.pitch).toBe(60);
  });
});
