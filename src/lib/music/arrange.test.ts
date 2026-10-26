import { describe, expect, it } from 'vitest';
import { arrangementEnd, contentLength, expandPlacements, patternProject, placementAt, shiftProject, songLength, splitPlacement } from './arrange';
import type { DrumTrack, MidiTrack, NoteClip, Placement, Project } from './types';

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

  const song = (): Project => ({
    name: 's', bpm: 120, timeSignature: [4, 4], key: 'C', scale: 'major', detune: 0, transpose: 0, masterVolume: 0, instruments: [], masterEffects: [], automation: [], buses: [], markers: [],
    tracks: [
      { id: 'm', kind: 'midi', name: 'M', volume: 0, pan: 0, mute: false, swing: 0.5, swingUnit: 8, effects: [], instrument: 'piano',
        clips: [clip], placements: [{ id: 'p1', clipId: 'c', start: 0 }, { id: 'p2', clipId: 'c', start: BAR * 2 }], current: 'c' },
      { id: 'd', kind: 'drums', name: 'D', volume: 0, pan: 0, mute: false, swing: 0.5, swingUnit: 8, effects: [], rows: [],
        patterns: [{ id: 'pat', name: 'P', bars: 2, steps: {} }], placements: [{ id: 'dp', clipId: 'pat', start: BAR }], current: 'pat' }
    ]
  });

  it('knows how long the song is: the last block, pattern or recording', () => {
    const p = song();
    expect(songLength(p)).toBe(BAR * 3); // melody block at bar 3 (one bar) and drums bars 2–3
    p.tracks.push({ id: 'v', kind: 'voice', name: 'V', volume: 0, pan: 0, mute: false, swing: 0.5, swingUnit: 8, effects: [],
      clips: [{ id: 'r', start: BAR * 4, audio: new Float32Array(48000 * 2), sampleRate: 48000, recordedBpm: 120 }] });
    expect(songLength(p)).toBe(BAR * 5); // 2 s at 120 BPM = one bar, from bar 5
    const drumsOnly: Project = { ...p, tracks: [{ ...(p.tracks[1] as DrumTrack), placements: [] }] };
    expect(songLength(drumsOnly)).toBe(BAR * 2); // looping all song: its pattern once
  });

  it('pattern mode plays just the current clip or pattern, looped', () => {
    const m = patternProject(song(), 'm', 0, 2)!;
    expect(m.project.tracks).toHaveLength(1);
    expect(m.length).toBe(BAR);
    const d = patternProject(song(), 'd', 0, 2)!;
    expect(d.length).toBe(BAR * 2);
  });

  it('shifts the song to start at the playhead', () => {
    const shifted = shiftProject(song(), BAR * 2);
    const melody = shifted.tracks[0] as MidiTrack;
    expect(melody.clips[0].notes.map((n) => n.start)).toEqual([0, 1440]); // the second placement, now at 0
    expect((shifted.tracks[1] as DrumTrack).placements[0].start).toBe(-BAR); // started earlier: picks up part-way
  });
});

describe('splitting and offsets', () => {
  const BAR = 1920;
  const clip: NoteClip = { id: 'c', start: 0, duration: BAR, notes: [0, 480, 960, 1440].map((t, i) => ({ id: `n${i}`, pitch: 60 + i, start: t, duration: 240, velocity: 0.8 })) };
  const starts = (ps: Placement[]) => expandPlacements([clip], ps, BAR).flatMap((c) => c.notes.map((n) => c.start + n.start));
  it('a split block carries on from the same point of the clip', () => {
    const p: Placement = { id: 'p', clipId: 'c', start: 0 };
    const second = splitPlacement(p, 960, BAR)!;
    expect(p.length).toBe(960);
    expect(second).toMatchObject({ start: 960, length: 960, offset: 960 });
    expect(starts([p, second])).toEqual([0, 480, 960, 1440]); // the same notes as before
  });
  it("a trimmed start skips the clip's beginning, and loops after", () => {
    expect(starts([{ id: 'p', clipId: 'c', start: 0, offset: 480, length: BAR }])).toEqual([0, 480, 960, 1440]);
    expect(expandPlacements([clip], [{ id: 'p', clipId: 'c', start: 0, offset: 480, length: BAR }], BAR).flatMap((c) => c.notes.map((n) => n.pitch))).toEqual([61, 62, 63, 60]);
  });
  it('muted blocks are silent', () => {
    expect(starts([{ id: 'p', clipId: 'c', start: 0, muted: true }])).toEqual([]);
  });
});
