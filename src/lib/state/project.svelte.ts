// The song being made, and what's selected. Every component imports these two objects
// and reads them directly; changing them (e.g. `project.bpm = 120`) updates the screen
// everywhere, because they're $state.
//
// Keep the functions that change the project here, so components stay simple:
// a button calls `addMidiTrack()`, it doesn't build tracks itself.
import { defaultParams, type EffectType } from '$lib/music/effects';
import { DEFAULT_PRESET_ID, isBuiltIn, presetById, type InstrumentPreset } from '$lib/music/instruments';
import { DEFAULT_KIT, drumName, type DrumSound } from '$lib/music/drums';
import {
  type DrumPattern,
  type DrumRow,
  type DrumTrack,
  type Placement,
  type Effect,
  type MidiTrack,
  type NoteClip,
  type Project,
  type Track,
  type VoiceClip,
  type VoiceTrack
} from '$lib/music/types';

export const project = $state<Project>({
  name: 'Untitled',
  bpm: 100,
  timeSignature: [4, 4],
  key: 'C',
  scale: 'major',
  detune: 0,
  transpose: 0,
  masterVolume: 0,
  instruments: [],
  tracks: []
});

export const selection = $state({
  trackId: null as string | null, // the track the piano roll / drum grid shows, and recording goes to
  noteIds: [] as string[]         // the notes selected in the piano roll
});

// The selected track, or undefined.
export function selectedTrack(): Track | undefined {
  return project.tracks.find((t) => t.id === selection.trackId);
}

// ---------- Tracks ----------

// What every new track starts with.
function base(name: string) {
  return { id: crypto.randomUUID(), name, volume: 0, pan: 0, mute: false, solo: false, swing: 0.5, swingUnit: 8 as const, effects: [] as Effect[] };
}

// Adds a track and selects it. Returns the track as stored in the project (the $state
// version), so changes to it show on screen.
function add<T extends Track>(track: T): T {
  project.tracks.push(track);
  selection.trackId = track.id;
  return project.tracks[project.tracks.length - 1] as T;
}

// A new melody track starts with an empty clip, placed at bar 1.
export function addMidiTrack(name = 'Melody'): MidiTrack {
  const clip: NoteClip = { id: crypto.randomUUID(), name: `${name} 1`, start: 0, duration: 0, notes: [] };
  return add<MidiTrack>({
    ...base(name), kind: 'midi', instrument: DEFAULT_PRESET_ID, clips: [clip],
    placements: [{ id: crypto.randomUUID(), clipId: clip.id, start: 0 }], current: clip.id
  });
}

export function addVoiceTrack(name = 'Voice'): VoiceTrack {
  return add<VoiceTrack>({ ...base(name), kind: 'voice', clips: [] });
}

// A new drum track: the default kit and one empty one-bar pattern, looping (not placed).
export function addDrumTrack(name = 'Drums'): DrumTrack {
  const pattern = newPattern('Pattern 1');
  return add<DrumTrack>({ ...base(name), kind: 'drums', rows: DEFAULT_KIT.map(drumRow), patterns: [pattern], placements: [], current: pattern.id });
}

function drumRow(sound: DrumSound): DrumRow {
  return { id: crypto.randomUUID(), sound, volume: 0, pan: 0, mute: false, effects: [] };
}

function newPattern(name: string, bars = 1): DrumPattern {
  return { id: crypto.randomUUID(), name, bars, steps: {} };
}

export function addDrumRow(track: DrumTrack, sound: DrumSound) {
  track.rows.push(drumRow(sound));
}

export function removeDrumRow(track: DrumTrack, rowId: string) {
  track.rows = track.rows.filter((r) => r.id !== rowId);
  for (const p of track.patterns) delete p.steps[rowId];
}

// ---------- Clips, patterns and the playlist ----------
// A melody track's clips and a drum track's patterns are its "content": stored once, played
// wherever the playlist places them (music/arrange.ts). These work on either kind.

type Arranged = MidiTrack | DrumTrack;
type Content = NoteClip | DrumPattern;

function contents(track: Arranged): Content[] {
  return track.kind === 'midi' ? track.clips : track.patterns;
}

// The clip (or pattern) being edited: the current one, else the first; made if there's none.
export function currentClip(track: MidiTrack): NoteClip {
  let clip = track.clips.find((c) => c.id === track.current) ?? track.clips[0];
  if (!clip) {
    track.clips.push({ id: crypto.randomUUID(), name: `${track.name} 1`, start: 0, duration: 0, notes: [] });
    clip = track.clips[track.clips.length - 1];
  }
  if (track.current !== clip.id) track.current = clip.id;
  return clip;
}

