// Playing notes from the computer keyboard (or a MIDI keyboard): which key is which note,
// one-note-at-a-time playing, and turning what was played into notes.
//
// Two layouts for the note keys (physical positions, so any keyboard layout works):
//
// Compact (the default): one octave, a semitone per key, home row then top row:
//   Q  W  E  R  T  Y            F# G  G# A  A# B
//   A  S  D  F  G  H            C  C# D  D# E  F
//
// Piano: laid out like a keyboard, a bit more than an octave and a half:
//    W E   T Y U   O P          black keys: C# D#  F# G# A#  C# D#
//   A S D F G H J K L ; '       white keys: C  D  E F  G  A  B C  D  E  F
//
// Polyphonic tracks (chords): the usual DAW layout. Z / X: octave down / up; C / V:
// softer / louder. Hold several keys for a chord.
// One-note tracks: the shift-key system you know from singing (music/shift-keys.ts), held:
//   Z X C V   −2 −1 +1 +2 octaves      1 … 9, 0   up that many semitones (0 = 10)
//   − with a number: down instead     ` held: slide into the next note instead of a new attack
// The last key pressed sounds; let go and the one still held sounds again.
//
// Keyboards can only report some combinations of keys at once ("ghosting"): if a held key
// seems ignored, that's the keyboard, not the app. The keys used here are spread out, so
// most keyboards manage three or four together.
import type { Note } from './types';

export type KeyLayout = 'compact' | 'piano';

export const COMPACT_KEYS: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyG: 4, KeyH: 5, KeyQ: 6, KeyW: 7, KeyE: 8, KeyR: 9, KeyT: 10, KeyY: 11
};
export const PIANO_KEYS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17
};
export function noteKeys(layout: KeyLayout): Record<string, number> {
  return layout === 'piano' ? PIANO_KEYS : COMPACT_KEYS;
}
export const POLY_OCTAVE_KEYS: Record<string, -1 | 1> = { KeyZ: -1, KeyX: 1 };
export const POLY_VELOCITY_KEYS: Record<string, -1 | 1> = { KeyC: -1, KeyV: 1 };
export const BASE_NOTE = 60; // A plays middle C (C4)

// The label printed on a note key, for the on-screen help ('A', ';'…).
export function keyLabel(code: string): string {
  return code === 'Semicolon' ? ';' : code === 'Quote' ? "'" : code.replace('Key', '');
}

// ---------- One note at a time ----------

export type VoiceEvent = { type: 'attack'; pitch: number } | { type: 'glide'; pitch: number } | { type: 'release' };

// A monophonic voice: keys held (each with its pitch before the shift), the shift held now
// (semitones), and whether the slide key is down. Each change returns what the instrument
// should do: start a note, glide to a pitch (no new attack), or let go.
export class MonoVoice {
  private held: { key: string; pitch: number }[] = [];
  private sounding: number | null = null; // the pitch playing now
  shift = 0;
  slide = false;

  get pitch(): number | null {
    return this.sounding;
  }

  private target(): number | null {
    const top = this.held.at(-1);
    return top ? top.pitch + this.shift : null;
  }

  // Moving to whatever should sound now.
  private move(): VoiceEvent[] {
    const next = this.target();
    if (next === this.sounding) return [];
    const was = this.sounding;
    this.sounding = next;
    if (next === null) return [{ type: 'release' }];
    if (was === null || !this.slide) return [{ type: 'attack', pitch: next }];
    return [{ type: 'glide', pitch: next }];
  }

  press(key: string, pitch: number): VoiceEvent[] {
    this.held = [...this.held.filter((h) => h.key !== key), { key, pitch }];
    if (this.sounding !== null && !this.slide && this.target() === this.sounding) {
      return [{ type: 'attack', pitch: this.sounding }]; // the same note again: a new attack
    }
    return this.move();
  }

  release(key: string): VoiceEvent[] {
    this.held = this.held.filter((h) => h.key !== key);
    return this.move();
  }

  // The held shift (or slide key) changed: a held note moves to its new pitch.
  setShift(shift: number, slide: boolean): VoiceEvent[] {
    this.slide = slide;
    if (shift === this.shift) return [];
    this.shift = shift;
    return this.move();
  }

  releaseAll(): VoiceEvent[] {
    this.held = [];
    return this.move();
  }
}

// ---------- Recording what's played ----------

const GLIDE_SEC = 0.08; // a slide into the next note takes this long

// Builds notes from what's played (ticks from the take's start). Polyphonic: on/off per
// pitch. One note at a time: `glide` ends the note playing and slides into the next one
// (legato, no new attack), as sung slides are stored.
export class TakeBuilder {
  private done: Note[] = [];
  private open = new Map<number, Note>();

  on(pitch: number, velocity: number, tick: number) {
    this.off(pitch, tick);
    this.open.set(pitch, { id: crypto.randomUUID(), pitch, start: tick, duration: 0, velocity });
  }

  off(pitch: number, tick: number) {
    const n = this.open.get(pitch);
    if (!n) return;
    this.open.delete(pitch);
    n.duration = tick - n.start;
    this.done.push(n);
  }

  // One note at a time: from the note playing to `pitch`, without a new attack.
  glide(pitch: number, tick: number) {
    const from = [...this.open.values()].at(-1);
    const velocity = from?.velocity ?? 0.8;
    if (from) {
      from.articulation = { kind: 'legato', accent: false, accentDb: 0 };
      this.off(from.pitch, tick);
    }
    this.on(pitch, velocity, tick);
    this.open.get(pitch)!.expression = { glide: GLIDE_SEC };
  }

  // Lets go of everything at `tick`. The notes (sorted), without any before the take's
  // start (played during the count-in) and nothing of zero length.
  finish(tick: number): Note[] {
    for (const pitch of [...this.open.keys()]) this.off(pitch, tick);
    return this.done
      .map((n) => (n.start < 0 ? { ...n, duration: n.duration + n.start, start: 0 } : n))
      .filter((n) => n.duration > 0)
      .sort((a, b) => a.start - b.start);
  }
}
