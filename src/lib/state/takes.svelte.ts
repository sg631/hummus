// The last recording made into each melody track, kept in memory while the app is open
// (too big to save). It lets the piano roll redo the transcription with other settings,
// add the recording as a voice track, or save it as a test file.
import type { ShiftChange } from '$lib/music/shift-keys';
import type { TimeSignature } from '$lib/music/time';
import type { Transcription } from '$lib/transcription';

export interface TakeRecord {
  take: Transcription;
  bpm: number;
  timeSignature: TimeSignature;
  shifts: ShiftChange[]; // shift keys held while singing
}

// $state.raw: replaced as a whole, never changed inside (takes hold big audio arrays).
let takes = $state.raw<Record<string, TakeRecord>>({});

export function rememberTake(trackId: string, record: TakeRecord) {
  takes = { ...takes, [trackId]: record };
}

export function takeFor(trackId: string): TakeRecord | undefined {
  return takes[trackId];
}
