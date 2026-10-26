// Playing the whole project. For each track, a chain of audio nodes:
//
//   instrument (or recording, or drums) → input → its effects, in order → channel (volume, pan, mute)
//     → its bus (if it's routed into one) → master: its effects → master volume → speakers
//   and each send: channel → send level → that bus
//
// Each channel can feed a meter (how loud it is now: `level(id)`, made when the mixer asks), and
// automation lanes (music/automation.ts) move volumes, pans and effect settings as it plays.
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
import { sync } from './sync';
import { initAudio } from './engine';
import { createEffect, Ducker, type EffectNode } from './effects';
import { Metronome } from './metronome';
import { applyPreset, createDrum, createInstrument, loadDrumSound, type Drum, loadPresets, needsNewInstrument, type Instrument } from './instruments';
import { presetById, type InstrumentPreset } from '$lib/music/instruments';
import { scheduleClip, scheduleRecording } from './playback';
import { STEP_TICKS, stepsPerBar, swingOffset } from '$lib/music/drums';
import { expandPlacements, placementAt, placementLength } from '$lib/music/arrange';
import { barTicks } from '$lib/music/time';
import { BEATS, KEY_SHIFT, TEMPO, TUNING, activeLanes, laneFor, meterAt, targetInfo, targetKey, valueAt } from '$lib/music/automation';
import type { AutomationLane, AutomationTarget, DrumTrack, Effect, Project } from '$lib/music/types';

// Everything made for the current playback, so stopProject can clean it up.
let disposables: { dispose(): void }[] = [];

// Each playing track's chain, by track id, so applyMix can change it while it plays.
interface Chain {
  input: Tone.Gain;               // what the instrument connects to; never changes
  channel: Tone.Channel;          // volume, pan and mute, then the master (or its track)
  meter?: Tone.Meter;             // how loud the channel is now: made when the mixer first asks (`level`)
  nodes: Map<string, EffectNode>; // the enabled effects' nodes, by Effect.id
  layout: string;                 // which effects are wired in, in order (see layoutOf)
  synth?: Instrument;             // melody tracks: the instrument playing
  presetId?: string;              // ...its preset's id (instrument automation finds it by this)
  output?: string;                // where the channel plays into: a bus id, or '' (the master)
  sends?: Map<string, Tone.Gain>; // its sends' levels, by bus id
  analyser?: Tone.Analyser;       // made when a spectrum display asks (`spectrum`)
  preset?: string;                // ...and the preset it's set to (JSON), to spot changes
}
const chains = new Map<string, Chain>();

// Builds every track's chain and schedules its notes / recordings / drum steps. Muted
// tracks are scheduled too (their channel is muted), so unmuting while playing works.
export function scheduleProject(project: Project, offsetTicks = 0) {
  // Where automation starts: chains are built at those values, not the knobs'.
  automated = automationAt(project, Tone.getTransport().ticks - offsetTicks);
  // The master: every track goes through its effects, then out (master volume).
  const master = buildChain({ id: MASTER, volume: 0, pan: 0, mute: false, effects: project.masterEffects }, Tone.getDestination());
  // Buses (shared effects, groups): into the master.
  for (const bus of project.buses ?? []) buildChain(bus, master);
  for (const track of project.tracks) {
    const busInput = track.output ? chains.get(track.output)?.input : undefined;
    const input = buildChain(track, busInput ?? master, true);
    chains.get(track.id)!.output = busInput ? track.output : '';

    if (track.kind === 'midi') {
      const preset = livePreset(project, track.instrument);
      const synth = createInstrument(preset, track.poly);
      synth.connect(input);
      disposables.push(synth);
      const chain = chains.get(track.id)!;
      chain.synth = synth;
      chain.presetId = track.instrument;
      chain.preset = JSON.stringify({ preset, poly: !!track.poly });
      // Read as each note plays, so key shift, tuning and swing lanes are heard.
      // Read from the lanes at each note's own tick (not the loop's last value: a note and a
      // lane change on the same beat could otherwise go either way).
      const swing = (tick: number) => ({ amount: laneValue(project, { kind: 'mix', ownerId: track.id, param: 'swing' }, tick) ?? track.swing, unit: track.swingUnit });
      const shift = (tick: number) => songShift(project, tick); // tuning + key shift, in cents
      // The playlist: each placement of a clip, looped or cut to its length.
      const placed = expandPlacements(track.clips, track.placements, barTicks(project.timeSignature));
      for (const clip of placed) disposables.push(scheduleClip(clip, synth, offsetTicks, shift, swing));
    } else if (track.kind === 'voice') {
      // With a tempo lane, recordings stretch along with it (followTempo); with a key shift or
      // tuning lane, their pitch follows it (followPitch).
      const followsTempo = !!laneFor(project, TEMPO);
      const followsPitch = !!(laneFor(project, KEY_SHIFT) || laneFor(project, TUNING));
      for (const clip of track.clips) {
        if (clip.muted) continue;
        const rate = (automated.get('song:bpm') ?? project.bpm) / clip.recordedBpm;
        const rec = scheduleRecording(clip.audio, clip.sampleRate, rate, 0, input, offsetTicks + clip.start, songShift(project, clip.start), clip.edit, followsTempo ? { recordedBpm: clip.recordedBpm } : undefined, followsPitch);
        if (rec.setTempo) tempoFollowers.push(rec.setTempo);
        if (rec.setShift) shiftFollowers.push(rec.setShift);
        disposables.push(rec);
      }
    } else {
      scheduleDrums(project, track, input, offsetTicks);
    }
  }
  applyMix(project); // solo, which depends on every track (and wires sidechains)
  scheduleAutomation(project, offsetTicks);
}