export function currentPattern(track: DrumTrack): DrumPattern {
  let pattern = track.patterns.find((p) => p.id === track.current) ?? track.patterns[0];
  if (!pattern) {
    track.patterns.push(newPattern('Pattern 1'));
    pattern = track.patterns[track.patterns.length - 1];
  }
  if (track.current !== pattern.id) track.current = pattern.id;
  return pattern;
}

function contentName(track: Arranged, prefix: string) {
  const names = new Set(contents(track).map((c) => c.name));
  for (let i = 1; ; i++) if (!names.has(`${prefix} ${i}`)) return `${prefix} ${i}`;
}

// A new empty clip / pattern, made current. Not placed: place it in the playlist.
export function newContent(track: Arranged): Content {
  if (track.kind === 'midi') {
    track.clips.push({ id: crypto.randomUUID(), name: contentName(track, track.name), start: 0, duration: 0, notes: [] });
    track.current = track.clips[track.clips.length - 1].id;
    return track.clips[track.clips.length - 1];
  }
  track.patterns.push(newPattern(contentName(track, 'Pattern'), currentPattern(track).bars));
  track.current = track.patterns[track.patterns.length - 1].id;
  return track.patterns[track.patterns.length - 1];
}

// A copy of a clip / pattern (new ids), made current: "make unique".
export function cloneContent(track: Arranged, id: string): Content | undefined {
  const original = contents(track).find((c) => c.id === id);
  if (!original) return;
  const copy = $state.snapshot(original) as Content;
  copy.id = crypto.randomUUID();
  copy.name = `${original.name ?? 'Clip'} copy`;
  if ('notes' in copy) {
    for (const n of copy.notes) n.id = crypto.randomUUID();
    copy.source = undefined; // re-quantizing a copy from the take would need its own ids
    (track as MidiTrack).clips.push(copy);
  } else (track as DrumTrack).patterns.push(copy);
  track.current = copy.id;
  return contents(track).find((c) => c.id === copy.id);
}

// Deletes a clip / pattern and every placement of it (keeps at least one).
export function deleteContent(track: Arranged, id: string) {
  if (contents(track).length <= 1) return;
  if (track.kind === 'midi') track.clips = track.clips.filter((c) => c.id !== id);
  else track.patterns = track.patterns.filter((c) => c.id !== id);
  track.placements = track.placements.filter((p) => p.clipId !== id);
  if (track.current === id) track.current = contents(track)[0]?.id;
}

export function addPlacement(track: Arranged, clipId: string, start: number, length?: number): Placement {
  track.placements.push({ id: crypto.randomUUID(), clipId, start: Math.max(0, Math.round(start)), length });
  return track.placements[track.placements.length - 1];
}

export function removePlacement(track: Arranged, placementId: string) {
  track.placements = track.placements.filter((p) => p.id !== placementId);
}

// One placement gets its own copy of the clip, so editing it changes only that place.
export function makeUnique(track: Arranged, placementId: string) {
  const placement = track.placements.find((p) => p.id === placementId);
  if (!placement) return;
  const copy = cloneContent(track, placement.clipId);
  if (copy) placement.clipId = copy.id;
}

// A copy of a track, right after it: same instrument, settings, effects and notes (voice
// recordings are shared, not copied: they're never changed in place). Selected.
export function duplicateTrack(id: string): Track | undefined {
  const index = project.tracks.findIndex((t) => t.id === id);
  if (index < 0) return;
  const original = project.tracks[index];
  const copy = $state.snapshot(original) as Track;
  copy.id = crypto.randomUUID();
  copy.name = `${original.name} copy`;
  for (const e of copy.effects) e.id = crypto.randomUUID();
  // New ids throughout, with the references between them (placements → clips, pattern
  // steps → rows) moved over to the new ones.
  const ids = new Map<string, string>();
  const fresh = (old: string) => {
    const id = crypto.randomUUID();
    ids.set(old, id);
    return id;
  };
  if (copy.kind === 'midi') {
    for (const c of copy.clips) {
      c.id = fresh(c.id);
      for (const n of c.notes) n.id = crypto.randomUUID();
      if (c.source) c.source.notes = c.notes.map((n) => ({ ...n })); // ids must match the notes
    }
  } else if (copy.kind === 'voice' && original.kind === 'voice') {
    copy.clips = copy.clips.map((c, i) => ({ ...c, id: crypto.randomUUID(), audio: original.clips[i].audio }));
  } else if (copy.kind === 'drums') {
    for (const r of copy.rows) r.id = fresh(r.id);
    for (const p of copy.patterns) {
      p.id = fresh(p.id);
      p.steps = Object.fromEntries(Object.entries(p.steps).map(([row, steps]) => [ids.get(row) ?? row, steps]));
    }
  }
  if (copy.kind !== 'voice') {
    copy.placements = copy.placements.map((pl) => ({ ...pl, id: crypto.randomUUID(), clipId: ids.get(pl.clipId) ?? pl.clipId }));
    if (copy.current) copy.current = ids.get(copy.current) ?? copy.current;
  }
  project.tracks.splice(index + 1, 0, copy);
  selection.trackId = copy.id;
  return project.tracks[index + 1];
}

