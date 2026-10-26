// Automation: settings that change over the song (a volume fade, a filter sweep…).
// Pure data and math, no sound: audio/mixer.ts reads the lanes while the song plays, and
// the playlist draws and edits them.
//
//   valueAt(lane.points, tick)        // the value at a moment of the song
//   targetInfo(project, lane.target)  // its name, range and how to show a value
//   allTargets(project)               // everything that can be automated (the picker)
import { drumSample } from './drum-samples';
import { drumName } from './drums';
import { effectDefinition } from './effects';
import { engine, presetById } from './instruments';
import { PPQ, beatTicks, type TimeSignature } from './time';
import type { AutomationLane, AutomationPoint, AutomationTarget, Effect, Project } from './types';

// How far from point `a`'s value to the next point's (0 … 1) at `t` (0 … 1 across the
// segment), for a's shape. A wave returns where it is between the two values.
export function shapeAt(a: AutomationPoint, t: number): number {
  switch (a.shape) {
    case 'hold':
      return t >= 1 ? 1 : 0;
    case 'smooth':
      return t * t * (3 - 2 * t);
    case 'curve': {
      const k = Math.max(-1, Math.min(1, a.tension ?? 0));
      return k >= 0 ? t ** (1 + 3 * k) : 1 - (1 - t) ** (1 - 3 * k);
    }
    case 'wave': {
      const phase = (t * Math.max(0.5, a.cycles ?? 4)) % 1;
      switch (a.wave ?? 'sine') {
        case 'triangle':
          return phase < 0.5 ? phase * 2 : 2 - phase * 2;
        case 'square':
          return phase < 0.5 ? 0 : 1;
        case 'saw':
          return phase;
        default:
          return (1 - Math.cos(2 * Math.PI * phase)) / 2;
      }
    }
    default:
      return t;
  }
}

// The value at `tick`: along each segment's shape (a straight line unless the point says
// otherwise; `stepped`: every segment holds, like the time signature); before the first
// point the first's value, after the last the last's. Undefined with no points.
export function valueAt(points: AutomationPoint[], tick: number, stepped = false): number | undefined {
  if (!points.length) return undefined;
  if (tick <= points[0].tick) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (tick < b.tick || (!stepped && tick === b.tick)) {
      const a = points[i - 1];
      if (stepped) return a.value;
      const t = b.tick === a.tick ? 1 : (tick - a.tick) / (b.tick - a.tick);
      return a.value + (b.value - a.value) * shapeAt(a, t);
    }
  }
  return points[points.length - 1].value;
}

// A short text key for a target ('mix:<id>:volume'), to compare and look up targets.
export function targetKey(t: AutomationTarget): string {
  if (t.kind === 'song') return `song:${t.param}`;
  if (t.kind === 'instrument') return `inst:${t.ownerId}:${t.param}`;
  if (t.kind === 'send') return `send:${t.ownerId}:${t.param}`;
  return t.kind === 'mix' ? `mix:${t.ownerId}:${t.param}` : `fx:${t.ownerId}:${t.effectId}:${t.param}`;
}

export const TEMPO: AutomationTarget = { kind: 'song', ownerId: 'song', param: 'bpm' };
export const BEATS: AutomationTarget = { kind: 'song', ownerId: 'song', param: 'beats' };
export const KEY_SHIFT: AutomationTarget = { kind: 'song', ownerId: 'song', param: 'transpose' };
export const TUNING: AutomationTarget = { kind: 'song', ownerId: 'song', param: 'detune' };

const onOff = (v: number) => (v >= 0.5 ? 'on' : 'off');
const toggle = (owner: string, label: string, value: boolean): TargetInfo => ({ owner, label, min: 0, max: 1, step: 1, default: 0, stepped: true, value: value ? 1 : 0, format: onOff });

// Settings too slow to change while playing (a reverb rebuilds its room each time).
const SLOW = new Set(['reverb:decay', 'reverb:preDelay']);

export interface TargetInfo {
  owner: string; // 'Bass', 'Drums: Kick', 'Master'
  label: string; // 'Volume', 'Reverb: Mix'
  min: number;
  max: number;
  step: number;
  default: number;
  log?: boolean; // drawn on a ratio scale (frequencies)
  stepped?: boolean; // jumps from point to point (the time signature), no slopes
  value: number; // its knob's own value (used when the lane is off, and when stopped)
  format: (v: number) => string;
}

