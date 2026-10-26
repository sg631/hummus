// Playing a track's instrument live, from the computer keyboard or a MIDI keyboard
// (state/live-keys.svelte.ts decides what to play).
//
// While the song plays, live notes go into the track's own chain (its effects, volume, the
// master), so they sit in the mix. When stopped, the instrument has a small chain of its
// own with the track's effects, volume and pan.
import * as Tone from 'tone';
import { initAudio } from './engine';
import { createEffect, type EffectNode } from './effects';
import { canPlay, createInstrument, previewDrum, type Instrument } from './instruments';
import { chainInput } from './mixer';
import { presetById } from '$lib/music/instruments';
import { midiToHz } from '$lib/music/tuning';
import type { DrumRow, MidiTrack, Project } from '$lib/music/types';

const GLIDE_SEC = 0.08;

interface Live {
  key: string; // what it was built for: rebuilt when the track's sound changes
  trackId: string;
  instrument: Instrument;
  own: { input: Tone.Gain; nodes: EffectNode[]; channel: Tone.Channel };
  routedTo: Tone.InputNode | null;
  monoPitch: number | null; // a sampler playing one note at a time: the note to let go of
}
let live: Live | null = null;

function soundKey(project: Project, track: MidiTrack): string {
  return JSON.stringify([track.id, presetById(project.instruments, track.instrument), !!track.poly, track.effects, track.volume, track.pan]);
}

function build(project: Project, track: MidiTrack): Live {
  live?.instrument.dispose();
  if (live) for (const d of [live.own.input, live.own.channel, ...live.own.nodes.map((n) => n.node)]) d.dispose();
  const instrument = createInstrument(presetById(project.instruments, track.instrument), track.poly);
  const input = new Tone.Gain();
  const channel = new Tone.Channel({ volume: track.volume, pan: track.pan, channelCount: 2 }).toDestination();
  const nodes = track.effects.filter((e) => e.enabled).map((e) => createEffect(e));
  let last: Tone.ToneAudioNode = input;
  for (const n of nodes) {
    last.connect(n.node);
    last = n.node;
  }
  last.connect(channel);
  return { key: soundKey(project, track), trackId: track.id, instrument, own: { input, nodes, channel }, routedTo: null, monoPitch: null };
}

// The instrument for this track, built (or rebuilt) as needed and routed to where it
// should sound now.
function instrumentFor(project: Project, track: MidiTrack): Live {
  if (!live || live.key !== soundKey(project, track)) live = build(project, track);
  const into = chainInput(track.id) ?? live.own.input;
  if (live.routedTo !== into) {
    live.instrument.disconnect();
    live.instrument.connect(into);
    live.routedTo = into;
  }
  return live;
}

const hzOf = (project: Project, pitch: number) => midiToHz(pitch + (project.detune + project.transpose * 100) / 100);
const isMono = (i: Instrument): i is Exclude<Instrument, Tone.Sampler | Tone.PolySynth> => !(i instanceof Tone.Sampler || i instanceof Tone.PolySynth);

export async function liveAttack(project: Project, track: MidiTrack, pitch: number, velocity: number) {
  await initAudio();
  const l = instrumentFor(project, track);
  if (!canPlay(l.instrument)) return; // a sampler still loading its recordings
  const now = Tone.immediate();
  if (isMono(l.instrument)) {
    l.instrument.set({ portamento: 0 });
    l.instrument.triggerAttack(hzOf(project, pitch), now, velocity);
    return;
  }
  // A sampler (or a polyphonic synth) on a one-note track: the last note stops.
  if (!track.poly && l.monoPitch !== null) l.instrument.triggerRelease(hzOf(project, l.monoPitch), now);
  l.instrument.triggerAttack(hzOf(project, pitch), now, velocity);
  if (!track.poly) l.monoPitch = pitch;
}

// One note at a time: slide to `pitch` without a new attack.
export function liveGlide(project: Project, track: MidiTrack, pitch: number, velocity: number) {
  const l = instrumentFor(project, track);
  if (isMono(l.instrument)) {
    l.instrument.set({ portamento: GLIDE_SEC });
    l.instrument.setNote(hzOf(project, pitch), Tone.immediate());
  } else void liveAttack(project, track, pitch, velocity); // samplers can't slide: a new note
}

// Lets go: of `pitch` (polyphonic), or of whatever is playing (one note at a time).
export function liveRelease(project: Project, track: MidiTrack, pitch?: number) {
  if (!live || live.trackId !== track.id) return;
  const now = Tone.immediate();
  if (isMono(live.instrument)) live.instrument.triggerRelease(now);
  else if (pitch !== undefined) live.instrument.triggerRelease(hzOf(project, pitch), now);
  else if (live.monoPitch !== null) live.instrument.triggerRelease(hzOf(project, live.monoPitch), now);
  if (pitch === undefined || pitch === live.monoPitch) live.monoPitch = null;
}

export function liveReleaseAll() {
  if (!live) return;
  if (live.instrument instanceof Tone.PolySynth) live.instrument.releaseAll();
  else if (live.instrument instanceof Tone.Sampler) live.instrument.releaseAll();
  else live.instrument.triggerRelease();
  live.monoPitch = null;
}

// A drum row's sound, now.
export function liveDrum(row: DrumRow) {
  void previewDrum(row.sound);
}