export function removeTrack(id: string) {
  project.tracks = project.tracks.filter((t) => t.id !== id);
  if (selection.trackId === id) {
    selection.trackId = null;
    selection.noteIds = [];
  }
}

// ---------- Instrument presets ----------

// The preset a MIDI track plays with.
export function trackPreset(track: MidiTrack): InstrumentPreset {
  return presetById(project.instruments, track.instrument);
}

// A new preset of yours, copied from `from` (built in or yours). Returns it as stored in
// the project, so the instrument window can change it.
export function addPreset(from: InstrumentPreset): InstrumentPreset {
  const copy = $state.snapshot(from) as InstrumentPreset;
  project.instruments.push({ ...copy, id: crypto.randomUUID(), name: `${copy.name} (copy)` });
  return project.instruments[project.instruments.length - 1];
}

// Deletes one of your presets; tracks using it go back to the default (piano).
export function removePreset(id: string) {
  if (isBuiltIn(id)) return;
  project.instruments = project.instruments.filter((p) => p.id !== id);
  for (const t of project.tracks) if (t.kind === 'midi' && t.instrument === id) t.instrument = DEFAULT_PRESET_ID;
}

// ---------- Effects ----------
// Effects belong to a track, or to a drum row (each row is an instrument of its own). The
// functions take the owner's id, whichever it is.

// The track or drum row with this id, as stored (so changes show), and a name for it.
export function effectOwner(id: string): { name: string; effects: Effect[] } | undefined {
  for (const t of project.tracks) {
    if (t.id === id) return { name: t.name, get effects() { return t.effects; }, set effects(v) { t.effects = v; } };
    if (t.kind === 'drums') {
      const row = t.rows.find((r) => r.id === id);
      if (row) return { name: `${t.name}: ${drumName(row.sound)}`, get effects() { return row.effects; }, set effects(v) { row.effects = v; } };
    }
  }
}

// Adds an effect at the end of the track's chain, with default settings. Returns it as
// stored in the project, so its effect window can change it.
export function addEffect(trackId: string, type: EffectType): Effect | undefined {
  const track = effectOwner(trackId);
  if (!track) return;
  track.effects.push({ id: crypto.randomUUID(), type, enabled: true, params: defaultParams(type) });
  return track.effects[track.effects.length - 1];
}

export function removeEffect(trackId: string, effectId: string) {
  const track = effectOwner(trackId);
  if (track) track.effects = track.effects.filter((e) => e.id !== effectId);
}

// Moves an effect earlier (-1) or later (+1) in the chain.
export function moveEffect(trackId: string, effectId: string, by: -1 | 1) {
  const effects = effectOwner(trackId)?.effects;
  if (!effects) return;
  const from = effects.findIndex((e) => e.id === effectId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= effects.length) return;
  const [effect] = effects.splice(from, 1);
  effects.splice(to, 0, effect);
}

// Moves an effect to position `to` in the chain (0 = first), e.g. after dragging it.
// `to` counts positions before the move, as the list looked while dragging.
export function moveEffectTo(trackId: string, effectId: string, to: number) {
  const effects = effectOwner(trackId)?.effects;
  if (!effects) return;
  const from = effects.findIndex((e) => e.id === effectId);
  if (from < 0) return;
  const [effect] = effects.splice(from, 1);
  effects.splice(Math.max(0, Math.min(effects.length, to > from ? to - 1 : to)), 0, effect);
}

// ---------- Clips ----------

