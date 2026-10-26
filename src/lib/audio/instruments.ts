// Instrument presets (music/instruments.ts) → Tone.js instruments.
//
// The synth engines are Tone's monophonic instruments (one note at a time, like the voice
// it came from): that lets playback bend the pitch along the sung curve (slides, vibrato)
// and slur legato notes without a new attack (audio/playback.ts). A note that starts
// before the last one ends cuts it off. The sampled engine is a Tone.Sampler: real
// recordings, notes as written. Docs: https://tonejs.github.io/docs/
import * as Tone from 'tone';
import { initAudio } from './engine';
import { presetOptions, type EngineType, type InstrumentPreset } from '$lib/music/instruments';
import { sampleSet, sampleUrls } from '$lib/music/samples';
import { midiToHz } from '$lib/music/tuning';
import type { DrumSound, SynthDrum } from '$lib/music/drums';
import { drumSample } from '$lib/music/drum-samples';
import { userSampleBuffer } from '$lib/state/user-samples.svelte';

// A synth: attack, release, change pitch, bend pitch.
export type SynthInstrument = Tone.Synth | Tone.MonoSynth | Tone.FMSynth | Tone.AMSynth | Tone.DuoSynth | Tone.MembraneSynth;
export type Instrument = SynthInstrument | Tone.Sampler | Tone.PolySynth;

// ---------- Samples ----------
// Each sampled instrument's recordings are downloaded once, then kept here for every
// Sampler that plays them (as plain AudioBuffers: a Sampler disposes its own wrappers).
const sampleCache = new Map<string, Promise<Record<string, AudioBuffer>>>();

// Downloads a sampled instrument's recordings (once). Await it before playing, or the
// first notes are silent while they load.
export function loadSamples(id: string): Promise<Record<string, AudioBuffer>> {
  const key = sampleSet(id).id;
  let loading = sampleCache.get(key);
  if (!loading) {
    loading = Promise.all(
      Object.entries(sampleUrls(key)).map(async ([note, url]) => [note, (await Tone.ToneAudioBuffer.fromUrl(url)).get()!] as const)
    ).then((entries) => Object.fromEntries(entries));
    loading.catch(() => sampleCache.delete(key)); // failed (offline?): try again next time
    sampleCache.set(key, loading);
  }
  return loading;
}

// Loads every sampled instrument these presets use.
// Returns the names of any that couldn't load (offline and not saved yet): the rest play.
export async function loadPresets(presets: InstrumentPreset[]): Promise<string[]> {
  const samplers = presets.filter((p) => p.engine === 'sampler');
  const results = await Promise.allSettled(
    samplers.map((p) => {
      const id = String(p.params.sample ?? 'piano');
      return id.startsWith('u:') ? userSampleBuffer(id) : loadSamples(id);
    })
  );
  return samplers.filter((_, i) => results[i].status === 'rejected').map((p) => p.name);
}

function createSampler(preset: InstrumentPreset): Tone.Sampler {
  const id = String(preset.params.sample ?? 'piano');
  const sampler = new Tone.Sampler();
  // One of your sounds: a single recording, played at other pitches from its own note.
  // `ready`: its recordings are in (exporting audio waits for it).
  const ready = (p: Promise<unknown>) => Object.assign(sampler, { ready: p });
  if (id.startsWith('u:')) {
    ready(
      userSampleBuffer(id).then((buffer) => {
        if (buffer && !sampler.disposed) {
          sampler.add(String(preset.params.root ?? 'C4') as Tone.Unit.Note, buffer);
          hasSamples.add(sampler);
        }
      })
    );
    return sampler;
  }
  // Loaded already (loadPresets): the recordings go in straight away. Otherwise as they arrive.
  ready(loadSamples(id).then(
    (buffers) => {
      if (sampler.disposed) return;
      for (const [note, buffer] of Object.entries(buffers)) sampler.add(note as Tone.Unit.Note, buffer);
      if (Object.keys(buffers).length) hasSamples.add(sampler);
    },
    (e) => console.warn(`Could not load the ${id} samples:`, e)
  ));
  return sampler;
}