// Sidechains: each sidechain effect listens to its source's input (another track or drum
// row, before its volume and mute). Run after chains change (applyMix calls it).
function wireSidechains(project: Project) {
  const owners = [
    { id: MASTER, effects: project.masterEffects },
    ...(project.buses ?? []),
    ...project.tracks.flatMap((t) => [t, ...(t.kind === 'drums' ? t.rows : [])])
  ];
  for (const owner of owners) {
    for (const effect of owner.effects) {
      if (effect.type !== 'sidechain') continue;
      const node = chains.get(owner.id)?.nodes.get(effect.id)?.node;
      if (node instanceof Ducker) node.connectSource((effect.source && effect.source !== owner.id && chains.get(effect.source)?.input) || null);
    }
  }
}

// ---------- Automation ----------
// While playing, every 32nd note: each lane's value at this moment, onto its setting (a
// short ramp to it, so it moves smoothly). The lanes are read as it plays, so new points
// are heard straight away. The knobs' own values come back on Stop (or when a lane goes).
const MASTER = 'master';
let tempoFollowers: ((bpm: number) => void)[] = []; // recordings stretching with a tempo lane
let shiftFollowers: ((cents: number) => void)[] = []; // recordings following key shift / tuning lanes
let automated = new Map<string, number>(); // targetKey → the value automation set last

// A lane's value at a tick of the song (undefined: no lane playing for it).
function laneValue(project: Project, target: AutomationTarget, tick: number): number | undefined {
  const lane = laneFor(project, target);
  if (!lane) return;
  const info = targetInfo(project, target);
  const v = valueAt(lane.points, tick, info?.stepped);
  return v === undefined || !info ? v : Math.round(v / info.step) * info.step;
}

// The song's pitch shift at a tick (cents): tuning + key shift, following their lanes.
function songShift(project: Project, tick: number): number {
  return (laneValue(project, TUNING, tick) ?? project.detune) + (laneValue(project, KEY_SHIFT, tick) ?? project.transpose) * 100;
}

// An instrument preset with the settings its lanes are moving.
function livePreset(project: Project, presetId: string): InstrumentPreset {
  const preset = presetById(project.instruments, presetId);
  const prefix = `inst:${presetId}:`;
  let params: InstrumentPreset['params'] | null = null;
  for (const [key, value] of automated) {
    if (!key.startsWith(prefix)) continue;
    params ??= { ...preset.params };
    params[key.slice(prefix.length)] = value;
  }
  return params ? { ...preset, params } : preset;
}

