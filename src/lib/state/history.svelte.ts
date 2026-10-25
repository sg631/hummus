// Undo and redo for note editing. Before an edit, `checkpoint(track, 'Move notes')` saves
// a copy of the track's clips; `undo()` puts the latest copy back (and keeps the current
// clips for `redo()`).
//
//   checkpoint(track, 'Velocity', 'velocity')  // the 3rd argument merges quick repeats
//   undo(); redo();
//
// Copies are whole clips, simple and safe. Only the last 200 steps are kept.
import type { MidiTrack, NoteClip } from '$lib/music/types';
import { project } from './project.svelte';

interface Entry {
  trackId: string;
  label: string;
  clips: NoteClip[];
}

const LIMIT = 200;
const MERGE_MS = 1000;

let undoStack: Entry[] = [];
let redoStack: Entry[] = [];
let lastKey = '';
let lastTime = 0;

// What the screen shows (the stacks themselves are big, so they aren't $state).
export const history = $state({
  undoLabel: null as string | null, // what Undo would undo, or null
  redoLabel: null as string | null
});

function refresh() {
  history.undoLabel = undoStack.at(-1)?.label ?? null;
  history.redoLabel = redoStack.at(-1)?.label ?? null;
}

function copy(track: MidiTrack): NoteClip[] {
  return $state.snapshot(track.clips) as NoteClip[];
}

function findTrack(id: string): MidiTrack | undefined {
  const t = project.tracks.find((t) => t.id === id);
  return t?.kind === 'midi' ? t : undefined;
}

// Call before changing a track's notes. With `mergeKey`, repeats within a second (a knob
// being turned, a slider dragged) become one undo step.
export function checkpoint(track: MidiTrack, label: string, mergeKey?: string) {
  const now = Date.now();
  const key = mergeKey ? `${track.id}:${mergeKey}` : '';
  if (key && key === lastKey && now - lastTime < MERGE_MS) {
    lastTime = now;
    return;
  }
  lastKey = key;
  lastTime = now;
  undoStack.push({ trackId: track.id, label, clips: copy(track) });
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
  refresh();
}

// Forget the last checkpoint: the edit it was for didn't change anything after all.
export function dropCheckpoint() {
  undoStack.pop();
  lastKey = '';
  refresh();
}

function step(from: Entry[], to: Entry[]): string | null {
  while (from.length) {
    const entry = from.pop()!;
    const track = findTrack(entry.trackId);
    if (!track) continue; // the track was deleted: skip its steps
    to.push({ trackId: track.id, label: entry.label, clips: copy(track) });
    track.clips = entry.clips;
    lastKey = '';
    refresh();
    return entry.label;
  }
  refresh();
  return null;
}

export function undo(): string | null {
  return step(undoStack, redoStack);
}

export function redo(): string | null {
  return step(redoStack, undoStack);
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  refresh();
}