// Whether going from preset `a` to `b` needs a new instrument (a different engine, or
// different recordings), rather than new settings on the same one.
export function needsNewInstrument(a: InstrumentPreset, b: InstrumentPreset): boolean {
  return a.engine !== b.engine || (a.engine === 'sampler' && a.params.sample !== b.params.sample);
}

// ---------- Synths ----------

function createEngine(preset: InstrumentPreset): Instrument {
  const type: EngineType = preset.engine;
  switch (type) {
    case 'synth': return new Tone.Synth();
    case 'am': return new Tone.AMSynth();
    case 'fm': return new Tone.FMSynth();
    case 'duo': return new Tone.DuoSynth();
    case 'mono': return new Tone.MonoSynth();
    case 'membrane': return new Tone.MembraneSynth();
    case 'sampler': return createSampler(preset);
  }
}

// The voice class for a polyphonic synth (a PolySynth plays several of these at once).
const VOICES = { synth: Tone.Synth, am: Tone.AMSynth, fm: Tone.FMSynth, duo: Tone.DuoSynth, mono: Tone.MonoSynth, membrane: Tone.MembraneSynth };

// Not connected to anything: the mixer connects it to the track's effects. `poly`: notes
// can overlap (chords) — a PolySynth of the engine; samplers always are.
export function createInstrument(preset: InstrumentPreset, poly = false): Instrument {
  const instrument =
    poly && preset.engine !== 'sampler'
      ? new Tone.PolySynth(VOICES[preset.engine] as typeof Tone.Synth, { maxPolyphony: 16 } as never)
      : createEngine(preset);
  applyPreset(instrument, preset);
  return instrument;
}

// Sets a preset's settings on an instrument of the same engine, e.g. while it plays.
export function applyPreset(instrument: Instrument, preset: InstrumentPreset) {
  // The options are built from the engine's settings list, whose keys are Tone's own
  // option names, so they fit this instrument; TypeScript can't check that for a union.
  (instrument.set as (options: object) => void).call(instrument, presetOptions(preset));
}

// ---------- Preview (the instrument window's keyboard) ----------

let preview: { key: string; instrument: Instrument } | null = null;
let lastPreview = 0; // Tone needs each note to start strictly after the last one

// Plays one note of a preset, straight to the speakers (no track effects).
// Whether an instrument can sound now: a sampler needs its recordings (Tone throws without
// them, and calls a sampler whose download failed "loaded": it has none to wait for).
const hasSamples = new WeakSet<Tone.Sampler>();
export function canPlay(instrument: Instrument): boolean {
  return !(instrument instanceof Tone.Sampler) || (instrument.loaded && hasSamples.has(instrument));
}

export async function previewNote(preset: InstrumentPreset, pitch: number) {
  await initAudio();
  await loadPresets([preset]);
  const key = JSON.stringify(preset);
  if (preview?.key !== key) {
    preview?.instrument.dispose();
    preview = { key, instrument: createInstrument(preset).toDestination() };
    // A sampler takes its recordings a moment later (or not at all: offline, not saved).
    await (preview.instrument as { ready?: Promise<unknown> }).ready?.catch(() => {});
  }
  if (!canPlay(preview.instrument)) return;
  lastPreview = Math.max(Tone.now(), lastPreview + 0.01);
  preview.instrument.triggerAttackRelease(midiToHz(pitch), 0.5, lastPreview);
}

// ---------- Drums ----------
// One sound per drum row, all made from Tone.js synths. `play` plays it at a time, so the
// mixer doesn't care which drum it is.
export interface Drum {
  output: Tone.ToneAudioNode; // connect this to the track's effects
  play: (time: number) => void;
  dispose: () => void;
}

// A drum from a synth, optionally through a filter (which becomes its output).
function drum(synth: Tone.ToneAudioNode, play: (time: number) => void, filter?: Tone.Filter): Drum {
  if (filter) synth.connect(filter);
  return {
    output: filter ?? synth,
    play,
    dispose: () => {
      synth.dispose();
      filter?.dispose();
    }
  };
}

function tom(note: string): Drum {
  const synth = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.001, decay: 0.4, sustain: 0 } });
  return drum(synth, (time) => synth.triggerAttackRelease(note, '8n', time));
}