// Toggles (mute, solo, an effect on / off) and instrument settings: the mix is redone when
// their lane's value changes.
const TOGGLE = /:(mute|solo|enabled)$/;
// Whether a toggle is on: its lane's value if it has one, else its own.
const isOn = (key: string, own: boolean) => (automated.has(key) ? automated.get(key)! >= 0.5 : own);

// Every playing lane's value at `ticks`, by targetKey (`lanes`: the active ones, if known).
function automationAt(project: Project, ticks: number, lanes = activeLanes(project)): Map<string, number> {
  const values = new Map<string, number>();
  for (const lane of lanes) {
    const info = targetInfo(project, lane.target)!;
    values.set(targetKey(lane.target), Math.round(valueAt(lane.points, ticks, info.stepped)! / info.step) * info.step);
  }
  return values;
}

// The project and offset the automation loop is playing (applyLane reads them).
let projectNow: Project | null = null;
let offsetNow = 0;

function scheduleAutomation(project: Project, offsetTicks: number) {
  projectNow = project;
  offsetNow = offsetTicks;
  // Captured now: while exporting, Tone's "current" context is the live one again by the
  // time these run.
  const transport = Tone.getTransport();
  const destination = Tone.getDestination();
  const step = 60 / project.bpm / 8;
  const master = automated.get(`mix:${MASTER}:volume`);
  if (master !== undefined) destination.volume.value = master;
  const tempo = automated.get('song:bpm');
  if (tempo !== undefined) transport.bpm.value = tempo;
  const loop = new Tone.Loop((time) => {
    const ticks = transport.getTicksAtTime(time) - offsetTicks;
    const lanes = activeLanes(project);
    const now = automationAt(project, ticks, lanes);
    for (const lane of lanes) applyLane(lane, now.get(targetKey(lane.target))!, time, step, destination, transport);
    const lanesChanged = automated.size !== now.size || [...automated.keys()].some((k) => !now.has(k));
    const toggled = [...now].some(([k, v]) => TOGGLE.test(k) && automated.get(k) !== v);
    const presets = new Set([...now].filter(([k, v]) => k.startsWith('inst:') && automated.get(k) !== v).map(([k]) => k.split(':')[1]));
    automated = now;
    // Instrument settings: onto every playing instrument using that preset.
    for (const chain of chains.values()) {
      if (!chain.synth || !chain.presetId || !presets.has(chain.presetId)) continue;
      const preset = livePreset(project, chain.presetId);
      applyPreset(chain.synth, preset);
      chain.preset = JSON.stringify({ preset, poly: (JSON.parse(chain.preset ?? '{}') as { poly?: boolean }).poly ?? false });
    }
    if (toggled && !lanesChanged) applyMix(project);
    if (lanesChanged) {
      applyMix(project); // a lane went: its knob's value again
      if (!now.has(`mix:${MASTER}:volume`)) destination.volume.value = masterVolume;
      if (!now.has('song:bpm')) transport.bpm.value = project.bpm;
    }
  }, '32n');
  loop.start(`${offsetTicks}i`);
  disposables.push(loop);
}

function applyLane(
  lane: AutomationLane & { target: AutomationTarget },
  value: number,
  time: number,
  ramp: number,
  destination: Tone.ToneAudioNode & { volume: Tone.Param<'decibels'> },
  transport: ReturnType<typeof Tone.getTransport>
) {
  const t = lane.target;
  if (t.kind === 'song') {
    // The tempo: Tone's transport follows it (notes stay on their ticks). The time
    // signature is read by the drums and the metronome as they play (meterAt); key shift
    // and tuning by each note as it plays (songShift).
    if (t.param === 'bpm') {
      transport.bpm.linearRampTo(value, ramp, time);
      for (const follow of tempoFollowers) follow(value); // recordings keep up
    }
    // Recordings can't be re-pitched per note: they follow the key shift / tuning now.
    if ((t.param === 'transpose' || t.param === 'detune') && shiftFollowers.length) {
      const cents = songShift(projectNow!, transport.getTicksAtTime(time) - offsetNow);
      for (const follow of shiftFollowers) follow(cents);
    }
    return;
  }
  // Read where they're used (swing), or applied by the loop when they change (toggles,
  // instrument settings).
  if (t.kind === 'instrument' || (t.kind === 'mix' && (t.param === 'swing' || t.param === 'mute' || t.param === 'solo')) || (t.kind === 'effect' && t.param === 'enabled')) return;
  if (t.kind === 'mix' && t.ownerId === MASTER) {
    destination.volume.linearRampTo(value, ramp, time);
    return;
  }
  const chain = chains.get(t.ownerId);
  if (!chain) return; // a drum row that hasn't played yet
  if (t.kind === 'send') {
    chain.sends?.get(t.param)?.gain.linearRampTo(value <= -60 ? 0 : Tone.dbToGain(value), ramp, time);
    return;
  }
  if (t.kind === 'mix') chain.channel[t.param as 'volume' | 'pan'].linearRampTo(value, ramp, time);
  else chain.nodes.get(t.effectId)?.update({ [t.param]: value });
}

