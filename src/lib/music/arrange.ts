// The playlist (arrangement): where clips play in the song.
//
// A clip's content (a melody clip's notes, a drum pattern's steps) is stored once, on its
// track. The playlist only holds placements: "this clip, from here, for this long". Copying
// a block in the playlist adds a placement, not another copy of the notes, so a song made
// of a few repeated patterns stays small, and editing a clip changes every place it plays.
// ("Make unique" copies a clip when one place should differ.)
//
// A placement longer than its clip loops it; shorter cuts it off.
import type { Note, NoteClip, Placement } from './types';

// How long a clip's content lasts: whole bars, at least one.
export function contentLength(durationTicks: number, bar: number): number {
  return Math.max(bar, Math.ceil(durationTicks / bar) * bar);
}

// How long a placement plays: its own length if set, otherwise its content once.
export function placementLength(p: Placement, content: number): number {
  return p.length ?? content;
}

// A melody track's placements as plain clips on the timeline, one per repeat, notes cut
// off at the end of the placement: what the mixer plays and MIDI export writes.
export function expandPlacements(clips: NoteClip[], placements: Placement[], bar: number): NoteClip[] {
  const out: NoteClip[] = [];
  for (const p of placements) {
    const clip = clips.find((c) => c.id === p.clipId);
    if (!clip) continue;
    const content = contentLength(clip.duration, bar);
    const length = placementLength(p, content);
    for (let loop = 0, k = 0; loop < length; loop += content, k++) {
      const notes: Note[] = [];
      for (const n of clip.notes) {
        const start = loop + n.start;
        if (start < 0 || start >= length) continue;
        notes.push({ ...n, duration: Math.min(n.duration, length - start) });
      }
      out.push({ id: `${p.id}#${k}`, start: p.start + loop, duration: Math.min(content, length - loop), notes });
    }
  }
  return out;
}

// The placement playing at `tick`, if any (the latest-starting one, if they overlap).
export function placementAt(placements: Placement[], tick: number, lengthOf: (p: Placement) => number): Placement | undefined {
  let found: Placement | undefined;
  for (const p of placements) {
    if (tick >= p.start && tick < p.start + lengthOf(p) && (!found || p.start >= found.start)) found = p;
  }
  return found;
}

// The end of the arrangement (the last placement's end), in ticks.
export function arrangementEnd(placements: Placement[], lengthOf: (p: Placement) => number): number {
  return Math.max(0, ...placements.map((p) => p.start + lengthOf(p)));
}
