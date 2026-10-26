import { describe, expect, it } from 'vitest';
import { BEATS, TEMPO, shapeAt, activeLanes, addPoint, allTargets, meterAt, secondsBetween, shiftAutomation, targetInfo, targetKey, valueAt } from './automation';
import type { Project } from './types';

const project = (): Project => ({
  name: 't', bpm: 120, timeSignature: [4, 4], key: 'C', scale: 'major', detune: 0, transpose: 0, masterVolume: -3, instruments: [], buses: [], markers: [],
  masterEffects: [{ id: 'mfx', type: 'reverb', enabled: true, params: { decay: 2, preDelay: 0.01, mix: 0.3 } }],
  automation: [],
  tracks: [
    {
      id: 'a', name: 'Bass', kind: 'midi', instrument: 'piano', volume: -6, pan: 0.5, mute: false, swing: 0.5, swingUnit: 8,
      effects: [{ id: 'f1', type: 'lowpass', enabled: true, params: { frequency: 800, Q: 1 } }], clips: [], placements: []
    },
    {
      id: 'd', name: 'Drums', kind: 'drums', volume: 0, pan: 0, mute: false, swing: 0.5, swingUnit: 8, effects: [],
      rows: [{ id: 'k', sound: 'kick', volume: -2, pan: 0, mute: false, effects: [] }], patterns: [], placements: []
    }
  ]
});

describe('valueAt', () => {
  const pts = [{ tick: 100, value: 0 }, { tick: 200, value: 10 }, { tick: 300, value: 4 }];
  it('holds the first value before and the last after', () => {
    expect(valueAt(pts, 0)).toBe(0);
    expect(valueAt(pts, 1000)).toBe(4);
  });
  it('moves in a straight line between points', () => {
    expect(valueAt(pts, 150)).toBe(5);
    expect(valueAt(pts, 250)).toBe(7);
  });
  it('is undefined with no points', () => {
    expect(valueAt([], 5)).toBeUndefined();
  });
});

describe('targets', () => {
  it('describes volumes, pans and effect settings, with the knob value', () => {
    const p = project();
    expect(targetInfo(p, { kind: 'mix', ownerId: 'a', param: 'volume' })).toMatchObject({ owner: 'Bass', label: 'Volume', value: -6 });
    expect(targetInfo(p, { kind: 'mix', ownerId: 'master', param: 'volume' })?.value).toBe(-3);
    expect(targetInfo(p, { kind: 'mix', ownerId: 'k', param: 'pan' })?.owner).toBe('Drums: Kick');
    const fx = targetInfo(p, { kind: 'effect', ownerId: 'a', effectId: 'f1', param: 'frequency' });
    expect(fx).toMatchObject({ label: 'Low-pass filter: Cutoff', value: 800 });
  });
  it('is undefined once the track or effect is gone', () => {
    const p = project();
    expect(targetInfo(p, { kind: 'mix', ownerId: 'gone', param: 'volume' })).toBeUndefined();
    expect(targetInfo(p, { kind: 'effect', ownerId: 'a', effectId: 'gone', param: 'Q' })).toBeUndefined();
  });
  it('lists everything automatable, but not slow reverb settings', () => {
    const keys = allTargets(project()).map((t) => targetKey(t.target));
    expect(keys).toContain('mix:a:volume');
    expect(keys).toContain('mix:k:pan');
    expect(keys).toContain('fx:a:f1:frequency');
    expect(keys).toContain('fx:master:mfx:mix');
    expect(keys).not.toContain('fx:master:mfx:decay');
    expect(keys).not.toContain('mix:master:pan');
  });
});

