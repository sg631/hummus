// The effects a track can have: what each is called, what it does, and its settings.
// Pure data, no sound: audio/effects.ts turns an effect into Tone.js nodes, and the
// effect windows draw a slider per setting from this list.
//
// A track's effects run in order, top to bottom: instrument → effect 1 → effect 2 → … → channel.

export interface EffectParam {
  key: string;       // name in Effect.params
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;     // shown after the value: 'Hz', 'dB', 's', '%' (0–1 shown as a percentage)…
  log?: boolean;     // slider moves in ratios (frequencies), not steps
}

export interface EffectDefinition {
  type: string;
  name: string;
  category: EffectCategory;
  description: string;
  params: readonly EffectParam[];
}

export const EFFECT_CATEGORIES = ['Space', 'Modulation', 'Distortion', 'Pitch', 'Filter & EQ', 'Dynamics', 'Stereo'] as const;
export type EffectCategory = (typeof EFFECT_CATEGORIES)[number];

// How much of the effect is heard, 0 (dry) to 1 (all effect). Most effects have it.
const mix = (def = 0.5): EffectParam => ({ key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: def, unit: '%' });
const rate = (def: number, max = 10): EffectParam => ({ key: 'frequency', label: 'Rate', min: 0.1, max, step: 0.1, default: def, unit: 'Hz' });
const depth = (def = 0.5): EffectParam => ({ key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: def, unit: '%' });
const cutoff = (def: number): EffectParam => ({ key: 'frequency', label: 'Cutoff', min: 20, max: 20000, step: 1, default: def, unit: 'Hz', log: true });
const resonance: EffectParam = { key: 'Q', label: 'Resonance', min: 0.1, max: 20, step: 0.1, default: 1 };

