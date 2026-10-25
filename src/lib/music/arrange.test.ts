import { describe, expect, it } from 'vitest';
import { arrangementEnd, contentLength, expandPlacements, placementAt } from './arrange';
import type { NoteClip, Placement } from './types';

const BAR = 1920; // 4/4
const clip: NoteClip = {
  id: 'c',
  start: 0,
  duration: 1440,
  notes: [
    { id: 'a', pitch: 60, start: 0, duration: 480, velocity: 0.8 },
    { id: 'b', pitch: 62, start: 1440, duration: 960, velocity: 0.8 }
  ]
};

describe('arrangement', () => {
  it('rounds content up to whole bars', () => {
    expect(contentLength(1440, BAR)).toBe(1920);
    expect(contentLength(0, BAR)).toBe(1920);
    expect(contentLength(2000, BAR)).toBe(3840);
  });

  it('plays a placement once, at its start', () => {
    const out = expandPlacements([clip], [{ id: 'p', clipId: 'c', start: 3840 }], BAR);
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe(3840);
    expect(out[0].notes.map((n) => n.start)).toEqual([0, 1440]);
  });

  it('loops a longer placement and cuts notes at its end', () => {
    const out = expandPlacements([clip], [{ id: 'p', clipId: 'c', start: 0, length: BAR * 1.5 }], BAR);
    expect(out.map((c) => c.start)).toEqual([0, BAR]);
    expect(out[1].notes.map((n) => [n.start, n.duration])).toEqual([[0, 480]]); // the second b starts after the end
    expect(out[0].notes.map((n) => n.duration)).toEqual([480, 960]); // ends at 2400, before the end (2880)
  });

  it('shares content: copies are placements of the same clip', () => {
    const placements: Placement[] = [
      { id: 'p1', clipId: 'c', start: 0 },
      { id: 'p2', clipId: 'c', start: BAR * 2 }
    ];
    const out = expandPlacements([clip], placements, BAR);
    expect(out.map((c) => c.start)).toEqual([0, BAR * 2]);
    expect(out[0].notes[0].pitch).toBe(out[1].notes[0].pitch);
  });

  it('finds the placement at a time and the end of the song', () => {
    const placements: Placement[] = [
      { id: 'p1', clipId: 'c', start: 0 },
      { id: 'p2', clipId: 'c', start: BAR * 2, length: BAR * 2 }
    ];
    const len = (p: Placement) => p.length ?? BAR;
    expect(placementAt(placements, 100, len)?.id).toBe('p1');
    expect(placementAt(placements, BAR * 1.5, len)).toBeUndefined();
    expect(placementAt(placements, BAR * 3, len)?.id).toBe('p2');
    expect(arrangementEnd(placements, len)).toBe(BAR * 4);
  });
});