describe('lanes', () => {
  it('keeps points sorted, replacing one at the same tick', () => {
    let pts = addPoint([], { tick: 200, value: 1 });
    pts = addPoint(pts, { tick: 100, value: 2 });
    pts = addPoint(pts, { tick: 200, value: 3 });
    expect(pts).toEqual([{ tick: 100, value: 2 }, { tick: 200, value: 3 }]);
  });
  it('shifts lanes for recording from the playhead', () => {
    const lanes = [{ id: 'l', enabled: true, target: { kind: 'mix' as const, ownerId: 'a', param: 'volume' as const }, points: [{ tick: 960, value: 0 }] }];
    expect(shiftAutomation(lanes, 480)[0].points[0].tick).toBe(480);
  });
  it('plays only lanes that are on, have points and still have a target', () => {
    const p = project();
    const target = { kind: 'mix' as const, ownerId: 'a', param: 'volume' as const };
    p.automation = [
      { id: '1', enabled: true, target, points: [{ tick: 0, value: 0 }] },
      { id: '2', enabled: false, target, points: [{ tick: 0, value: 0 }] },
      { id: '3', enabled: true, target, points: [] },
      { id: '4', enabled: true, target: { kind: 'mix', ownerId: 'gone', param: 'pan' }, points: [{ tick: 0, value: 0 }] }
    ];
    expect(activeLanes(p).map((l) => l.id)).toEqual(['1']);
  });
});

describe('tempo and time signature', () => {
  it('steps instead of sloping', () => {
    const pts = [{ tick: 0, value: 4 }, { tick: 1000, value: 3 }];
    expect(valueAt(pts, 999, true)).toBe(4);
    expect(valueAt(pts, 1000, true)).toBe(3);
    expect(valueAt(pts, 500)).toBe(3.5);
  });
  it('describes the song targets', () => {
    const p = project();
    expect(targetInfo(p, TEMPO)).toMatchObject({ owner: 'Song', label: 'Tempo', value: 120 });
    expect(targetInfo(p, BEATS)).toMatchObject({ stepped: true, value: 4 });
    expect(allTargets(p).map((t) => targetKey(t.target))).toContain('song:bpm');
    expect(targetInfo(p, undefined)).toBeUndefined();
  });
  it('counts bars through time signature changes, from the next bar line', () => {
    // 4/4 (bars of 1920), changing to 3 beats (1440) at tick 3000: takes effect at bar 2 (3840).
    const lane = [{ tick: 0, value: 4 }, { tick: 3000, value: 3 }];
    expect(meterAt(lane, [4, 4], 3500)).toMatchObject({ beats: 4, barStart: 1920, bar: 1 });
    expect(meterAt(lane, [4, 4], 3840)).toMatchObject({ beats: 3, barStart: 3840, bar: 2 });
    expect(meterAt(lane, [4, 4], 3840 + 1440 + 10)).toMatchObject({ beats: 3, barStart: 5280, bar: 3 });
    expect(meterAt(undefined, [3, 4], 1500)).toMatchObject({ beats: 3, barStart: 1440, bar: 1 });
  });
  it('times the song along a tempo lane', () => {
    const p = project();
    expect(secondsBetween(p, 0, 1920)).toBeCloseTo(2); // 4 beats at 120
    p.automation = [{ id: 't', enabled: true, target: TEMPO, points: [{ tick: 0, value: 60 }] }];
    expect(secondsBetween(p, 0, 1920)).toBeCloseTo(4); // 4 beats at 60
  });
});

describe('segment shapes', () => {
  const at = (shape: object, t: number) => shapeAt({ tick: 0, value: 0, ...shape }, t);
  it('bends, smooths, holds', () => {
    expect(at({}, 0.5)).toBe(0.5);
    expect(at({ shape: 'curve', tension: 1 }, 0.5)).toBeLessThan(0.1); // slow start
    expect(at({ shape: 'curve', tension: -1 }, 0.5)).toBeGreaterThan(0.9); // fast start
    expect(at({ shape: 'smooth' }, 0.5)).toBe(0.5);
    expect(at({ shape: 'smooth' }, 0.1)).toBeLessThan(0.1);
    expect(at({ shape: 'hold' }, 0.99)).toBe(0);
  });
  it('waves between the two values', () => {
    expect(at({ shape: 'wave', cycles: 2 }, 0.25)).toBeCloseTo(1); // sine peak mid-cycle
    expect(at({ shape: 'wave', cycles: 2 }, 0.5)).toBeCloseTo(0);
    expect(at({ shape: 'wave', wave: 'square', cycles: 1 }, 0.75)).toBe(1);
    expect(at({ shape: 'wave', wave: 'saw', cycles: 1 }, 0.3)).toBeCloseTo(0.3);
    const pts = [{ tick: 0, value: 10, shape: 'wave' as const, cycles: 1 }, { tick: 100, value: 20 }];
    expect(valueAt(pts, 50)).toBeCloseTo(20);
  });
});
