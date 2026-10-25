// Drum sounds, steps and swing. Pure data and maths, no sound: audio/instruments.ts
// (createDrum) makes each sound with Tone.js synths.
//
// A drum track is a list of rows, one sound each. A row's steps are sixteenth notes, one
// bar long in the song's time signature: 16 in 4/4, 12 in 3/4 and 6/8, 14 in 7/8. Rows can
// be added, removed, and switched to another sound.
import { rhythmBeat } from './rhythm';
import { PPQ, barTicks, type TimeSignature } from './time';

export const STEP_TICKS = PPQ / 4; // a step is a sixteenth note

// Steps in one bar of this time signature.
export function stepsPerBar(ts: TimeSignature): number {
  return Math.round(barTicks(ts) / STEP_TICKS);
}

// Steps in one beat as you'd count it: a quarter in 4/4, a dotted quarter in 6/8, an
// eighth in 7/8. The drum grid groups steps by this.
export function stepsPerBeat(ts: TimeSignature): number {
  return Math.round(rhythmBeat(ts) / STEP_TICKS);
}

export const DRUM_SOUNDS = [
  { type: 'kick', name: 'Kick' },
  { type: 'kick808', name: '808 kick' },
  { type: 'snare', name: 'Snare' },
  { type: 'clap', name: 'Clap' },
  { type: 'rim', name: 'Rimshot' },
  { type: 'hihat', name: 'Closed hi-hat' },
  { type: 'openhat', name: 'Open hi-hat' },
  { type: 'tomlow', name: 'Low tom' },
  { type: 'tommid', name: 'Mid tom' },
  { type: 'tomhigh', name: 'High tom' },
  { type: 'crash', name: 'Crash' },
  { type: 'ride', name: 'Ride' },
  { type: 'cowbell', name: 'Cowbell' },
  { type: 'shaker', name: 'Shaker' }
] as const;

export type DrumSound = (typeof DRUM_SOUNDS)[number]['type'];

// What a new drum track starts with.
export const DEFAULT_KIT: DrumSound[] = ['kick', 'snare', 'hihat'];

export function drumName(sound: DrumSound): string {
  return DRUM_SOUNDS.find((d) => d.type === sound)?.name ?? sound;
}

// ---------- Swing ----------
// Swing delays the off-beat notes: `swing` is where the off-beat falls in its pair,
// 0.5 = exactly halfway (straight), 0.67 = triplet feel, 0.75 = dotted (hard swing).
// `unit` is which notes swing: 8 = off-beat eighths (the usual swing; the same measure
// as the melody's swing), 16 = off-beat sixteenths (funk, hip-hop).

export const SWING_UNITS = [8, 16] as const;
export type SwingUnit = (typeof SWING_UNITS)[number];

// How late a step plays, in sixteenths (multiply by a sixteenth's length in seconds).
export function swingOffset(step: number, swing: number, unit: SwingUnit): number {
  return swingTicks(step * STEP_TICKS, swing, unit) / STEP_TICKS;
}

// How late something at `tick` plays, in ticks (melody tracks swing their notes this way).
export function swingTicks(tick: number, swing: number, unit: SwingUnit): number {
  const cell = unit === 8 ? PPQ : PPQ / 2; // a swung pair: a beat (two eighths), or an eighth
  const p = (((tick % cell) + cell) % cell) / cell; // where it sits in its pair, 0–1
  // The first half of the pair stretches to `swing`, the second half shrinks to fit.
  const swung = p < 0.5 ? p * 2 * swing : swing + (p - 0.5) * 2 * (1 - swing);
  return (swung - p) * cell;
}
