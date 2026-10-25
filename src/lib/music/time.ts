export const PPQ = 480; // ticks per beat (quarter note)

export function secondsToTicks(seconds: number, bpm: number): number {
  return Math.round(seconds * (bpm / 60) * PPQ);
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

// Beats per bar and the note value that gets the beat: [6, 8] is 6/8. Tempo (BPM) always
// counts quarter notes, as in Tone and MIDI, so ticks don't depend on the signature:
// changing it later only moves the bar lines, never the notes.
export type TimeSignature = [beats: number, beatUnit: number];

export const TIME_SIGNATURES: TimeSignature[] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [12, 8]
];

export function beatTicks([, beatUnit]: TimeSignature): number {
  return (PPQ * 4) / beatUnit;
}

export function barTicks(ts: TimeSignature): number {
  return ts[0] * beatTicks(ts);
}

export function formatTimeSignature([beats, beatUnit]: TimeSignature): string {
  return `${beats}/${beatUnit}`;
}

export function parseTimeSignature(text: string): TimeSignature | null {
  const [beats, beatUnit] = text.split('/').map(Number);
  return beats > 0 && [1, 2, 4, 8, 16, 32].includes(beatUnit) ? [beats, beatUnit] : null;
}