export const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
export const formatPan = (v: number) => (Math.abs(v) < 0.025 ? 'C' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`);

// Something with volume, pan and effects: a track, a drum row, or the master.
interface Owner {
  name: string;
  volume: number;
  pan: number;
  swing?: number;
  mute?: boolean;
  solo?: boolean;
  effects: Effect[];
}

// The owner with this id: 'master', a track, or a drum row.
export function ownerOf(project: Project, id: string): Owner | undefined {
  if (id === 'master') return { name: 'Master', volume: project.masterVolume, pan: 0, effects: project.masterEffects };
  const bus = (project.buses ?? []).find((b) => b.id === id);
  if (bus) return bus;
  for (const t of project.tracks) {
    if (t.id === id) return t;
    if (t.kind === 'drums') {
      const row = t.rows.find((r) => r.id === id);
      if (row) return { name: `${t.name}: ${drumName(row.sound, (id) => drumSample(id)?.name)}`, volume: row.volume, pan: row.pan, swing: row.swing ?? t.swing, mute: row.mute, effects: row.effects };
    }
  }
}

// What a target is, or undefined if it's gone (its track or effect was deleted).
export function targetInfo(project: Project, t: AutomationTarget | undefined): TargetInfo | undefined {
  if (!t) return;
  if (t.kind === 'song' && t.param === 'transpose') {
    return { owner: 'Song', label: 'Key shift', min: -12, max: 12, step: 1, default: 0, stepped: true, value: project.transpose, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st` };
  }
  if (t.kind === 'song' && t.param === 'detune') {
    return { owner: 'Song', label: 'Tuning', min: -100, max: 100, step: 1, default: 0, value: project.detune, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} ct` };
  }
  if (t.kind === 'send') {
    const track = project.tracks.find((x) => x.id === t.ownerId);
    const bus = (project.buses ?? []).find((b) => b.id === t.param);
    if (!track || !bus) return;
    const level = track.sends?.find((s) => s.busId === bus.id)?.level ?? -60;
    return { owner: track.name, label: `Send to ${bus.name}`, min: -60, max: 6, step: 0.5, default: -60, value: level, format: (v) => (v <= -60 ? 'off' : formatDb(v)) };
  }
  if (t.kind === 'instrument') {
    const preset = presetById(project.instruments, t.ownerId);
    const p = engine(preset.engine).params.find((q) => q.key === t.param);
    if (!p || p.kind !== 'number') return;
    const v = Number(preset.params[p.key] ?? p.default);
    return { owner: preset.name, label: p.label, min: p.min, max: p.max, step: p.step, default: p.default, log: p.log, value: v, format: (x) => `${x.toFixed(p.step >= 1 ? 0 : 2)}${p.unit ? ` ${p.unit}` : ''}` };
  }
  if (t.kind === 'song') {
    return t.param === 'bpm'
      ? { owner: 'Song', label: 'Tempo', min: 40, max: 240, step: 1, default: 100, value: project.bpm, format: (v) => `${Math.round(v)} BPM` }
      : {
          owner: 'Song',
          label: 'Time signature (beats per bar)',
          min: 1,
          max: 16,
          step: 1,
          default: 4,
          stepped: true,
          value: project.timeSignature[0],
          format: (v) => `${Math.round(v)}/${project.timeSignature[1]}`
        };
  }
  const owner = ownerOf(project, t.ownerId);
  if (!owner) return;
  if (t.kind === 'mix') {
    if (t.param === 'volume') return { owner: owner.name, label: 'Volume', min: -60, max: 6, step: 0.1, default: 0, value: owner.volume, format: formatDb };
    if (t.param === 'pan') return { owner: owner.name, label: 'Pan', min: -1, max: 1, step: 0.01, default: 0, value: owner.pan, format: formatPan };
    if (t.param === 'swing') return { owner: owner.name, label: 'Swing', min: 0.5, max: 0.75, step: 0.01, default: 0.5, value: owner.swing ?? 0.5, format: (v) => (v <= 0.5 ? 'off' : `${Math.round(v * 100)}%`) };
    if (t.param === 'mute') return toggle(owner.name, 'Mute', !!owner.mute);
    if (owner.solo === undefined) return; // drum rows have no solo
    return toggle(owner.name, 'Solo', owner.solo);
  }
  const effect = owner.effects.find((e) => e.id === t.effectId);
  if (!effect) return;
  if (t.param === 'enabled') return toggle(owner.name, `${effectDefinition(effect.type).name}: on`, effect.enabled);
  const def = effectDefinition(effect.type);
  const p = def.params.find((q) => q.key === t.param);
  if (!p) return;
  const format = (v: number) =>
    p.unit === '%' ? `${Math.round(v * 100)}%` : `${v.toFixed(p.step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(p.step))))}${p.unit ? ` ${p.unit}` : ''}`;
  return { owner: owner.name, label: `${def.name}: ${p.label}`, min: p.min, max: p.max, step: p.step, default: p.default, log: p.log, value: effect.params[p.key] ?? p.default, format };
}

// Everything that can be automated, grouped by owner: volume, pan and each effect setting
// of every track, drum row and the master.
export function allTargets(project: Project): { group: string; target: AutomationTarget; label: string }[] {
  const out: { group: string; target: AutomationTarget; label: string }[] = [];
  const add = (ownerId: string, owner: Owner, pan = true) => {
    out.push({ group: owner.name, target: { kind: 'mix', ownerId, param: 'volume' }, label: 'Volume' });
    if (pan) out.push({ group: owner.name, target: { kind: 'mix', ownerId, param: 'pan' }, label: 'Pan' });
    for (const e of owner.effects) {
      const def = effectDefinition(e.type);
      for (const p of def.params) {
        if (SLOW.has(`${e.type}:${p.key}`)) continue;
        out.push({ group: owner.name, target: { kind: 'effect', ownerId, effectId: e.id, param: p.key }, label: `${def.name}: ${p.label}` });
      }
    }
  };
  for (const t of project.tracks) {
    add(t.id, t);
    if (t.kind === 'drums') for (const r of t.rows) add(r.id, ownerOf(project, r.id)!);
  }
  for (const b of project.buses ?? []) add(b.id, b);
  add('master', ownerOf(project, 'master')!, false);
  out.push(
    { group: 'Song', target: TEMPO, label: 'Tempo' },
    { group: 'Song', target: BEATS, label: 'Time signature (beats per bar)' },
    { group: 'Song', target: KEY_SHIFT, label: 'Key shift' },
    { group: 'Song', target: TUNING, label: 'Tuning' }
  );
  return out;
}

// Whether a setting can be automated (not one too slow to change while playing).
export function canAutomate(effectType: string, param: string): boolean {
  return !SLOW.has(`${effectType}:${param}`);
}

// Where a value sits in its range, 0 (min) to 1 (max), and back: frequencies by ratio.
export function toUnit(info: TargetInfo, v: number): number {
  const u = info.log ? Math.log(v / info.min) / Math.log(info.max / info.min) : (v - info.min) / (info.max - info.min);
  return Math.max(0, Math.min(1, u));
}
export function fromUnit(info: TargetInfo, u: number): number {
  const c = Math.max(0, Math.min(1, u));
  const v = info.log ? info.min * (info.max / info.min) ** c : info.min + c * (info.max - info.min);
  return Math.round(v / info.step) * info.step;
}

// Adds a point, keeping them sorted; a point already at that tick is replaced.
export function addPoint(points: AutomationPoint[], point: AutomationPoint): AutomationPoint[] {
  return [...points.filter((p) => p.tick !== point.tick), point].sort((a, b) => a.tick - b.tick);
}

// The lane automating a target, if it's on and has points.
export function laneFor(project: Project, target: AutomationTarget): AutomationLane | undefined {
  const key = targetKey(target);
  return project.automation.find((l) => l.enabled && l.points.length && l.target && targetKey(l.target) === key);
}

// ---------- Tempo and time signature over the song ----------

// The bar `tick` is in, when the beats per bar change over the song (`beatsLane`: the time
// signature lane's points, or none). A change takes effect at the first bar line at or
// after its point. `bar` counts from 0 at the song's start; `barStart` is where it begins.
export function meterAt(
  beatsLane: AutomationPoint[] | undefined,
  timeSignature: TimeSignature,
  tick: number
): { beats: number; barLength: number; barStart: number; bar: number } {
  const beat = beatTicks(timeSignature);
  const points = beatsLane ?? [];
  let beats = Math.round(points[0]?.value ?? timeSignature[0]);
  let segStart = 0;
  let barsBefore = 0;
  for (const p of points.slice(1)) {
    const length = beats * beat;
    const changeAt = segStart + Math.ceil((p.tick - segStart) / length) * length;
    if (tick < changeAt) break;
    barsBefore += Math.round((changeAt - segStart) / length);
    segStart = changeAt;
    beats = Math.round(p.value);
  }
  const barLength = beats * beat;
  const n = Math.floor((tick - segStart) / barLength);
  return { beats, barLength, barStart: segStart + n * barLength, bar: barsBefore + n };
}

// Seconds between two ticks, following the tempo lane if there is one.
export function secondsBetween(project: Project, from: number, to: number): number {
  const lane = laneFor(project, TEMPO);
  if (!lane) return ((to - from) / PPQ) * (60 / project.bpm);
  const STEP = 60; // ticks
  let sec = 0;
  for (let t = from; t < to; t += STEP) sec += (Math.min(STEP, to - t) / PPQ) * (60 / (valueAt(lane.points, t + STEP / 2) ?? project.bpm));
  return sec;
}

// The lanes as if the song began at `from` (recording from the playhead).
export function shiftAutomation(lanes: AutomationLane[], from: number): AutomationLane[] {
  if (from <= 0) return lanes;
  return lanes.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p, tick: p.tick - from })) }));
}

// The lanes that play: on, with points, and pointing at something that still exists.
export function activeLanes(project: Project): (AutomationLane & { target: AutomationTarget })[] {
  return project.automation.filter((l): l is AutomationLane & { target: AutomationTarget } => l.enabled && l.points.length > 0 && !!targetInfo(project, l.target));
}
