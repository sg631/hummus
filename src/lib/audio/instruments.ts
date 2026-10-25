// Instrument names (see INSTRUMENTS in music/types.ts) → Tone.js sounds.
//
// Use Tone.PolySynth so a track can play chords (several notes at once):
//   new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' } })
//   new Tone.PolySynth(Tone.FMSynth)        // bell-like
//   new Tone.PolySynth(Tone.AMSynth)
//   new Tone.PolySynth(Tone.MonoSynth, …)   // bass
// Tone.PluckSynth can't go in a PolySynth; use a plain Synth with a short envelope for
// "pluck" instead. Docs: https://tonejs.github.io/docs/
import * as Tone from 'tone';
import type { DrumSound, InstrumentName } from '$lib/music/types';

// TODO(you): return a new PolySynth for each name (a `switch (name)` is simplest).
// Don't connect it to anything here: the mixer connects it to the track's effects.
export function createInstrument(name: InstrumentName): Tone.PolySynth {
  throw new Error(`TODO: createInstrument(${name})`);
}

// One sound per drum row. Suggestions:
//   kick:  new Tone.MembraneSynth()                 → play with .triggerAttackRelease('C1', '8n', time)
//   snare: new Tone.NoiseSynth({ envelope: { decay: 0.15, sustain: 0 } }) → .triggerAttackRelease('16n', time)
//   hihat: new Tone.MetalSynth({ envelope: { decay: 0.05 } })            → .triggerAttackRelease('C6', '32n', time)
// Return a function that plays the sound at a time, so the mixer doesn't care which it is.
export interface Drum {
  output: Tone.ToneAudioNode;     // connect this to the track's effects
  play: (time: number) => void;
  dispose: () => void;
}

// TODO(you): build the drum for this sound.
export function createDrum(sound: DrumSound): Drum {
  throw new Error(`TODO: createDrum(${sound})`);
}
