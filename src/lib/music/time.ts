export const PPQ = 480; // ticks per beat (quarter note)

export function secondsToTicks(seconds: number, bpm: number): number {
  return Math.round(seconds * (bpm / 60) * PPQ);
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}