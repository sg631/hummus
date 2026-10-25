// Playing the whole project. For each track, a chain of audio nodes:
//
//   instrument (or recording, or drums) → input → its effects, in order → channel (volume, pan, mute) → speakers
//
// and its notes scheduled on Tone's transport. Then the transport starts, and everything
// plays in time. Positions are ticks; Tone reads `${ticks}i` as a time in ticks.
//
//   await playProject(project)   // from the start
//   stopProject()
//   applyMix(project)            // volume, pan, mute, effects or instrument settings changed: hear it now
//
// While recording, the recorder calls `scheduleProject(project, offsetTicks)` itself
// (its playAlong option) so you hear the other tracks: that's why scheduling and starting
// are separate functions.
import * as Tone from 'tone';
import { initAudio } from './engine';
import { createEffect, type EffectNode } from './effects';
import { Metronome } from './metronome';
import { applyPreset, createDrum, createInstrument, type Drum, loadPresets, needsNewInstrument, type Instrument } from './instruments';
import { presetById, type InstrumentPreset } from '$lib/music/instruments';
import { scheduleClip, scheduleRecording } from './playback';
import { STEP_TICKS, stepsPerBar, swingOffset } from '$lib/music/drums';
import { expandPlacements, placementAt, placementLength } from '$lib/music/arrange';
import { barTicks } from '$lib/music/time';
import type { DrumTrack, Effect, Project } from '$lib/music/types';

// Everything made for the current playback, so stopProject can clean it up.
let disposables: { dispose(): void }[] = [];

// Each playing track's chain, by track id, so applyMix can change it while it plays.
interface Chain {
  input: Tone.Gain;               // what the instrument connects to; never changes
  channel: Tone.Channel;          // volume, pan and mute, then the speakers
  nodes: Map<string, EffectNode>; // the enabled effects' nodes, by Effect.id
  layout: string;                 // which effects are wired in, in order (see layoutOf)
  synth?: Instrument;             // melody tracks: the instrument playing
  preset?: string;                // ...and the preset it's set to (JSON), to spot changes
}
const chains = new Map<string, Chain>();

// Builds every track's chain and schedules its notes / recordings / drum steps. Muted
// tracks are scheduled too (their channel is muted), so unmuting while playing works.
export function scheduleProject(project: Project, offsetTicks = 0) {
  for (const track of project.tracks) {
    const input = buildChain(track);

    if (track.kind === 'midi') {
      const preset = presetById(project.instruments, track.instrument);
      const synth = createInstrument(preset, track.poly);
      synth.connect(input);
      disposables.push(synth);
      const chain = chains.get(track.id)!;
      chain.synth = synth;
      chain.preset = JSON.stringify({ preset, poly: !!track.poly });
      const swing = { amount: track.swing, unit: track.swingUnit };
      // The playlist: each placement of a clip, looped or cut to its length.
      const placed = expandPlacements(track.clips, track.placements, barTicks(project.timeSignature));
      for (const clip of placed) disposables.push(scheduleClip(clip, synth, offsetTicks, project.detune, swing));
    } else if (track.kind === 'voice') {
      for (const clip of track.clips) {
        const rate = project.bpm / clip.recordedBpm;
        disposables.push(scheduleRecording(clip.audio, clip.sampleRate, rate, 0, input, offsetTicks + clip.start, project.detune, clip.edit));
      }
    } else {
      scheduleDrums(project, track, input, offsetTicks);
    }
  }
  applyMix(project); // solo, which depends on every track
}

// Downloads the recordings of every sampled instrument the project's tracks use (once;
// later calls return straight away). Call before playing or recording.
export async function loadProjectSamples(project: Project) {
  const presets = project.tracks.flatMap((t) => (t.kind === 'midi' ? [presetById(project.instruments, t.instrument)] : []));
  await loadPresets(presets);
}

