import * as Tone from 'tone';
import { playedVelocity, slursInto } from '$lib/music/articulation';
import { midiToHz } from '$lib/music/tuning';
import type { NoteClip } from '$lib/music/types';

export interface ScheduledClip {
  dispose(): void;
}

export function scheduleClip(clip: NoteClip, synth: Tone.Synth): ScheduledClip {
  const sorted = [...clip.notes].sort((a, b) => a.start - b.start);
  const events = sorted.map((n, i) => ({
    ...n,
    time: `${clip.start + n.start}i`,
    slurredFrom: i > 0 && slursInto(sorted[i - 1], n), // legato: change pitch, no new attack
    slursOn: slursInto(n, sorted[i + 1]) // ...and don't release before the next note
  }));

  const part = new Tone.Part((time, note) => {
    const duration = Tone.Ticks(note.duration).toSeconds();
    if (note.slurredFrom) synth.setNote(midiToHz(note.pitch), time);
    else synth.triggerAttack(midiToHz(note.pitch), time, playedVelocity(note));

    // Bend the pitch along the cleaned curve: slides, vibrato and
    // anything else the interpreter kept play back exactly.
    const curve = note.interpretation?.curve;
    const times = note.curve?.t;
    synth.detune.cancelScheduledValues(time);

    if (curve && times && curve.length === times.length && curve.length > 0) {
      synth.detune.setValueAtTime(curve[0], time);
      for (let i = 1; i < curve.length; i++) {
        if (times[i] >= duration) break; // quantizing may have shortened the note
        synth.detune.linearRampToValueAtTime(curve[i], time + times[i]);
      }
    } else {
      synth.detune.setValueAtTime(0, time);
    }

    if (!note.slursOn) synth.triggerRelease(time + duration);
  }, events);

  part.start(0);
  return {
    dispose() {
      part.dispose();
    }
  };
}
// Plays a take's recording on the transport from position 0. `rate` is playing tempo /
// recorded tempo: the recording speeds up or slows down to stay with the notes, at the
// same pitch (Tone's GrainPlayer; at the original tempo it plays untouched).
export function scheduleRecording(
  audio: Float32Array,
  sampleRate: number,
  rate: number,
  volumeDb = 0
): ScheduledClip {
  const raw = new AudioBuffer({ length: Math.max(1, audio.length), sampleRate, numberOfChannels: 1 });
  raw.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);
  const buffer = new Tone.ToneAudioBuffer(raw);
  const player =
    rate === 1
      ? new Tone.Player(buffer)
      : // Short grains suit a voice: long ones smear notes into each other.
        new Tone.GrainPlayer({ url: buffer, playbackRate: rate, grainSize: 0.08, overlap: 0.04 });
  player.volume.value = volumeDb;
  player.toDestination().sync().start(0);
  return {
    dispose() {
      player.unsync();
      player.dispose();
      buffer.dispose();
    }
  };
}