// The frequencies in a track, drum row, bus or the master ('master') right now: dB per band
// (an FFT, low to high), for the spectrum displays; null when it isn't playing. The analyser
// is made the first time it's asked for.
let masterAnalyser: Tone.Analyser | null = null;
export function spectrum(id: string): Float32Array | null {
  if (id === MASTER) {
    if (!masterAnalyser) {
      masterAnalyser = new Tone.Analyser({ type: 'fft', size: 512, smoothing: 0.7 });
      Tone.getDestination().connect(masterAnalyser);
    }
    return masterAnalyser.getValue() as Float32Array;
  }
  const chain = chains.get(id);
  if (!chain) return null;
  if (!chain.analyser) {
    chain.analyser = new Tone.Analyser({ type: 'fft', size: 512, smoothing: 0.7 });
    chain.channel.connect(chain.analyser);
    disposables.push(chain.analyser);
  }
  return chain.analyser.getValue() as Float32Array;
}

// How loud a track, drum row or the master ('master') is right now, in dB (-Infinity:
// silent or not playing). The mixer view reads it every frame.
let masterMeter: Tone.Meter | null = null;
export function level(id: string): number {
  if (id === MASTER) {
    if (!masterMeter) {
      masterMeter = new Tone.Meter({ smoothing: 0.8 });
      Tone.getDestination().connect(masterMeter);
    }
    return masterMeter.getValue() as number;
  }
  const chain = chains.get(id);
  if (!chain) return -Infinity;
  if (!chain.meter) {
    // Made the first time something shows it: no meters running while the mixer is closed.
    chain.meter = new Tone.Meter({ smoothing: 0.8 });
    chain.channel.connect(chain.meter);
    disposables.push(chain.meter);
  }
  return chain.meter.getValue() as number;
}

// Downloads the recordings of every sampled instrument the project's tracks use (once;
// later calls return straight away). Call before playing or recording.
// Returns what couldn't load (offline, and not saved for offline use yet): everything else
// still plays.
export async function loadProjectSamples(project: Project): Promise<string[]> {
  const presets = project.tracks.flatMap((t) => (t.kind === 'midi' ? [presetById(project.instruments, t.instrument)] : []));
  const drums = project.tracks.flatMap((t) => (t.kind === 'drums' ? t.rows.map((r) => r.sound).filter((s) => s.startsWith('s:') || s.startsWith('u:')) : []));
  const [failed, ...hits] = await Promise.all([loadPresets(presets), ...drums.map((d) => loadDrumSound(d))]);
  const missingDrums = drums.filter((_, i) => !hits[i]).length;
  return [...(failed as string[]), ...(missingDrums ? [`${missingDrums} drum sound${missingDrums > 1 ? 's' : ''}`] : [])];
}

