// Copying the project, for undo steps and saving.
//
// $state.snapshot would copy every voice recording's audio (a Float32Array of millions of
// samples) each time. Recordings are never changed in place, so these copies share them:
// everything else is copied, audio arrays are kept as they are.
//
//   const copy = cloneDeep(project)   // plain objects; works on $state proxies too
//   signature(project)                // a text fingerprint: equal text = same project
import type { Project } from '$lib/music/types';

export function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value; // audio: shared, never changed in place
  if (Array.isArray(value)) return value.map(cloneDeep) as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = cloneDeep((value as Record<string, unknown>)[key]);
  return out as T;
}

// The project as text, with each recording's audio stood in for by its length (and the
// loop region left out: moving it isn't an edit). Reading it inside an $effect makes the
// effect run again on any change to the project. The transcription's raw data (each note's
// sung curve, a clip's pitch track and its as-sung source) is left out too: it's big, and
// only ever changes along with the notes, which are in.
// (A sidechain's `source` is a track id, a string: that one stays.)
const SKIP = new Set(['curve', 'pitchTrack', 'source']);
export function signature(project: Project): string {
  return JSON.stringify(project, (key, v) => {
    if (ArrayBuffer.isView(v)) return `#${(v as Float32Array).length}`;
    if (key === 'loop' || (SKIP.has(key) && v !== null && typeof v === 'object')) return undefined;
    return v;
  });
}
