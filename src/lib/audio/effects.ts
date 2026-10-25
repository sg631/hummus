// A track's effect (music/types.ts `Effect`) → a Tone.js node that makes the sound.
// The list of effects and their settings is in music/effects.ts; this file only builds
// them and keeps their settings in step while they play.
import * as Tone from 'tone';
import type { EffectType } from '$lib/music/effects';
import type { Effect } from '$lib/music/types';

export interface EffectNode {
  node: Tone.ToneAudioNode;
  update(params: Record<string, number>): void; // apply changed settings now, while playing
  dispose(): void;
}

// ---------- Bitcrusher ----------
// Tone's BitCrusher only lowers the bit depth, which is hard to hear at normal levels.
// This one also lowers the sample rate (holds each sample for `downsample` samples): the
// gritty, aliased lo-fi sound people expect. It runs in an AudioWorklet (audio thread).
const CRUSHER_CODE = `
class HumCrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 6, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 8, minValue: 1, maxValue: 64, automationRate: 'k-rate' }
    ];
  }
  constructor() { super(); this.held = [0, 0]; this.count = [0, 0]; }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    const step = Math.pow(0.5, params.bits[0] - 1);
    const every = Math.max(1, Math.round(params.downsample[0]));
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0], out = output[ch];
      if (!inp) { out.fill(0); continue; }
      for (let i = 0; i < out.length; i++) {
        // Mid-rise levels (never 0): at 1 bit a sound becomes a buzzy square wave instead of
        // rounding to silence. True silence stays silent.
        if (this.count[ch] % every === 0) {
          const x = inp[i];
          this.held[ch] = Math.abs(x) < 1e-4 ? 0 : (Math.floor(x / step) + 0.5) * step;
        }
        this.count[ch]++;
        out[i] = this.held[ch];
      }
    }
    return true;
  }
}
registerProcessor('hum-crusher', HumCrusher);
`;
const crusherLoaded = new WeakMap<object, Promise<void>>();

function loadCrusher(context: Tone.BaseContext): Promise<void> {
  let loading = crusherLoaded.get(context);
  if (!loading) {
    const url = URL.createObjectURL(new Blob([CRUSHER_CODE], { type: 'text/javascript' }));
    loading = context.addAudioWorkletModule(url);
    crusherLoaded.set(context, loading);
  }
  return loading;
}

// Dry and crushed sound mixed by a crossfade (Mix). Until the worklet has loaded (a
// moment, the first time), the "crushed" side is the clean sound.
class Crusher extends Tone.ToneAudioNode {
  readonly name = 'Crusher';
  readonly input = new Tone.Gain({ context: this.context });
  readonly output = new Tone.CrossFade({ context: this.context, fade: 1 });
  private node: AudioWorkletNode | null = null;
  private values: Record<string, number> = { bits: 6, downsample: 8 };

  constructor() {
    super();
    this.input.connect(this.output.a); // dry
    this.input.connect(this.output.b); // crushed, once the worklet is ready
    loadCrusher(this.context).then(
      () => {
        if (this.disposed) return;
        const node = this.context.createAudioWorkletNode('hum-crusher', { outputChannelCount: [2] });
        this.input.disconnect(this.output.b);
        Tone.connect(this.input, node);
        Tone.connect(node, this.output.b);
        this.node = node;
        this.apply();
      },
      (e) => console.warn('Bitcrusher could not start:', e)
    );
  }

  setParam(key: string, value: number) {
    if (key === 'mix') this.output.fade.value = value;
    else this.values[key] = value;
    this.apply();
  }

  private apply() {
    if (!this.node) return;
    this.node.parameters.get('bits')!.value = this.values.bits;
    this.node.parameters.get('downsample')!.value = this.values.downsample;
  }

  dispose() {
    super.dispose();
    this.input.dispose();
    this.output.dispose();
    this.node?.disconnect();
    return this;
  }
}

// ---------- Racks: effects made of several Tone nodes in a row ----------
// `settings` maps a setting key to what changing it does.
class Rack extends Tone.ToneAudioNode {
  readonly name = 'Rack';
  readonly input: Tone.ToneAudioNode;
  readonly output: Tone.ToneAudioNode;

  constructor(
    private nodes: Tone.ToneAudioNode[],
    private settings: Record<string, (value: number) => void>
  ) {
    super();
    this.input = nodes[0];
    this.output = nodes[nodes.length - 1];
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  }

  setParam(key: string, value: number) {
    this.settings[key]?.(value);
  }

