import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { parseMidi } from './midi-import';

function file(): ArrayBuffer {
  const m = new Midi();
  m.header.setTempo(90);
  const lead = m.addTrack();
  lead.name = 'Lead';
  lead.instrument.number = 65; // alto sax
  for (let i = 0; i < 4; i++) lead.addNote({ midi: 60 + i, ticks: i * 480, durationTicks: 400, velocity: 0.7 });
  lead.addPitchBend({ ticks: 480, value: 4096 }); // +1 semitone (the writer wants −8192 … 8191; see midi.ts)
  lead.addCC({ number: 1, ticks: 960, value: 0.75 });
  const keys = m.addTrack();
  keys.instrument.number = 0; // piano: a chord
  for (const p of [60, 64, 67]) keys.addNote({ midi: p, ticks: 0, durationTicks: 960 });
  const drums = m.addTrack();
  drums.channel = 9;
  for (let bar = 0; bar < 3; bar++) {
    drums.addNote({ midi: 36, ticks: bar * 1920, durationTicks: 60 });
    drums.addNote({ midi: 38, ticks: bar * 1920 + 960, durationTicks: 60 });
  }
  const a = m.toArray();
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}

describe('parseMidi', () => {
  it('turns parts into melody and drum tracks', () => {
    const r = parseMidi(file());
    expect(r.bpm).toBe(90);
    const [lead, keys, drums] = r.tracks;
    expect(lead).toMatchObject({ kind: 'midi', name: 'Lead', instrument: 'sample-alto_sax', poly: false });
    expect(lead.kind === 'midi' && lead.notes.map((n) => [n.pitch, n.start])).toEqual([[60, 0], [61, 480], [62, 960], [63, 1440]]);
    expect(lead.kind === 'midi' && lead.controllers).toEqual({ bend: [{ tick: 480, value: 1 }], mod: [{ tick: 960, value: 0.75 }] });
    expect(keys).toMatchObject({ kind: 'midi', instrument: 'sample-piano', poly: true });
    expect(drums.kind).toBe('drums');
    if (drums.kind !== 'drums') return;
    expect(drums.rows.map((x) => x.sound)).toEqual(['kick', 'snare']);
    // three identical bars: one pattern, placed three times
    expect(drums.patterns).toHaveLength(1);
    expect(drums.placements.map((p) => p.start)).toEqual([0, 1920, 3840]);
    expect(drums.patterns[0].steps[drums.rows[1].id][8]).toBe(true);
  });
});

describe('MIDI export and import round trip', () => {
  it('keeps pitch bends and the mod wheel', async () => {
    const { tracksToMidi } = await import('./midi');
    const clip = { id: 'c', start: 0, duration: 1920, notes: [{ id: 'n', pitch: 60, start: 0, duration: 960, velocity: 0.8 }], controllers: { bend: [{ tick: 240, value: -1.5 }], mod: [{ tick: 480, value: 0.4 }] } };
    const blob = tracksToMidi([{ name: 'Lead', clips: [clip] }], 120);
    const r = parseMidi(await blob.arrayBuffer());
    const t = r.tracks[0];
    if (t.kind !== 'midi') throw new Error('not a melody');
    expect(t.controllers?.bend).toEqual([{ tick: 240, value: -1.5 }]);
    expect(t.controllers?.mod?.[0].tick).toBe(480);
    expect(t.controllers?.mod?.[0].value).toBeCloseTo(0.4, 1); // the mod wheel has 128 steps in MIDI
  });
});