// The last Play's missing sounds (see loadProjectSamples), for the transport bar to mention.
export let missingSounds: string[] = [];

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

  // Every row's sound is made now, on this context (exporting renders offline, where nodes
  // made later would land on the wrong one); rows added while playing are made when they play.
  for (const row of track.rows) soundFor(row);
  const transport = Tone.getTransport();
  const sixteenth = 60 / project.bpm / 4;
  const loop = new Tone.Loop((time) => {
    const ticks = transport.getTicksAtTime(time) - offsetTicks;
    // Which pattern plays now: the placed one here, or (nothing placed) the current one, looping.
    const bar = barTicks(project.timeSignature);
    const patternOf = (id: string) => track.patterns.find((p) => p.id === id);
    let pattern = patternOf(track.current ?? '') ?? track.patterns[0];
    let placement: DrumTrack['placements'][number] | undefined;
    if (track.placements.length) {
      placement = placementAt(track.placements, ticks, (pl) => placementLength(pl, (patternOf(pl.clipId)?.bars ?? 1) * bar));
      if (placement?.muted) return;
      pattern = placement ? patternOf(placement.clipId)! : undefined!;
    }
    if (!pattern) return;
    const perBar = stepsPerBar(project.timeSignature);
    let step: number;
    const beatsLane = laneFor(project, BEATS);
    if (beatsLane) {
      // The time signature changes over the song: each bar plays as many of its pattern
      // bar's steps as the bar has room for.
      const m = meterAt(beatsLane.points, project.timeSignature, ticks);
      const inBar = Math.round((ticks - m.barStart) / STEP_TICKS);
      if (inBar >= perBar || inBar >= Math.round(m.barLength / STEP_TICKS)) return;
      const first = placement ? meterAt(beatsLane.points, project.timeSignature, placement.start).bar : 0;
      step = (((m.bar - first) % pattern.bars) + pattern.bars) % pattern.bars * perBar + inBar;
    } else {
      const local = placement ? ticks - placement.start + (placement.offset ?? 0) : ticks;
      step = Math.round(local / STEP_TICKS) % (perBar * pattern.bars);
    }
    for (const row of track.rows) {
      if (!pattern.steps[row.id]?.[step]) continue;
      // Each sound can swing on its own; otherwise the track's swing.
      const swing =
        laneValue(project, { kind: 'mix', ownerId: row.id, param: 'swing' }, ticks) ?? row.swing ?? laneValue(project, { kind: 'mix', ownerId: track.id, param: 'swing' }, ticks) ?? track.swing;
      const late = swingOffset(step, swing, track.swingUnit) * sixteenth;
      soundFor(row).play(time + late);
    }
  }, `${STEP_TICKS}i`);
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
// `region`: play from its start to its end over and over (Song mode's loop); starts at
// `from` if that's inside it.
export async function playProject(
  project: Project,
  { metronome = false, from = 0, loop = 0, region }: { metronome?: boolean; from?: number; loop?: number; region?: { start: number; end: number } } = {}
) {
  await initAudio(); // audio can only start after a click: call this from a click handler
  missingSounds = await loadProjectSamples(project);
  stopProject();
  const transport = Tone.getTransport();
  transport.position = 0;
  transport.loop = loop > 0;
  if (loop > 0) {
    transport.loopStart = 0;
    transport.loopEnd = `${loop}i`;
  }
  transport.ticks = loop > 0 ? from % loop : from;
  if (region && region.end > region.start) {
    transport.loop = true;
    transport.loopStart = `${region.start}i`;
    transport.loopEnd = `${region.end}i`;
    if (from < region.start || from >= region.end) transport.ticks = region.start;
  }
  transport.bpm.value = project.bpm;
  transport.timeSignature = project.timeSignature;
  scheduleProject(project);
  clicker ??= new Metronome();
  clicker.timeSignature = project.timeSignature;
  // A time signature lane: the accent falls on each bar's first beat as the bars change.
  const beatsLane = loop > 0 ? undefined : laneFor(project, BEATS);
  clicker.accentAt = beatsLane ? (tick) => Math.abs(meterAt(beatsLane.points, project.timeSignature, tick).barStart - tick) < 2 : null;
  clicker.enabled = metronome;
  clicker.onBeat = null;
  clicker.schedule();
  // On the guide's beat if its backing track is playing (audio/sync.ts), else now.
  transport.start(sync.startAt?.(0, transport.ticks));
}

// Song mode's loop switched on or off (or moved) while playing.
export function setPlaybackLoop(region: { start: number; end: number } | null) {
  const transport = Tone.getTransport();
  if (region && region.end > region.start) {
    transport.loopStart = `${region.start}i`;
    transport.loopEnd = `${region.end}i`;
    transport.loop = true;
  } else transport.loop = false;
}