function cymbal(decay: number, frequency: number, volume: number, resonance = 4000): Drum {
  const synth = new Tone.MetalSynth({ envelope: { attack: 0.001, decay, release: 0.05 }, resonance });
  synth.volume.value = volume; // metal is loud
  return drum(synth, (time) => synth.triggerAttackRelease(frequency, decay, time));
}

// Plays a drum sound once, straight to the speakers (the sound browser's ▶).
export async function previewDrum(sound: DrumSound) {
  await initAudio();
  if (sound.startsWith('s:') || sound.startsWith('u:')) await loadDrumSound(sound);
  const d = createDrum(sound);
  d.output.toDestination();
  setTimeout(() => d.play(Tone.now() + 0.02), 0);
  setTimeout(() => d.dispose(), 4000);
}

// ---------- Recorded drums (sample kits, your sounds) ----------
const drumBuffers = new Map<string, Promise<AudioBuffer | null>>();

// A recorded drum sound's audio (downloaded / read once, then kept).
export function loadDrumSound(sound: string): Promise<AudioBuffer | null> {
  let loading = drumBuffers.get(sound);
  if (!loading) {
    if (sound.startsWith('u:')) loading = userSampleBuffer(sound);
    else {
      const sample = drumSample(sound);
      loading = sample ? Tone.ToneAudioBuffer.fromUrl(sample.url).then((b) => b.get() ?? null, () => null) : Promise.resolve(null);
    }
    drumBuffers.set(sound, loading);
    void loading.then((b) => b || drumBuffers.delete(sound)); // failed (offline?): try again next time
  }
  return loading;
}

// A recorded sound as a Drum: each hit is its own one-shot player, so a cymbal rings on
// under the next hit. Silent until its audio has loaded (Play waits for it).
function recordedDrum(sound: string): Drum {
  const output = new Tone.Gain();
  let buffer: AudioBuffer | null = null;
  loadDrumSound(sound).then((b) => (buffer = b));
  return {
    output,
    play: (time) => {
      if (!buffer) return;
      // On the output's own context: when exporting, that's the offline one.
      const hit = new Tone.ToneBufferSource({ url: buffer, context: output.context }).connect(output);
      hit.onended = () => hit.dispose();
      hit.start(time);
    },
    dispose: () => output.dispose()
  };
}

export function createDrum(sound: DrumSound): Drum {
  if (sound.startsWith('s:') || sound.startsWith('u:')) return recordedDrum(sound);
  return synthDrum(sound as SynthDrum);
}

function synthDrum(sound: SynthDrum): Drum {
  switch (sound) {
    case 'kick': {
      const synth = new Tone.MembraneSynth();
      return drum(synth, (time) => synth.triggerAttackRelease('C1', '8n', time));
    }
    case 'kick808': {
      const synth = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 6, envelope: { attack: 0.001, decay: 0.9, sustain: 0 } });
      return drum(synth, (time) => synth.triggerAttackRelease('A0', '2n', time));
    }
    case 'snare': {
      const synth = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } });
      return drum(synth, (time) => synth.triggerAttackRelease('16n', time));
    }
    case 'clap': {
      const synth = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.2, sustain: 0 } });
      return drum(synth, (time) => synth.triggerAttackRelease('16n', time), new Tone.Filter(1200, 'bandpass'));
    }
    case 'rim': {
      const synth = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 } });
      synth.volume.value = -8;
      return drum(synth, (time) => synth.triggerAttackRelease('E5', '32n', time), new Tone.Filter(1000, 'highpass'));
    }
    case 'hihat': return cymbal(0.05, 300, -14);
    case 'openhat': return cymbal(0.4, 300, -16);
    case 'tomlow': return tom('A1');
    case 'tommid': return tom('D2');
    case 'tomhigh': return tom('G2');
    case 'crash': return cymbal(1.5, 250, -18, 3000);
    case 'ride': return cymbal(0.8, 500, -20, 6000);
    case 'cowbell': {
      const synth = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 } });
      synth.volume.value = -10;
      return drum(synth, (time) => synth.triggerAttackRelease(560, '16n', time), new Tone.Filter(800, 'bandpass'));
    }
    case 'shaker': {
      const synth = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.06, sustain: 0 } });
      synth.volume.value = -10;
      return drum(synth, (time) => synth.triggerAttackRelease('32n', time), new Tone.Filter(6000, 'highpass'));
    }
  }
}
