// Instruments as presets: a synth engine (one of Tone.js's instruments) and its settings.
// The built-in instruments (piano, bass…) are presets too, defined below; the ones you
// make are stored in the project (`project.instruments`). Pure data, no sound:
// audio/instruments.ts turns a preset into a Tone.js instrument, and the instrument
// window draws a control per setting from ENGINES.
//
// The synth engines play one note at a time (Tone's "monophonic" instruments), so
// playback can bend their pitch along the sung curve (audio/playback.ts). The sampled
// engine (real recorded instruments, music/samples.ts) plays notes as written: no bends.
//
// Adding an engine: an entry in ENGINES, and a `case` in createEngine (audio/instruments.ts).
import { SAMPLE_SETS } from './samples';

// ---------- Settings ----------

interface ParamBase {
  key: string;      // id in InstrumentPreset.params; also the Tone option path, e.g. 'envelope.attack'
  label: string;
  group: string;    // shown under this heading: 'Sound', 'Envelope', 'Filter'…
  paths?: string[]; // Tone option paths, when not just `key` (e.g. both voices of a Duo synth)
  option?: false;   // not a Tone option (e.g. which recordings a sampler loads)
}

export interface NumberParam extends ParamBase {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;    // 's', 'dB', 'Hz', '%' (0–1 shown as a percentage)…
  log?: boolean;    // slider moves in ratios (frequencies, times), not steps
}

export interface ChoiceParam extends ParamBase {
  kind: 'choice';
  options: readonly string[];
  labels?: Record<string, string>; // shown instead of the option itself
  default: string;
}

export type InstrumentParam = NumberParam | ChoiceParam;

export const WAVEFORMS = ['sine', 'triangle', 'square', 'sawtooth', 'fatsine', 'fattriangle', 'fatsquare', 'fatsawtooth'] as const;

const volume: NumberParam = { kind: 'number', key: 'volume', label: 'Volume', group: 'Sound', min: -30, max: 6, step: 0.5, default: 0, unit: 'dB' };

const wave = (key = 'oscillator.type', label = 'Waveform', def = 'triangle', paths?: string[]): ChoiceParam => ({
  kind: 'choice', key, label, group: 'Sound', options: WAVEFORMS, default: def, paths
});

const num = (key: string, label: string, group: string, min: number, max: number, step: number, def: number, unit?: string, log?: boolean): NumberParam => ({
  kind: 'number', key, label, group, min, max, step, default: def, unit, log
});

// Attack, decay, sustain, release: how a note starts, settles, holds and fades.
function envelope(prefix: string, group: string, def: [number, number, number, number], paths?: (k: string) => string[]): NumberParam[] {
  const p = (name: string) => `${prefix}.${name}`;
  return [
    { ...num(p('attack'), 'Attack', group, 0.001, 2, 0.001, def[0], 's', true), paths: paths?.(p('attack')) },
    { ...num(p('decay'), 'Decay', group, 0.001, 3, 0.001, def[1], 's', true), paths: paths?.(p('decay')) },
    { ...num(p('sustain'), 'Sustain', group, 0, 1, 0.01, def[2], '%'), paths: paths?.(p('sustain')) },
    { ...num(p('release'), 'Release', group, 0.01, 5, 0.01, def[3], 's', true), paths: paths?.(p('release')) }
  ];
}

const glide = num('portamento', 'Glide between notes', 'Sound', 0, 0.3, 0.005, 0, 's');

// ---------- Engines (Tone.js instruments) ----------

export interface Engine {
  type: string;
  name: string;
  description: string;
  bends?: false; // can't follow the sung pitch curve (slides, vibrato) or slur notes
  params: readonly InstrumentParam[];
}