// Waits until every effect that loads in the background is ready (a reverb builds its
// room, the bitcrusher loads its worklet): exporting does, before rendering.
export async function effectsReady() {
  const waits: Promise<unknown>[] = [];
  for (const chain of chains.values()) {
    const synthReady = (chain.synth as unknown as { ready?: Promise<unknown> } | undefined)?.ready;
    if (synthReady) waits.push(synthReady);
    for (const fx of chain.nodes.values()) {
      const ready = (fx.node as unknown as { ready?: Promise<unknown> }).ready;
      if (ready) waits.push(ready);
    }
  }
  await Promise.all(waits);
}

// Lets go of everything an export made (on its offline context), like Stop does.
export function releaseExport() {
  for (const d of disposables) d.dispose();
  disposables = [];
  chains.clear();
  tempoFollowers = [];
  shiftFollowers = [];
  automated = new Map();
}

// The chain a track plays through while the song plays (live keyboard notes join it there),
// or undefined when stopped.
export function chainInput(trackId: string): Tone.ToneAudioNode | undefined {
  return chains.get(trackId)?.input;
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
  tempoFollowers = [];
  shiftFollowers = [];
  if (automated.has(`mix:${MASTER}:volume`)) Tone.getDestination().volume.value = masterVolume;
  automated = new Map();
}

// The master volume (everything, after every track): applied straight away, playing or not
// (unless automation is moving it).
let masterVolume = 0;
export function setMasterVolume(db: number) {
  masterVolume = db;
  if (!automated.has(`mix:${MASTER}:volume`)) Tone.getDestination().volume.value = db;
}

// Copies each track's volume, mute and effects onto its playing chain. Settings change
// in place; adding, removing, reordering or switching an effect on or off rewires it.
export function applyMix(project: Project) {
  // Drum rows, buses and the master have chains like tracks.
  for (const track of project.tracks) if (track.kind === 'drums') for (const row of track.rows) mixOwner(row);
  for (const bus of project.buses ?? []) mixOwner(bus);
  mixOwner({ id: MASTER, volume: 0, pan: 0, mute: false, effects: project.masterEffects });
  // Solo: if any track is soloed, the others are silenced (on top of their own mute).
  const soloed = (t: { id: string; solo?: boolean }) => isOn(`mix:${t.id}:solo`, !!t.solo);
  const soloing = project.tracks.some(soloed);
  for (const track of project.tracks) {
    const chain = chains.get(track.id);
    if (!chain) continue;
    mixOwner(track, soloing && !soloed(track));
    routeTrack(track, chain);

    // Instrument settings changed (or another preset of the same engine chosen): apply
    // them now. A different engine or sampled instrument needs a new instrument: that
    // waits for the next Play.
    if (track.kind === 'midi' && chain.synth && chain.preset) {
      const preset = livePreset(project, track.instrument);
      const json = JSON.stringify({ preset, poly: !!track.poly });
      const before = JSON.parse(chain.preset) as { preset: InstrumentPreset; poly: boolean };
      if (json !== chain.preset && before.poly === !!track.poly && !needsNewInstrument(before.preset, preset)) {
        applyPreset(chain.synth, preset);
        chain.preset = json;
      }
    }
  }
  // Tracks (and drum rows) deleted while playing: silence them until Stop cleans up.
  const alive = new Set([...project.tracks.flatMap((t) => [t.id, ...(t.kind === 'drums' ? t.rows.map((r) => r.id) : [])]), ...(project.buses ?? []).map((b) => b.id)]);
  for (const [id, chain] of chains) if (!alive.has(id) && id !== MASTER) chain.channel.mute = true;
  wireSidechains(project);
}

