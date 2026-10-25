import type { Note } from './types';

const ACCENT_VELOCITY = 0.25; // an accent plays this much harder (velocity, 0–1)

// The velocity a note plays at: as sung, plus its accent.
export function playedVelocity(note: Note): number {
  return note.articulation?.accent ? Math.min(1, note.velocity + ACCENT_VELOCITY) : note.velocity;
}

// Whether `note` is slurred into `next` (legato, and nothing in between): it should
// change pitch without a new attack.
export function slursInto(note: Note, next: Note | undefined): boolean {
  return !!next && note.articulation?.kind === 'legato' && next.start <= note.start + note.duration + 1;
}