  dispose() {
    super.dispose();
    for (const n of this.nodes) n.dispose();
    return this;
  }
}

// A guitar amp: drive → 3-band tone → speaker cabinet (a steep low-pass) → level.
function amp(): Rack {
  const drive = new Tone.Distortion({ distortion: 0.6, oversample: '4x' });
  const eq = new Tone.EQ3({ lowFrequency: 250, highFrequency: 2500 });
  const cabinet = new Tone.Filter({ type: 'lowpass', frequency: 4500, rolloff: -24, Q: 0.7 });
  const level = new Tone.Volume(-8);
  return new Rack([drive, eq, cabinet, level], {
    drive: (v) => (drive.distortion = v),
    bass: (v) => (eq.low.value = v),
    middle: (v) => (eq.mid.value = v),
    treble: (v) => (eq.high.value = v),
    cabinet: (v) => (cabinet.frequency.value = v),
    level: (v) => (level.volume.value = v)
  });
}

// Fuzz: clipped very hard, then a tone control.
function fuzz(): Rack {
  const clip = new Tone.Distortion({ distortion: 0.95, oversample: '2x' });
  const tone = new Tone.Filter({ type: 'lowpass', frequency: 3000, rolloff: -12 });
  const level = new Tone.Volume(-10);
  return new Rack([clip, tone, level], {
    fuzz: (v) => (clip.distortion = v),
    tone: (v) => (tone.frequency.value = v),
    level: (v) => (level.volume.value = v)
  });
}

// A new Tone node for each effect type, with its default settings (update() sets ours).
function create(type: EffectType): Tone.ToneAudioNode {
  switch (type) {
    case 'reverb': return new Tone.Reverb();
    case 'delay': return new Tone.FeedbackDelay();
    case 'pingpong': return new Tone.PingPongDelay();
    case 'chorus': return new Tone.Chorus().start(); // the wobbling ones run on an LFO: start it
    case 'phaser': return new Tone.Phaser();
    case 'tremolo': return new Tone.Tremolo().start();
    case 'vibrato': return new Tone.Vibrato();
    case 'autopan': return new Tone.AutoPanner().start();
    case 'autofilter': return new Tone.AutoFilter().start();
    case 'autowah': return new Tone.AutoWah();
    case 'distortion': return new Tone.Distortion({ oversample: '4x' });
    case 'amp': return amp();
    case 'fuzz': return fuzz();
    case 'flanger': return new Tone.Chorus({ frequency: 0.3, delayTime: 3, depth: 0.9, feedback: 0.6 }).start();
    case 'gain': return new Tone.Volume(0);
    case 'bitcrusher': return new Crusher();
    case 'chebyshev': return new Tone.Chebyshev();
    case 'pitchshift': return new Tone.PitchShift();
    case 'freqshift': return new Tone.FrequencyShifter();
    case 'lowpass': return new Tone.Filter({ type: 'lowpass' });
    case 'highpass': return new Tone.Filter({ type: 'highpass' });
    case 'bandpass': return new Tone.Filter({ type: 'bandpass' });
    case 'eq': return new Tone.EQ3();
    case 'compressor': return new Tone.Compressor();
    case 'limiter': return new Tone.Limiter();
    case 'gate': return new Tone.Gate();
    case 'widener': return new Tone.StereoWidener();
  }
}

// Sets one setting on a Tone node. The setting keys in music/effects.ts are named after
// the node's own properties ('mix' is Tone's `wet`). Some properties are signals (set
// their `.value`, which can change smoothly while playing), others plain numbers.
function setParam(node: Tone.ToneAudioNode, key: string, value: number) {
  if (node instanceof Rack || node instanceof Crusher) return node.setParam(key, value);
  const target = node as unknown as Record<string, unknown>;
  const prop = target[key === 'mix' ? 'wet' : key];
  if (prop instanceof Tone.Param || prop instanceof Tone.Signal) prop.value = value;
  else target[key] = value;
}

export function createEffect(effect: Effect): EffectNode {
  const node = create(effect.type);
  const applied: Record<string, number> = {};

  function update(params: Record<string, number>) {
    for (const [key, value] of Object.entries(params)) {
      // Only what changed: some settings are slow to apply (a reverb rebuilds its room).
      if (applied[key] === value) continue;
      setParam(node, key, value);
      applied[key] = value;
    }
  }

  update(effect.params);
  return { node, update, dispose: () => node.dispose() };
}
