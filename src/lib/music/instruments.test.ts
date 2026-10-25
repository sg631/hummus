import { describe, expect, it } from 'vitest';
import * as Tone from 'tone';
import { BUILT_IN_PRESETS, ENGINES, engine, presetById, presetOptions, type Engine } from './instruments';

// Each engine type's Tone.js class, to check settings against its real options.
const TONE_CLASSES: Record<string, { getDefaults(): object }> = {
  synth: Tone.Synth,
  am: Tone.AMSynth,
  fm: Tone.FMSynth,
  duo: Tone.DuoSynth,
  mono: Tone.MonoSynth,
  membrane: Tone.MembraneSynth,
  sampler: Tone.Sampler
};

function hasPath(obj: object, path: string): boolean {
  let o: unknown = obj;
  for (const key of path.split('.')) {
    if (typeof o !== 'object' || o === null || !(key in o)) return false;
    o = (o as Record<string, unknown>)[key];
  }
  return true;
}

describe('instrument engines', () => {
  it('only use options their Tone.js instrument has', () => {
    for (const e of ENGINES as readonly Engine[]) {
      const defaults = TONE_CLASSES[e.type].getDefaults();
      for (const p of e.params) {
        if (p.option === false) continue;
        for (const path of p.paths ?? [p.key]) expect(hasPath(defaults, path), `${e.type}: ${path}`).toBe(true);
      }
    }
  });

  it('have defaults inside their ranges and choices', () => {
    for (const e of ENGINES as readonly Engine[]) {
      for (const p of e.params) {
        if (p.kind === 'number') {
          expect(p.default, `${e.type}.${p.key}`).toBeGreaterThanOrEqual(p.min);
          expect(p.default, `${e.type}.${p.key}`).toBeLessThanOrEqual(p.max);
        } else {
          expect(p.options).toContain(p.default);
        }
      }
    }
  });
});

describe('presets', () => {
  it('built-ins only set settings their engine has', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const keys = engine(preset.engine).params.map((p) => p.key);
      for (const key of Object.keys(preset.params)) expect(keys, `${preset.id}: ${key}`).toContain(key);
    }
  });

  it('become nested Tone options, with engine defaults for what they leave out', () => {
    const piano = presetById([], 'piano');
    const options = presetOptions(piano) as { oscillator: { type: string }; envelope: { attack: number }; volume: number };
    expect(options.oscillator.type).toBe('triangle');
    expect(options.envelope.attack).toBe(0.005);
    expect(options.volume).toBe(0);
  });

  it('copies one setting to several paths (both Duo voices)', () => {
    const options = presetOptions({ id: 'x', name: 'x', engine: 'duo', params: { 'envelope.attack': 0.3 } }) as {
      voice0: { envelope: { attack: number } };
      voice1: { envelope: { attack: number } };
    };
    expect(options.voice0.envelope.attack).toBe(0.3);
    expect(options.voice1.envelope.attack).toBe(0.3);
  });

  it('finds yours first, then built in, then falls back to the piano', () => {
    const mine = { id: 'mine', name: 'Mine', engine: 'fm' as const, params: {} };
    expect(presetById([mine], 'mine')).toBe(mine);
    expect(presetById([mine], 'bass').name).toBe('Bass');
    expect(presetById([mine], 'deleted').id).toBe('piano');
  });
});
