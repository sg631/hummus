import { describe, expect, it } from 'vitest';
import { toAbc } from './notation';
import type { Note } from './types';

const n = (pitch: number, start: number, duration: number): Note => ({ id: `${pitch}-${start}`, pitch, start, duration, velocity: 0.8 });
const opts = { lengthTicks: 1920, timeSignature: [4, 4] as [number, number], key: 'C', scale: 'major' };
const body = (abc: string) => abc.split('\n').at(-1)!;

describe('toAbc', () => {
  it('writes a key, a meter and quarter notes', () => {
    const abc = toAbc([n(60, 0, 480), n(62, 480, 480), n(64, 960, 480), n(65, 1440, 480)], opts);
    expect(abc).toContain('M:4/4');
    expect(abc).toContain('K:C');
    expect(body(abc)).toBe('C4 D4 E4 F4 |]');
  });

  it('fills gaps with rests and the bar to its end', () => {
    expect(body(toAbc([n(72, 480, 240)], opts))).toBe('z4 c2z2 z8 |]');
  });

  it('ties notes across bar lines', () => {
    expect(body(toAbc([n(60, 1440, 960)], { ...opts, lengthTicks: 3840 }))).toBe('z12 C4- | C4 z12 |]');
  });

  it('spells in the key, and an accidental lasts the bar', () => {
    // A minor: G♯ needs a sharp once in the bar; then G natural needs a natural.
    const abc = toAbc([n(68, 0, 480), n(68, 480, 480), n(67, 960, 480), n(69, 1440, 480)], { ...opts, key: 'A', scale: 'minor' });
    expect(abc).toContain('K:Am');
    expect(body(abc)).toBe('^G4 G4 =G4 A4 |]');
    // F major: B♭ is in the signature.
    expect(body(toAbc([n(70, 0, 1920)], { ...opts, key: 'F' }))).toBe('B16 |]');
    // C major: borrowed E♭ and B♭ are flats; F♯ (♯4) is a sharp.
    expect(body(toAbc([n(63, 0, 480), n(70, 480, 480), n(66, 960, 960)], opts))).toBe('_E4 _B4 ^F8 |]');
  });

  it('makes chords of notes that start together, and picks the bass clef for low notes', () => {
    const abc = toAbc([n(43, 0, 1920), n(47, 0, 1920), n(50, 0, 1920)], opts);
    expect(abc).toContain('clef=bass');
    expect(body(abc)).toBe('[G,,B,,D,]16 |]');
  });

  it('octaves: middle C is C, an octave up c, two up c\'', () => {
    expect(body(toAbc([n(48, 0, 480), n(60, 480, 480), n(72, 960, 480), n(84, 1440, 480)], opts))).toBe("C,4 C4 c4 c'4 |]");
  });
});