export const ENGINES = [
  {
    type: 'synth', name: 'Basic synth',
    description: 'One oscillator and an envelope. Simple, clean tones.',
    params: [volume, wave(), glide, ...envelope('envelope', 'Envelope', [0.005, 0.1, 0.3, 1])]
  },
  {
    type: 'am', name: 'AM synth',
    description: 'One oscillator pulsing another\'s volume: hollow, organ- and bell-like.',
    params: [
      volume, wave('oscillator.type', 'Waveform', 'sine'), wave('modulation.type', 'Modulator waveform', 'square'),
      num('harmonicity', 'Modulator pitch ratio', 'Sound', 0.25, 8, 0.01, 3), glide,
      ...envelope('envelope', 'Envelope', [0.01, 0.01, 1, 0.5]),
      ...envelope('modulationEnvelope', 'Modulator envelope', [0.5, 0.01, 1, 0.5])
    ]
  },
  {
    type: 'fm', name: 'FM synth',
    description: 'One oscillator bending another\'s pitch: bright, metallic, electric piano, bells.',
    params: [
      volume, wave('oscillator.type', 'Waveform', 'sine'), wave('modulation.type', 'Modulator waveform', 'square'),
      num('harmonicity', 'Modulator pitch ratio', 'Sound', 0.25, 8, 0.01, 3),
      num('modulationIndex', 'Brightness (FM amount)', 'Sound', 0, 40, 0.1, 10), glide,
      ...envelope('envelope', 'Envelope', [0.01, 0.01, 1, 0.5]),
      ...envelope('modulationEnvelope', 'Modulator envelope', [0.5, 0.01, 1, 0.5])
    ]
  },
  {
    type: 'duo', name: 'Duo synth',
    description: 'Two oscillators with vibrato: thick, singing leads.',
    params: [
      volume,
      wave('voice0.oscillator.type', 'Waveform 1', 'sine'),
      wave('voice1.oscillator.type', 'Waveform 2', 'sine'),
      num('harmonicity', 'Voice 2 pitch ratio', 'Sound', 0.25, 4, 0.01, 1.5),
      num('vibratoAmount', 'Vibrato depth', 'Sound', 0, 1, 0.01, 0.5, '%'),
      num('vibratoRate', 'Vibrato rate', 'Sound', 0.5, 12, 0.1, 5, 'Hz'),
      glide,
      ...envelope('envelope', 'Envelope', [0.01, 0.5, 0.5, 0.5], (k) => [`voice0.${k}`, `voice1.${k}`])
    ]
  },
  {
    type: 'mono', name: 'Filter synth',
    description: 'An oscillator through a sweeping filter: basses, classic synth leads.',
    params: [
      volume, wave('oscillator.type', 'Waveform', 'sawtooth'), glide,
      ...envelope('envelope', 'Envelope', [0.005, 0.1, 0.9, 1]),
      { kind: 'choice', key: 'filter.type', label: 'Filter', group: 'Filter', options: ['lowpass', 'highpass', 'bandpass'], default: 'lowpass' },
      num('filter.Q', 'Resonance', 'Filter', 0.1, 20, 0.1, 1),
      num('filterEnvelope.baseFrequency', 'Cutoff', 'Filter', 20, 5000, 1, 200, 'Hz', true),
      num('filterEnvelope.octaves', 'Sweep range', 'Filter', 0, 8, 0.1, 3, 'oct'),
      ...envelope('filterEnvelope', 'Filter envelope', [0.06, 0.2, 0.5, 2])
    ]
  },
  {
    type: 'membrane', name: 'Membrane',
    description: 'The pitch drops as the note starts: toms, boomy basses, kicks.',
    params: [
      volume, wave('oscillator.type', 'Waveform', 'sine'),
      num('pitchDecay', 'Pitch drop time', 'Sound', 0.001, 0.5, 0.001, 0.05, 's', true),
      num('octaves', 'Pitch drop', 'Sound', 0.5, 10, 0.1, 10, 'oct'),
      ...envelope('envelope', 'Envelope', [0.001, 0.4, 0.01, 1.4])
    ]
  },
  {
    type: 'sampler', name: 'Sampled instrument',
    description: 'Recordings of a real instrument. Plays the notes as written: sung slides and vibrato are not followed.',
    bends: false,
    params: [
      volume,
      {
        kind: 'choice', key: 'sample', label: 'Instrument', group: 'Sound', option: false,
        options: SAMPLE_SETS.map((s) => s.id),
        labels: Object.fromEntries(SAMPLE_SETS.map((s) => [s.id, s.name])),
        default: 'piano'
      },
      {
        kind: 'choice', key: 'root', label: 'Note it plays at (your sounds)', group: 'Sound', option: false,
        options: ['C2', 'C3', 'A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'C6'], default: 'C4'
      },
      num('attack', 'Fade in', 'Envelope', 0, 1, 0.005, 0, 's'),
      num('release', 'Fade out', 'Envelope', 0.01, 5, 0.01, 1, 's', true)
    ]
  }
] as const satisfies readonly Engine[];

export type EngineType = (typeof ENGINES)[number]['type'];

export function engine(type: EngineType): Engine {
  return ENGINES.find((e) => e.type === type) ?? ENGINES[0];
}

// ---------- Presets ----------

export interface InstrumentPreset {
  id: string;
  name: string;
  engine: EngineType;
  params: Record<string, number | string>; // by InstrumentParam.key; missing → the engine's default
}

// Built in, can't be changed (duplicate one to make your own). Their ids are what tracks
// saved before presets existed have as `instrument`, so those still load.
export const BUILT_IN_PRESETS: readonly InstrumentPreset[] = [
  {
    id: 'piano', name: 'Piano', engine: 'synth',
    params: { 'oscillator.type': 'triangle', 'envelope.attack': 0.005, 'envelope.decay': 0.4, 'envelope.sustain': 0.3, 'envelope.release': 0.8 }
  },
  {
    id: 'synth', name: 'Synth', engine: 'synth',
    params: { 'oscillator.type': 'sawtooth', 'envelope.attack': 0.02, 'envelope.decay': 0.1, 'envelope.sustain': 0.6, 'envelope.release': 0.3 }
  },
  {
    id: 'bass', name: 'Bass', engine: 'mono',
    params: {
      'oscillator.type': 'square', 'envelope.attack': 0.01, 'envelope.decay': 0.2, 'envelope.sustain': 0.5, 'envelope.release': 0.2,
      'filter.Q': 1, 'filterEnvelope.attack': 0.01, 'filterEnvelope.decay': 0.2, 'filterEnvelope.sustain': 0.3,
      'filterEnvelope.baseFrequency': 100, 'filterEnvelope.octaves': 2.5
    }
  },
  {
    id: 'pluck', name: 'Pluck', engine: 'synth',
    params: { 'oscillator.type': 'triangle', 'envelope.attack': 0.001, 'envelope.decay': 0.25, 'envelope.sustain': 0, 'envelope.release': 0.2 }
  },
  {
    id: 'bell', name: 'Bell', engine: 'fm',
    params: { harmonicity: 3.01, modulationIndex: 14, 'envelope.attack': 0.001, 'envelope.decay': 1.2, 'envelope.sustain': 0, 'envelope.release': 1.2 }
  },
  {
    id: 'organ', name: 'Organ', engine: 'am',
    params: { 'oscillator.type': 'sine', 'envelope.attack': 0.02, 'envelope.decay': 0.001, 'envelope.sustain': 1, 'envelope.release': 0.1 }
  },
  {
    id: 'lead', name: 'Soft lead', engine: 'duo',
    params: { volume: -6, 'voice0.oscillator.type': 'sawtooth', 'voice1.oscillator.type': 'triangle', vibratoAmount: 0.15, portamento: 0.02 }
  },
  {
    id: 'tom', name: 'Tom', engine: 'membrane',
    params: { pitchDecay: 0.03, octaves: 3, 'envelope.decay': 0.5, 'envelope.sustain': 0, 'envelope.release': 0.5 }
  },
  // One per sampled instrument (music/samples.ts): 'sample-violin'…
  ...SAMPLE_SETS.map((set): InstrumentPreset => ({ id: `sample-${set.id}`, name: set.name, engine: 'sampler', params: { sample: set.id } }))
];

export const DEFAULT_PRESET_ID = 'piano';

export function isSampled(preset: InstrumentPreset): boolean {
  return preset.engine === 'sampler';
}

export function isBuiltIn(id: string): boolean {
  return BUILT_IN_PRESETS.some((p) => p.id === id);
}

// The preset with this id: yours, then built in, then the piano.
export function presetById(custom: readonly InstrumentPreset[], id: string): InstrumentPreset {
  return custom.find((p) => p.id === id) ?? BUILT_IN_PRESETS.find((p) => p.id === id) ?? BUILT_IN_PRESETS[0];
}

// A setting's value in a preset, or the engine's default.
export function paramValue(preset: InstrumentPreset, param: InstrumentParam): number | string {
  return preset.params[param.key] ?? param.default;
}

// The preset as Tone.js options: { volume: -6, envelope: { attack: 0.01 }, … }.
export function presetOptions(preset: InstrumentPreset): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const param of engine(preset.engine).params) {
    if (param.option === false) continue;
    for (const path of param.paths ?? [param.key]) setPath(options, path, paramValue(preset, param));
  }
  return options;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let obj = target;
  for (const key of keys.slice(0, -1)) obj = (obj[key] ??= {}) as Record<string, unknown>;
  obj[keys[keys.length - 1]] = value;
}