// A track's output (the master or a bus) and its sends, onto its playing chain: changing
// either while playing is heard straight away.
function routeTrack(track: { id: string; output?: string; sends?: { busId: string; level: number }[] }, chain: Chain) {
  const want = track.output && chains.has(track.output) ? track.output : '';
  if (chain.output !== undefined && want !== chain.output) {
    // Disconnecting the channel drops everything it feeds: connect them all again.
    chain.channel.disconnect();
    chain.channel.connect(want ? chains.get(want)!.input : chains.get(MASTER)!.input);
    if (chain.meter) chain.channel.connect(chain.meter);
    if (chain.analyser) chain.channel.connect(chain.analyser);
    for (const gain of chain.sends?.values() ?? []) chain.channel.connect(gain);
    chain.output = want;
  }
  chain.sends ??= new Map();
  const wanted = new Map((track.sends ?? []).filter((s) => chains.has(s.busId)).map((s) => [s.busId, s.level]));
  for (const [busId, gain] of chain.sends) {
    if (wanted.has(busId)) continue;
    gain.dispose();
    chain.sends.delete(busId);
  }
  for (const [busId, level] of wanted) {
    let gain = chain.sends.get(busId);
    if (!gain) {
      gain = new Tone.Gain(0);
      chain.channel.connect(gain);
      gain.connect(chains.get(busId)!.input);
      chain.sends.set(busId, gain);
      disposables.push(gain);
    }
    if (!automated.has(`send:${track.id}:${busId}`)) gain.gain.value = level <= -60 ? 0 : Tone.dbToGain(level);
  }
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
// is soloed. Settings automation is moving keep automation's value.
function mixOwner(owner: ChainOwner, silenced = false) {
  const chain = chains.get(owner.id);
  if (!chain) return;
  if (!automated.has(`mix:${owner.id}:volume`)) chain.channel.volume.value = owner.volume;
  if (!automated.has(`mix:${owner.id}:pan`)) chain.channel.pan.value = owner.pan;
  chain.channel.mute = isOn(`mix:${owner.id}:mute`, owner.mute) || silenced;
  if (layoutOf(owner) !== chain.layout) wireEffects(chain, owner);
  else for (const effect of owner.effects) chain.nodes.get(effect.id)?.update(withAutomation(owner.id, effect));
}

// An effect's settings, with the ones automation is moving at automation's values.
function withAutomation(ownerId: string, effect: Effect): Record<string, number> {
  const params = { ...effect.params };
  for (const key of Object.keys(params)) {
    const live = automated.get(`fx:${ownerId}:${effect.id}:${key}`);
    if (live !== undefined) params[key] = live;
  }
  return params;
}

// The enabled effects' ids, in order: when this changes, the chain needs rewiring.
function layoutOf(track: ChainOwner): string {
  return track.effects
    .filter((e) => isOn(`fx:${track.id}:${e.id}:enabled`, e.enabled))
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
    if (!isOn(`fx:${track.id}:${effect.id}:enabled`, effect.enabled)) continue;
    const fx = chain.nodes.get(effect.id) ?? createEffect(effect);
    fx.update(withAutomation(track.id, effect));
    last.connect(fx.node);
    last = fx.node;
    kept.set(effect.id, fx);
  }
  last.connect(chain.channel);

  for (const [id, fx] of chain.nodes) if (!kept.has(id)) fx.dispose();
  chain.nodes = kept;
  chain.layout = layoutOf(track);
}

// A chain: input → effects → channel → `into` (a track's goes into the master, a drum
// row's into its track's chain, the master's out). Returns the input (what the instrument
// connects to).
// Tracks pan with a −3 dB centre (the usual pan law): a mono sound in the middle is as loud
// as it was when channels were mono, and stereo sounds stay stereo. Drum rows (inside their
// track) and the master don't add it again.
const PAN_LAW = Math.SQRT1_2;

function buildChain(track: ChainOwner, into: Tone.InputNode, panLaw = false): Tone.ToneAudioNode {
  const input = new Tone.Gain(panLaw ? PAN_LAW : 1);
  const channel = new Tone.Channel({
    volume: automated.get(`mix:${track.id}:volume`) ?? track.volume,
    pan: automated.get(`mix:${track.id}:pan`) ?? track.pan,
    mute: track.mute,
    channelCount: 2 // keeps stereo effects stereo (Tone's default, 1, folds them to mono before panning)
  });
  channel.connect(into);
  const chain: Chain = { input, channel, nodes: new Map(), layout: '' };
  wireEffects(chain, track);
  disposables.push(input, channel, { dispose: () => chain.nodes.forEach((fx) => fx.dispose()) });
  chains.set(track.id, chain);
  return input;
}
