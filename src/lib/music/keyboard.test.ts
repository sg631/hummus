import { describe, expect, it } from 'vitest';
import { COMPACT_KEYS, MonoVoice, PIANO_KEYS, TakeBuilder } from './keyboard';

describe('note keys', () => {
  it('lay out a chromatic scale, a unique semitone per key', () => {
    for (const map of [COMPACT_KEYS, PIANO_KEYS]) {
      const values = Object.values(map);
      expect(new Set(values).size).toBe(values.length);
    }
    expect(PIANO_KEYS.KeyW).toBe(1);
    expect(PIANO_KEYS.KeyK).toBe(12);
  });
  it('compact: A–H then Q–Y, one octave', () => {
    expect(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY'].map((k) => COMPACT_KEYS[k])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('MonoVoice', () => {
  it('attacks, re-attacks on a new key, and returns to a key still held', () => {
    const v = new MonoVoice();
    expect(v.press('KeyA', 60)).toEqual([{ type: 'attack', pitch: 60 }]);
    expect(v.press('KeyD', 64)).toEqual([{ type: 'attack', pitch: 64 }]);
    expect(v.release('KeyD')).toEqual([{ type: 'attack', pitch: 60 }]);
    expect(v.release('KeyA')).toEqual([{ type: 'release' }]);
  });
  it('slides with the slide key held', () => {
    const v = new MonoVoice();
    v.press('KeyA', 60);
    v.setShift(0, true);
    expect(v.press('KeyD', 64)).toEqual([{ type: 'glide', pitch: 64 }]);
  });
  it('moves a held note when the shift changes', () => {
    const v = new MonoVoice();
    v.press('KeyA', 60);
    expect(v.setShift(12, false)).toEqual([{ type: 'attack', pitch: 72 }]);
    expect(v.setShift(-3, true)).toEqual([{ type: 'glide', pitch: 57 }]);
    expect(v.press('KeyS', 62)).toEqual([{ type: 'glide', pitch: 59 }]);
  });
  it('re-attacks the same pitch pressed again', () => {
    const v = new MonoVoice();
    v.press('KeyA', 60);
    expect(v.press('KeyA', 60)).toEqual([{ type: 'attack', pitch: 60 }]);
  });
});

describe('TakeBuilder', () => {
  it('records chords', () => {
    const b = new TakeBuilder();
    b.on(60, 0.8, 0);
    b.on(64, 0.8, 0);
    b.off(60, 480);
    const notes = b.finish(960);
    expect(notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([[60, 0, 480], [64, 0, 960]]);
  });
  it('stores a glide as a legato note into a gliding one', () => {
    const b = new TakeBuilder();
    b.on(60, 0.7, 0);
    b.glide(62, 240);
    const [a, c] = b.finish(480);
    expect(a.articulation?.kind).toBe('legato');
    expect(a.duration).toBe(240);
    expect(c).toMatchObject({ pitch: 62, start: 240, duration: 240, velocity: 0.7, expression: { glide: 0.08 } });
  });
  it('trims notes played during the count-in', () => {
    const b = new TakeBuilder();
    b.on(60, 0.8, -100);
    b.off(60, 200);
    b.on(62, 0.8, -300);
    b.off(62, -10);
    expect(b.finish(500).map((n) => [n.pitch, n.start, n.duration])).toEqual([[60, 0, 200]]);
  });
});
