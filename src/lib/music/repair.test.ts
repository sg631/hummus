import { describe, expect, it } from 'vitest';
import { expandPlacements } from './arrange';
import { repairProject } from './repair';
import type { MidiTrack, Project } from './types';

const broken = (): Project => ({
  name: 'b', bpm: 100, timeSignature: [4, 4], key: 'C', scale: 'major', detune: 0, transpose: 0, masterVolume: 0, instruments: [], masterEffects: [], buses: [], markers: [],
  automation: [{ id: 'l', enabled: true, points: [{ tick: NaN, value: 1 }, { tick: 960, value: 0 }, { tick: 0, value: 2 }] }],
  tracks: [
    {
      id: 'm', name: 'Piano', kind: 'midi', instrument: 'piano', volume: 0, pan: 0, mute: false, swing: 0.5, swingUnit: 8, effects: [],
      clips: [{ id: 'c', start: 0, duration: NaN, notes: [{ id: 'a', pitch: 60, start: 0, duration: 480, velocity: 0.8 }, { id: 'b', pitch: 62, start: NaN, duration: 480, velocity: 0.8 }] }],
      placements: [{ id: 'p', clipId: 'c', start: NaN }, { id: 'q', clipId: 'c', start: 1920, length: NaN }]
    }
  ]
});

describe('repairProject', () => {
  it('fixes NaN positions, lengths, notes and points so the track plays again', () => {
    const p = broken();
    const fixed = repairProject(p);
    expect(fixed.length).toBeGreaterThan(0);
    const t = p.tracks[0] as MidiTrack;
    expect(t.placements.map((x) => [x.start, x.length])).toEqual([[0, undefined], [1920, undefined]]);
    expect(t.clips[0].notes).toHaveLength(1);
    expect(t.clips[0].duration).toBe(480);
    expect(p.automation[0].points.map((x) => x.tick)).toEqual([0, 960]);
    // and it plays: both blocks give notes
    expect(expandPlacements(t.clips, t.placements, 1920).flatMap((c) => c.notes)).toHaveLength(2);
  });
  it('leaves a healthy project alone', () => {
    const p = broken();
    repairProject(p);
    expect(repairProject(p)).toEqual([]);
  });
});
