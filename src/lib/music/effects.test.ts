import { describe, expect, it } from 'vitest';
import { EFFECTS, defaultParams, formatParam, searchEffects, type EffectDefinition } from './effects';

describe('effects catalogue', () => {
  it('has unique types and defaults inside each range', () => {
    expect(new Set(EFFECTS.map((e) => e.type)).size).toBe(EFFECTS.length);
    for (const e of EFFECTS as readonly EffectDefinition[]) {
      for (const p of e.params) {
        expect(p.default, `${e.type}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${e.type}.${p.key}`).toBeLessThanOrEqual(p.max);
        if (p.log) expect(p.min).toBeGreaterThan(0);
      }
    }
  });

  it('gives a new effect its defaults', () => {
    expect(defaultParams('delay')).toEqual({ delayTime: 0.25, feedback: 0.3, mix: 0.3 });
  });

  it('searches names, categories and descriptions', () => {
    expect(searchEffects('').length).toBe(EFFECTS.length);
    expect(searchEffects('REVERB').map((e) => e.type)).toEqual(['reverb']);
    expect(searchEffects('echo').map((e) => e.type)).toContain('delay');
    expect(searchEffects('filter').length).toBeGreaterThanOrEqual(4);
    expect(searchEffects('nothing like this')).toEqual([]);
  });

  it('formats values for the effect window', () => {
    const mix = EFFECTS[0].params.find((p) => p.key === 'mix')!;
    expect(formatParam(mix, 0.3)).toBe('30%');
    expect(formatParam({ step: 1, unit: 'Hz' }, 440)).toBe('440 Hz');
  });
});