// A drum track's loop: every sixteenth, play the rows that are on at this step of the bar.
// The step comes from the transport's position and the project's time signature, so the
// loop is always one bar long (12 steps in 3/4…), even if the signature changes while
// playing. It reads the track as it plays, so grid clicks, new rows, row volumes and swing
// are heard straight away.
function scheduleDrums(project: Project, track: DrumTrack, input: Tone.ToneAudioNode, offsetTicks: number) {
  // Each row is an instrument of its own: its sound → its effects → its channel (volume,
  // pan, mute) → the track's chain. Made the first time the row plays (rows can be added
  // while playing); applyMix keeps its settings up to date like a track's.
  const sounds = new Map<string, Drum>();
  function soundFor(row: DrumTrack['rows'][number]) {
    let drum = sounds.get(row.id + row.sound);
    if (!drum) {
      const rowInput = chains.get(row.id)?.input ?? buildChain(row, input);
      drum = createDrum(row.sound);
      drum.output.connect(rowInput);
      sounds.set(row.id + row.sound, drum);
      disposables.push(drum);
    }
    return drum;
  }

  const loop = new Tone.Loop((time) => {
    const ticks = Tone.getTransport().getTicksAtTime(time) - offsetTicks;
    // Which pattern plays now: the placed one here, or (nothing placed) the current one, looping.
    const bar = barTicks(project.timeSignature);
    const patternOf = (id: string) => track.patterns.find((p) => p.id === id);
    let pattern = patternOf(track.current ?? '') ?? track.patterns[0];
    let local = ticks;
    if (track.placements.length) {
      const placement = placementAt(track.placements, ticks, (pl) => placementLength(pl, (patternOf(pl.clipId)?.bars ?? 1) * bar));
      pattern = placement ? patternOf(placement.clipId)! : undefined!;
      local = placement ? ticks - placement.start : 0;
    }
    if (!pattern) return;
    const step = Math.round(local / STEP_TICKS) % (stepsPerBar(project.timeSignature) * pattern.bars);
    const sixteenth = Tone.Time('16n').toSeconds();
    for (const row of track.rows) {
      if (!pattern.steps[row.id]?.[step]) continue;
      // Each sound can swing on its own; otherwise the track's swing.
      const late = swingOffset(step, row.swing ?? track.swing, track.swingUnit) * sixteenth;
      soundFor(row).play(time + late);
    }
  }, '16n');
  loop.start(`${offsetTicks}i`);
  disposables.push(loop);
}

// The metronome while playing (the recorder has its own). Always scheduled; muted when off,
// so the top bar's switch works while playing.
let clicker: Metronome | null = null;

export function setPlaybackMetronome(on: boolean) {
  if (clicker) clicker.enabled = on;
}

// From `from` (ticks; the start by default). Stops whatever was playing first, or it would
// keep playing on top.
// `loop`: play the first `loop` ticks over and over (pattern mode).
export async function playProject(project: Project, { metronome = false, from = 0, loop = 0 } = {}) {
  await initAudio(); // audio can only start after a click: call this from a click handler
  await loadProjectSamples(project);
  stopProject();
  const transport = Tone.getTransport();
  transport.position = 0;
  transport.loop = loop > 0;
  if (loop > 0) {
    transport.loopStart = 0;
    transport.loopEnd = `${loop}i`;
  }
  transport.ticks = loop > 0 ? from % loop : from;
  transport.bpm.value = project.bpm;
  transport.timeSignature = project.timeSignature;
  scheduleProject(project);
  clicker ??= new Metronome();
  clicker.timeSignature = project.timeSignature;
  clicker.enabled = metronome;
  clicker.onBeat = null;
  clicker.schedule();
  transport.start();
}

export function stopProject() {
  const transport = Tone.getTransport();
  transport.stop();
  transport.loop = false;
  transport.cancel();
  clicker?.unschedule();
  for (const d of disposables) d.dispose();
  disposables = [];
  chains.clear();
}