export const EFFECTS = [
  // ---------- Space ----------
  {
    type: 'reverb', name: 'Reverb', category: 'Space',
    description: 'A room or hall around the sound.',
    params: [
      { key: 'decay', label: 'Size (decay)', min: 0.2, max: 10, step: 0.1, default: 2, unit: 's' },
      { key: 'preDelay', label: 'Pre-delay', min: 0, max: 0.2, step: 0.005, default: 0.01, unit: 's' },
      mix(0.3)
    ]
  },
  {
    type: 'delay', name: 'Delay', category: 'Space',
    description: 'Echoes that repeat and fade.',
    params: [
      { key: 'delayTime', label: 'Time', min: 0.02, max: 1, step: 0.01, default: 0.25, unit: 's' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.3, unit: '%' },
      mix(0.3)
    ]
  },
  {
    type: 'pingpong', name: 'Ping-pong delay', category: 'Space',
    description: 'Echoes bouncing between left and right.',
    params: [
      { key: 'delayTime', label: 'Time', min: 0.02, max: 1, step: 0.01, default: 0.25, unit: 's' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.3, unit: '%' },
      mix(0.3)
    ]
  },

  // ---------- Modulation ----------
  {
    type: 'chorus', name: 'Chorus', category: 'Modulation',
    description: 'Thickens the sound, like several players at once.',
    params: [rate(1.5), depth(0.7), { key: 'delayTime', label: 'Delay', min: 2, max: 20, step: 0.5, default: 3.5, unit: 'ms' }, mix()]
  },
  {
    type: 'phaser', name: 'Phaser', category: 'Modulation',
    description: 'A sweeping, swirling whoosh.',
    params: [
      rate(0.5),
      { key: 'octaves', label: 'Range', min: 1, max: 6, step: 0.5, default: 3, unit: 'oct' },
      { key: 'baseFrequency', label: 'Base', min: 100, max: 2000, step: 1, default: 350, unit: 'Hz', log: true },
      mix()
    ]
  },
  {
    type: 'flanger', name: 'Flanger', category: 'Modulation',
    description: 'A jet-plane swoosh, great on guitars and drums.',
    params: [
      rate(0.3),
      depth(0.9),
      { key: 'delayTime', label: 'Delay', min: 1, max: 8, step: 0.1, default: 3, unit: 'ms' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.6, unit: '%' },
      mix(0.5)
    ]
  },
  {
    type: 'tremolo', name: 'Tremolo', category: 'Modulation',
    description: 'The volume pulses up and down.',
    params: [rate(5, 20), depth(0.6), mix(1)]
  },
  {
    type: 'vibrato', name: 'Vibrato', category: 'Modulation',
    description: 'The pitch wobbles up and down.',
    params: [rate(5, 20), depth(0.1), mix(1)]
  },
  {
    type: 'autopan', name: 'Auto-pan', category: 'Modulation',
    description: 'The sound moves between left and right.',
    params: [rate(1), depth(1), mix(1)]
  },
  {
    type: 'autofilter', name: 'Auto-filter', category: 'Modulation',
    description: 'A filter that sweeps open and closed.',
    params: [
      rate(1),
      { key: 'baseFrequency', label: 'Base', min: 50, max: 2000, step: 1, default: 200, unit: 'Hz', log: true },
      { key: 'octaves', label: 'Range', min: 1, max: 6, step: 0.5, default: 2.6, unit: 'oct' },
      depth(1),
      mix(1)
    ]
  },
  {
    type: 'autowah', name: 'Auto-wah', category: 'Modulation',
    description: 'A "wah" that follows how loud you play.',
    params: [
      { key: 'baseFrequency', label: 'Base', min: 50, max: 1000, step: 1, default: 100, unit: 'Hz', log: true },
      { key: 'octaves', label: 'Range', min: 1, max: 8, step: 0.5, default: 6, unit: 'oct' },
      { key: 'Q', label: 'Resonance', min: 0.5, max: 10, step: 0.1, default: 2 },
      mix(1)
    ]
  },

  // ---------- Distortion ----------
  {
    type: 'distortion', name: 'Distortion', category: 'Distortion',
    description: 'Gritty, overdriven, like a guitar amp.',
    params: [{ key: 'distortion', label: 'Drive', min: 0, max: 1, step: 0.01, default: 0.4, unit: '%' }, mix(1)]
  },
  {
    type: 'amp', name: 'Guitar amp', category: 'Distortion',
    description: 'An amp and speaker cabinet: from warm crunch to heavy rock guitar.',
    params: [
      { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, default: 0.6, unit: '%' },
      { key: 'bass', label: 'Bass', min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'middle', label: 'Middle', min: -12, max: 12, step: 0.5, default: 2, unit: 'dB' },
      { key: 'treble', label: 'Treble', min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'cabinet', label: 'Cabinet', min: 1500, max: 9000, step: 1, default: 4500, unit: 'Hz', log: true },
      { key: 'level', label: 'Level', min: -30, max: 6, step: 0.5, default: -8, unit: 'dB' }
    ]
  },
  {
    type: 'fuzz', name: 'Fuzz', category: 'Distortion',
    description: 'Clipped to a buzzing square: 60s and stoner rock.',
    params: [
      { key: 'fuzz', label: 'Fuzz', min: 0.5, max: 1, step: 0.01, default: 0.95, unit: '%' },
      { key: 'tone', label: 'Tone', min: 500, max: 8000, step: 1, default: 3000, unit: 'Hz', log: true },
      { key: 'level', label: 'Level', min: -30, max: 6, step: 0.5, default: -10, unit: 'dB' }
    ]
  },
  {
    type: 'bitcrusher', name: 'Bitcrusher', category: 'Distortion',
    description: 'Lo-fi, crunchy, like an old game console or sampler.',
    params: [
      { key: 'bits', label: 'Bits', min: 1, max: 16, step: 1, default: 5 },
      { key: 'downsample', label: 'Sample rate ÷', min: 1, max: 40, step: 1, default: 10 },
      mix(1)
    ]
  },
  {
    type: 'chebyshev', name: 'Waveshaper', category: 'Distortion',
    description: 'Adds harsh, buzzy overtones.',
    params: [{ key: 'order', label: 'Order', min: 1, max: 50, step: 1, default: 20 }, mix(0.5)]
  },

  // ---------- Pitch ----------
  {
    type: 'pitchshift', name: 'Pitch shift', category: 'Pitch',
    description: 'Moves the sound up or down, in semitones.',
    params: [{ key: 'pitch', label: 'Shift', min: -12, max: 12, step: 1, default: 12, unit: 'st' }, mix(1)]
  },
  {
    type: 'freqshift', name: 'Frequency shifter', category: 'Pitch',
    description: 'Strange, metallic, out-of-tune shimmer.',
    params: [{ key: 'frequency', label: 'Shift', min: -500, max: 500, step: 1, default: 40, unit: 'Hz' }, mix(1)]
  },

  // ---------- Filter & EQ ----------
  {
    type: 'lowpass', name: 'Low-pass filter', category: 'Filter & EQ',
    description: 'Cuts the highs: darker, muffled.',
    params: [cutoff(1500), resonance]
  },
  {
    type: 'highpass', name: 'High-pass filter', category: 'Filter & EQ',
    description: 'Cuts the lows: thinner, like a phone.',
    params: [cutoff(300), resonance]
  },
  {
    type: 'bandpass', name: 'Band-pass filter', category: 'Filter & EQ',
    description: 'Keeps only a band in the middle: like a radio.',
    params: [cutoff(1000), resonance]
  },
  {
    type: 'eq', name: 'EQ (3-band)', category: 'Filter & EQ',
    description: 'Turn the lows, mids and highs up or down.',
    params: [
      { key: 'low', label: 'Low', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'mid', label: 'Mid', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'high', label: 'High', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' }
    ]
  },

  // ---------- Dynamics ----------
  {
    type: 'compressor', name: 'Compressor', category: 'Dynamics',
    description: 'Evens out loud and quiet parts.',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, default: -24, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 4 },
      { key: 'attack', label: 'Attack', min: 0.001, max: 0.5, step: 0.001, default: 0.01, unit: 's' },
      { key: 'release', label: 'Release', min: 0.01, max: 1, step: 0.01, default: 0.25, unit: 's' }
    ]
  },
  {
    type: 'gain', name: 'Gain', category: 'Dynamics',
    description: 'Turn the sound up or down at this point in the chain (e.g. after distortion).',
    params: [{ key: 'volume', label: 'Gain', min: -30, max: 12, step: 0.5, default: 0, unit: 'dB' }]
  },
  {
    type: 'limiter', name: 'Limiter', category: 'Dynamics',
    description: 'Never lets the sound get louder than a ceiling.',
    params: [{ key: 'threshold', label: 'Ceiling', min: -30, max: 0, step: 0.5, default: -6, unit: 'dB' }]
  },
  {
    type: 'gate', name: 'Noise gate', category: 'Dynamics',
    description: 'Silences anything quieter than a level (hiss, room noise).',
    params: [{ key: 'threshold', label: 'Threshold', min: -100, max: 0, step: 1, default: -50, unit: 'dB' }]
  },

  // ---------- Stereo ----------
  {
    type: 'widener', name: 'Stereo widener', category: 'Stereo',
    description: 'Makes the sound feel wider (or narrower).',
    params: [{ key: 'width', label: 'Width', min: 0, max: 1, step: 0.01, default: 0.7, unit: '%' }]
  }
] as const satisfies readonly EffectDefinition[];

export type EffectType = (typeof EFFECTS)[number]['type'];

export function effectDefinition(type: EffectType): EffectDefinition {
  return EFFECTS.find((e) => e.type === type)!;
}

// Each setting at its default: the params of a newly added effect.
export function defaultParams(type: EffectType): Record<string, number> {
  return Object.fromEntries(effectDefinition(type).params.map((p) => [p.key, p.default]));
}

// Effects whose name, category or description contains every word of the search.
export function searchEffects(query: string): EffectDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return EFFECTS.filter((e) => {
    const text = `${e.name} ${e.category} ${e.description}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// A value as the effect window shows it: '30%', '250 Hz', '-6 dB', '0.25 s'.
// Also used for instrument settings (anything with a step and a unit).
export function formatParam(p: { step: number; unit?: string }, value: number): string {
  if (p.unit === '%') return `${Math.round(value * 100)}%`;
  const digits = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : p.step >= 0.01 ? 2 : 3;
  return `${value.toFixed(digits)}${p.unit ? ` ${p.unit}` : ''}`;
}
