// Looper recording (pattern mode): the playback loops while you keep singing, and each
// pass round the loop becomes a layer. The take itself is one long recording; these split
// it up afterwards.

import type { Note } from './types';

// Notes from every pass, folded onto one loop of `loopTicks`: a note sung in the third pass
// lands where it falls in the loop. Notes are cut off at the loop's end.
export function foldNotes(notes: Note[], loopTicks: number): Note[] {
  return notes.map((n) => {
    const start = ((n.start % loopTicks) + loopTicks) % loopTicks;
    return { ...n, start, duration: Math.max(1, Math.min(n.duration, loopTicks - start)) };
  });
}

const MIN_PASS_SEC = 0.25; // a last pass shorter than this (stopped just after the loop) is dropped

// A recording cut into one piece per pass of a loop `loopSec` long (views of the same
// audio, not copies).
export function slicePasses(audio: Float32Array, sampleRate: number, loopSec: number): Float32Array[] {
  const per = Math.max(1, Math.round(loopSec * sampleRate));
  const passes: Float32Array[] = [];
  for (let start = 0; start < audio.length; start += per) {
    const piece = audio.subarray(start, Math.min(audio.length, start + per));
    if (passes.length === 0 || piece.length >= MIN_PASS_SEC * sampleRate) passes.push(piece);
  }
  return passes;
}

// Replace mode: just the last full pass round the loop (a last pass that got past halfway
// counts as full), folded onto the loop: keep singing until a pass is right, then stop.
export function lastPassNotes(notes: Note[], loopTicks: number, takeTicks: number): Note[] {
  const complete = Math.floor(takeTicks / loopTicks);
  const keep = takeTicks % loopTicks > loopTicks / 2 ? complete : Math.max(0, complete - 1);
  return foldNotes(notes.filter((n) => Math.floor(n.start / loopTicks) === keep), loopTicks);
}
