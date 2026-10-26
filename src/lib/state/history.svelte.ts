// Undo and redo for everything in the project: notes, tracks, the playlist, mixer settings,
// effects, automation, tempo… (not what's selected or which tab is open).
//
// One chain of steps for the whole song. Each step is a copy of the project from before an
// edit (state/clone.ts: recordings are shared, not copied). Edits are found by watching the
// project: whatever changes becomes a step once things settle for a moment, so a knob turn
// or a drag is one step, not hundreds. Code that knows what it's doing names the step:
//
//   checkpoint(track, 'Move notes')            // before an edit: its name in Undo / History
//   checkpoint(track, 'Velocity', 'velocity')  // the 3rd argument merges quick repeats
//   undo(); redo(); jumpTo(i)                  // jumpTo: any point in the History list
//
// Only the last 200 steps are kept. Opening or starting a project starts a new chain.
import type { Project, Track } from '$lib/music/types';
import { cloneDeep, signature } from './clone';
import { project } from './project.svelte';

interface Step {
  label: string;
  state: Project; // the project at this point
  sig: string;
}

const LIMIT = 200;
const SETTLE_MS = 350; // an edit becomes a step once nothing has changed for this long
const MERGE_MS = 1000;

let undoStack: Step[] = [];
let redoStack: Step[] = [];
let base: Step | null = null; // the project as of the last step
let pendingLabel: string | null = null;
let lastMerge = { key: '', time: 0 };
let timer: ReturnType<typeof setTimeout> | undefined;
let restoring = false;

// What the screen shows: the labels only (the steps themselves are big).
export const history = $state({
  undoLabel: null as string | null, // what Undo would undo, or null
  redoLabel: null as string | null,
  past: [] as string[], // every step that can be undone, oldest first
  future: [] as string[] // every step that can be redone, next first
});

function refresh() {
  history.undoLabel = undoStack.at(-1)?.label ?? null;
  history.redoLabel = redoStack.at(-1)?.label ?? null;
  history.past = undoStack.map((s) => s.label);
  history.future = redoStack.map((s) => s.label).reverse();
}

const snap = (label = ''): Step => {
  const state = cloneDeep(project) as Project;
  return { label, state, sig: signature(state) };
};

// A name for an edit nobody named: what changed between two versions.
function describe(before: Project, after: Project): string {
  if (after.tracks.length > before.tracks.length) return 'Add track';
  if (after.tracks.length < before.tracks.length) return 'Delete track';
  const changed = after.tracks.find((t, i) => signature({ tracks: [t] } as Project) !== signature({ tracks: [before.tracks[i]] } as Project));
  if (changed) return `Edit ${changed.name}`;
  if (signature({ automation: after.automation } as Project) !== signature({ automation: before.automation } as Project)) return 'Automation';
  if (signature({ masterEffects: after.masterEffects } as Project) !== signature({ masterEffects: before.masterEffects } as Project)) return 'Master effects';
  if (after.bpm !== before.bpm) return 'Tempo';
  if (after.masterVolume !== before.masterVolume) return 'Master volume';
  if (after.name !== before.name) return 'Rename project';
  return 'Song settings';
}

// Makes a step of whatever changed since the last one (if anything did).
export function commit() {
  clearTimeout(timer);
  if (restoring) return;
  const now = snap();
  if (!base) {
    base = now;
    return;
  }
  if (now.sig === base.sig) return;
  undoStack.push({ ...base, label: pendingLabel ?? describe(base.state, now.state) });
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
  base = now;
  pendingLabel = null;
  refresh();
}

// Call before an edit to name its step. Anything changed before this becomes its own step
// first. With `mergeKey`, repeats within a second (a knob turned, a slider dragged) are one step.
export function checkpoint(track: Track | null, label: string, mergeKey?: string) {
  const now = Date.now();
  const key = mergeKey ? `${track?.id ?? ''}:${mergeKey}` : '';
  if (key && key === lastMerge.key && now - lastMerge.time < MERGE_MS) {
    lastMerge.time = now;
    return;
  }
  lastMerge = { key, time: now };
  commit();
  pendingLabel = label;
}

// The edit a checkpoint was for didn't happen after all.
export function dropCheckpoint() {
  pendingLabel = null;
  lastMerge.key = '';
}

// The watcher: called with each change (see watchHistory); makes a step once it settles.
function changed() {
  if (restoring) return;
  clearTimeout(timer);
  timer = setTimeout(commit, SETTLE_MS);
}

function restore(step: Step) {
  restoring = true;
  const copy = cloneDeep(step.state);
  for (const key of Object.keys(project) as (keyof Project)[]) if (!(key in copy)) delete project[key];
  Object.assign(project, copy);
  base = { ...step, state: cloneDeep(step.state) };
  lastMerge.key = '';
  pendingLabel = null;
  // Let the watcher see the change, then listen again.
  queueMicrotask(() => setTimeout(() => (restoring = false), 0));
}

export function undo(): string | null {
  commit();
  const step = undoStack.pop();
  if (!step || !base) return refresh(), null;
  redoStack.push({ ...base, label: step.label });
  restore(step);
  refresh();
  return step.label;
}

export function redo(): string | null {
  commit();
  const step = redoStack.pop();
  if (!step || !base) return refresh(), null;
  undoStack.push({ ...base, label: step.label });
  restore(step);
  refresh();
  return step.label;
}

// To a point in the History list: `index` counts the past steps (0 = before the first;
// history.past.length = now); beyond that, into the future.
export function jumpTo(index: number) {
  commit();
  const target = Math.max(0, Math.min(index, undoStack.length + redoStack.length));
  while (undoStack.length > target) undo();
  while (undoStack.length < target && redoStack.length) redo();
}

// A new chain: after opening or starting a project.
export function clearHistory() {
  clearTimeout(timer);
  undoStack = [];
  redoStack = [];
  base = snap();
  pendingLabel = null;
  refresh();
}

// Listeners told about every project change (autosave uses it): the history's watcher
// already reads the whole project, so nothing else needs to.
const listeners = new Set<() => void>();
export function onProjectChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Starts watching the project (once, when the app opens). Returns a stop function.
export function watchHistory(): () => void {
  base = snap();
  return $effect.root(() => {
    $effect(() => {
      signature(project); // reads everything: runs again on any change
      void [project.loop?.start, project.loop?.end, project.loop?.enabled]; // not an undo step, but saved
      changed();
      for (const l of listeners) l();
    });
  });
}
