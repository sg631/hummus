// Playing the whole project. For each track, a chain of audio nodes:
//
//   instrument (or recording, or drums) → reverb → delay → channel (volume, mute) → speakers
//
// and its notes scheduled on Tone's transport. Then the transport starts, and everything
// plays in time. Positions are ticks; Tone reads `${ticks}i` as a time in ticks.
//
//   await playProject(project)   // from the start
//   stopProject()
//
// While recording, the recorder calls `scheduleProject(project, offsetTicks)` itself
// (its playAlong option) so you hear the other tracks: that's why scheduling and starting
// are separate functions.
import * as Tone from 'tone';
import { initAudio } from './engine';
import type { Project, Track } from '$lib/music/types';

// Everything made for the current playback, so stopProject can clean it up.
let disposables: { dispose(): void }[] = [];

// TODO(you): for each track, build its chain (buildChain) and schedule it:
// - midi: createInstrument(track.instrument), connected to the chain; for each clip and
//   note, schedule a note with a Tone.Part (see audio/playback.ts for an example):
//     new Tone.Part((time, note) => synth.triggerAttackRelease(freq, duration, time, velocity),
//                   events).start(0)
//   where each event has time: `${offsetTicks + clip.start + note.start}i`.
//   Note pitch → frequency: midiToHz(note.pitch) from music/tuning.ts; duration in
//   seconds: Tone.Ticks(note.duration).toSeconds().
// - voice: scheduleRecording(clip.audio, clip.sampleRate, project.bpm / clip.recordedBpm)
//   from audio/playback.ts (it connects to the speakers directly; that's fine to start).
// - drums: one createDrum(sound) per row, and a Tone.Sequence over 16 steps
//   (subdivision '16n') that plays a row's drum when steps[row][step] is true.
// Push everything you create onto `disposables`. Skip muted tracks.
export function scheduleProject(project: Project, offsetTicks = 0) {
  throw new Error(`TODO: scheduleProject(${project.tracks.length} tracks, ${offsetTicks})`);
}

// TODO(you): reset the transport (stop, cancel, position = 0), set its bpm from the
// project, scheduleProject(project), then Tone.getTransport().start().
export async function playProject(project: Project) {
  await initAudio(); // audio can only start after a click: call this from a click handler
  throw new Error(`TODO: playProject(${project.name})`);
}

// TODO(you): stop the transport, cancel what's scheduled, and dispose everything in
// `disposables` (then empty it).
export function stopProject() {
  throw new Error('TODO: stopProject');
}

// TODO(you): make the effects and channel for a track, connected in order, and return the
// first node (what the instrument connects to):
//   const channel = new Tone.Channel({ volume: track.volume, mute: track.mute }).toDestination();
//   const delay = new Tone.FeedbackDelay('8n', 0.3); delay.wet.value = track.effects.delay;
//   const reverb = new Tone.Reverb(2); reverb.wet.value = track.effects.reverb;
//   reverb.connect(delay); delay.connect(channel);
//   return reverb;
// Add each to `disposables`.
function buildChain(track: Track): Tone.ToneAudioNode {
  throw new Error(`TODO: buildChain(${track.name})`);
}