function findTrack(trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

// Recording into a voice track replaces its recordings (every take starts at bar 1).
export function clearClips(trackId: string) {
  const track = findTrack(trackId);
  if (track?.kind === 'voice') track.clips = [];
}

// A recorded (or re-transcribed) take goes into the melody track's current clip,
// replacing its notes: every place the clip is in the playlist plays the new take. A
// track whose clip isn't placed anywhere gets it placed at bar 1.
export function recordIntoClip(trackId: string, take: NoteClip) {
  const track = findTrack(trackId);
  if (track?.kind !== 'midi') return;
  const clip = currentClip(track);
  const copy = $state.snapshot(take) as NoteClip;
  Object.assign(clip, { notes: copy.notes, duration: copy.duration, source: copy.source, pitchTrack: copy.pitchTrack, start: 0 });
  if (!track.placements.some((p) => p.clipId === clip.id)) addPlacement(track, clip.id, 0);
}

// Adds a clip as it is (e.g. from tests or older code), placed at its own start.
export function addNoteClip(trackId: string, clip: NoteClip) {
  const track = findTrack(trackId);
  if (track?.kind !== 'midi') return;
  const copy = $state.snapshot(clip) as NoteClip;
  const at = copy.start;
  track.clips.push({ ...copy, start: 0, name: copy.name ?? contentName(track, track.name) });
  addPlacement(track, copy.id, at);
  track.current = copy.id;
}

export function addVoiceClip(trackId: string, clip: VoiceClip) {
  const track = findTrack(trackId);
  // Not snapshotted: it's fresh from the recorder, and copying the audio is slow.
  if (track?.kind === 'voice') track.clips.push(clip);
}

// ---------- Saving ----------
// localStorage only holds text: the project is saved as JSON. Voice recordings
// (Float32Array) are too big for it, so voice tracks are saved without their clips.

const STORAGE_KEY = 'hum-daw:project';

export function saveProject() {
  const copy = $state.snapshot(project) as Project;
  copy.tracks = copy.tracks.map((t) => (t.kind === 'voice' ? { ...t, clips: [] } : t));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
}

export function loadProject() {
  const text = localStorage.getItem(STORAGE_KEY);
  if (!text) return;
  try {
    const saved = JSON.parse(text) as Project;
    for (const track of saved.tracks ?? []) {
      track.effects = upgradeEffects(track.effects);
      track.pan ??= 0; // saved before tracks had pan
      track.swing ??= 0.5; // …or swing on every track
      track.swingUnit ??= 8;
      if (track.kind === 'drums') upgradeDrums(track);
      if (track.kind === 'midi') upgradeMelody(track);
    }
    saved.instruments ??= []; // saved before instrument presets existed
    saved.detune ??= 0;
    saved.transpose ??= 0; // saved before key shift and master volume
    saved.masterVolume ??= 0;
    Object.assign(project, saved);
  } catch {
    console.warn('The saved project could not be read; starting a new one.');
  }
}

// Older saves: drum steps were on the track (`steps[row][step]`), then on each row; now
// they're in patterns.
function upgradeDrums(track: DrumTrack) {
  const old = (track as unknown as { steps?: boolean[][] }).steps;
  type OldRow = DrumRow & { steps?: boolean[] };
  if (!track.rows) track.rows = DEFAULT_KIT.map((sound, i) => ({ ...drumRow(sound), steps: old?.[i] ?? Array(16).fill(false) }) as OldRow);
  if (!track.patterns) {
    const pattern = newPattern('Pattern 1');
    for (const r of track.rows as OldRow[]) pattern.steps[r.id] = r.steps ?? [];
    track.patterns = [pattern];
    track.current = pattern.id;
  }
  track.placements ??= [];
  for (const r of track.rows as OldRow[]) {
    delete r.steps;
    r.pan ??= 0; // saved before rows were full instruments
    r.mute ??= false;
    r.effects ??= [];
  }
}

// Older saves: melody clips had their place on the timeline in `clip.start`; now that's a
// placement, and the clip starts at 0.
function upgradeMelody(track: MidiTrack) {
  if (track.placements) return;
  track.placements = track.clips.map((c) => ({ id: crypto.randomUUID(), clipId: c.id, start: c.start }));
  track.clips.forEach((c, i) => {
    c.start = 0;
    c.name ??= `${track.name} ${i + 1}`;
  });
  track.current = track.clips[0]?.id;
}

// Projects saved before the effects list had `effects: { reverb, delay }` (amounts 0–1).
function upgradeEffects(effects: unknown): Effect[] {
  if (Array.isArray(effects)) return effects;
  const old = (effects ?? {}) as { reverb?: number; delay?: number };
  const list: Effect[] = [];
  for (const type of ['reverb', 'delay'] as const) {
    const amount = old[type] ?? 0;
    if (amount > 0) list.push({ id: crypto.randomUUID(), type, enabled: true, params: { ...defaultParams(type), mix: amount } });
  }
  return list;
}
