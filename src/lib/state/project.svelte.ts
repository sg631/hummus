// The song being made, and what's selected. Every component imports these two objects
// and reads them directly; changing them (e.g. `project.bpm = 120`) updates the screen
// everywhere, because they're $state.
//
// Keep the functions that change the project here, so components stay simple:
// a button calls `addMidiTrack()`, it doesn't build tracks itself.
import type { DrumTrack, MidiTrack, NoteClip, Project, Track, VoiceClip, VoiceTrack } from '$lib/music/types';

export const project = $state<Project>({
  name: 'Untitled',
  bpm: 100,
  timeSignature: [4, 4],
  tracks: []
});

export const selection = $state({
  trackId: null as string | null, // the track the piano roll / drum grid shows, and recording goes to
  noteId: null as string | null   // the note selected in the piano roll
});

// The selected track, or undefined.
export function selectedTrack(): Track | undefined {
  return project.tracks.find((t) => t.id === selection.trackId);
}

// ---------- Tracks ----------

// TODO(you): make a MidiTrack ({ id: crypto.randomUUID(), kind: 'midi', name, volume: 0,
// mute: false, effects: { reverb: 0, delay: 0 }, instrument: 'piano', clips: [] }),
// push it onto project.tracks, select it (selection.trackId = …), and return it.
export function addMidiTrack(name = 'Melody'): MidiTrack {
  throw new Error(`TODO: addMidiTrack(${name})`);
}

// TODO(you): like addMidiTrack, with kind: 'voice' and clips: [].
export function addVoiceTrack(name = 'Voice'): VoiceTrack {
  throw new Error(`TODO: addVoiceTrack(${name})`);
}

// TODO(you): like addMidiTrack, with kind: 'drums' and steps: one row of 16 `false` per
// sound in DRUM_SOUNDS (hint: DRUM_SOUNDS.map(() => Array(16).fill(false))).
export function addDrumTrack(name = 'Drums'): DrumTrack {
  throw new Error(`TODO: addDrumTrack(${name})`);
}

// TODO(you): remove the track with this id (hint: project.tracks = project.tracks.filter(…)),
// and clear the selection if it was selected.
export function removeTrack(id: string) {
  throw new Error(`TODO: removeTrack(${id})`);
}

// ---------- Clips ----------

// TODO(you): find the track; if it's a MIDI track, push the clip onto its clips.
// Use a copy of the clip: $state.snapshot(clip) if it came from $state/$derived.
export function addNoteClip(trackId: string, clip: NoteClip) {
  throw new Error(`TODO: addNoteClip(${trackId}, ${clip.id})`);
}

// TODO(you): the same for a voice track.
export function addVoiceClip(trackId: string, clip: VoiceClip) {
  throw new Error(`TODO: addVoiceClip(${trackId}, ${clip.id})`);
}

// ---------- Saving ----------
// localStorage only holds text: JSON.stringify the project. Voice recordings
// (Float32Array) are too big for it: leave voice clips out when saving (filter them
// out of a copy), or the save will fail.

// TODO(you): save a copy of the project (without voice audio) under a key like 'hum-daw:project'.
export function saveProject() {
  throw new Error('TODO: saveProject');
}

// TODO(you): read it back (JSON.parse) and copy its fields into `project`
// (e.g. Object.assign(project, saved)). Do nothing if nothing was saved.
export function loadProject() {
  throw new Error('TODO: loadProject');
}