// Copies each track's volume, mute and effects onto its playing chain. Settings change
// in place; adding, removing, reordering or switching an effect on or off rewires it.
export function applyMix(project: Project) {
  // Drum rows have chains like tracks.
  for (const track of project.tracks) if (track.kind === 'drums') for (const row of track.rows) mixOwner(row);
  // Solo: if any track is soloed, the others are silenced (on top of their own mute).
  const soloing = project.tracks.some((t) => t.solo);
  for (const track of project.tracks) {
    const chain = chains.get(track.id);
    if (!chain) continue;
    mixOwner(track, soloing && !track.solo);

    // Instrument settings changed (or another preset of the same engine chosen): apply
    // them now. A different engine or sampled instrument needs a new instrument: that
    // waits for the next Play.
    if (track.kind === 'midi' && chain.synth && chain.preset) {
      const preset = presetById(project.instruments, track.instrument);
      const json = JSON.stringify({ preset, poly: !!track.poly });
      const before = JSON.parse(chain.preset) as { preset: InstrumentPreset; poly: boolean };
      if (json !== chain.preset && before.poly === !!track.poly && !needsNewInstrument(before.preset, preset)) {
        applyPreset(chain.synth, preset);
        chain.preset = json;
      }
    }
  }
  // Tracks (and drum rows) deleted while playing: silence them until Stop cleans up.
  const alive = new Set(project.tracks.flatMap((t) => [t.id, ...(t.kind === 'drums' ? t.rows.map((r) => r.id) : [])]));
  for (const [id, chain] of chains) if (!alive.has(id)) chain.channel.mute = true;
}

// Anything with a chain: a track, or a drum row.
interface ChainOwner {
  id: string;
  volume: number;
  pan: number;
  mute: boolean;
  effects: Effect[];
}

// Volume, pan, mute and effects onto an owner's playing chain. `silenced`: another track
// is soloed.
function mixOwner(owner: ChainOwner, silenced = false) {
  const chain = chains.get(owner.id);
  if (!chain) return;
  chain.channel.volume.value = owner.volume;
  chain.channel.mute = owner.mute || silenced;
  chain.channel.pan.value = owner.pan;
  if (layoutOf(owner) !== chain.layout) wireEffects(chain, owner);
  else for (const effect of owner.effects) chain.nodes.get(effect.id)?.update(effect.params);
}

// The enabled effects' ids, in order: when this changes, the chain needs rewiring.
function layoutOf(track: ChainOwner): string {
  return track.effects
    .filter((e) => e.enabled)
    .map((e) => e.id)
    .join(',');
}

// Connects input → each enabled effect, in order → channel. Keeps the nodes of effects
// that are still there, makes nodes for new ones, and disposes the rest.
function wireEffects(chain: Chain, track: ChainOwner) {
  chain.input.disconnect();
  for (const fx of chain.nodes.values()) fx.node.disconnect();

  const kept = new Map<string, EffectNode>();
  let last: Tone.ToneAudioNode = chain.input;
  for (const effect of track.effects) {
    if (!effect.enabled) continue;
    const fx = chain.nodes.get(effect.id) ?? createEffect(effect);
    fx.update(effect.params);
    last.connect(fx.node);
    last = fx.node;
    kept.set(effect.id, fx);
  }
  last.connect(chain.channel);

  for (const [id, fx] of chain.nodes) if (!kept.has(id)) fx.dispose();
  chain.nodes = kept;
  chain.layout = layoutOf(track);
}

// A chain: input → effects → channel → speakers (or `into`: a drum row goes into its
// track's chain). Returns the input (what the instrument connects to).
function buildChain(track: ChainOwner, into?: Tone.ToneAudioNode): Tone.ToneAudioNode {
  const input = new Tone.Gain();
  const channel = new Tone.Channel({ volume: track.volume, pan: track.pan, mute: track.mute });
  if (into) channel.connect(into);
  else channel.toDestination();
  const chain: Chain = { input, channel, nodes: new Map(), layout: '' };
  wireEffects(chain, track);
  disposables.push(input, channel, { dispose: () => chain.nodes.forEach((fx) => fx.dispose()) });
  chains.set(track.id, chain);
  return input;
}
