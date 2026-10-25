import { describe, expect, it } from 'vitest';
import { SAMPLES_BASE_URL, SAMPLE_SETS, sampleUrls } from './samples';

describe('sample sets', () => {
  it('turn file names into note names for Tone.Sampler', () => {
    const urls = sampleUrls('bass-electric');
    expect(urls['C#1']).toBe(`${SAMPLES_BASE_URL}bass-electric/Cs1.mp3`);
    expect(urls['A#4']).toBe(`${SAMPLES_BASE_URL}bass-electric/As4.mp3`);
  });

  it('only list valid note names', () => {
    for (const set of SAMPLE_SETS) {
      for (const note of set.notes.split(' ')) expect(note, set.id).toMatch(set.soundfont ? /^[A-G]b?\d$/ : /^[A-G]s?\d$/);
    }
  });

  it('reads soundfont saxophones from their own folder, with flats', () => {
    const urls = sampleUrls('tenor_sax');
    expect(urls['Ab2']).toBe('https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/tenor_sax-mp3/Ab2.mp3');
  });

  it('fall back to the piano for an unknown instrument', () => {
    expect(Object.values(sampleUrls('kazoo'))[0]).toContain('/piano/');
  });
});
