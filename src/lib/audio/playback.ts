import * as Tone from 'tone';
import { midiToHz } from '$lib/music/tuning';
import type { NoteClip } from '$lib/music/types';

export interface ScheduledClip {
  dispose(): void;
}

export function scheduleClip(clip: NoteClip, synth: Tone.Synth): ScheduledClip {
  const events = clip.notes.map((n) => ({ ...n, time: `${clip.start + n.start}i` }));

  const part = new Tone.Part((time, note) => {
    const duration = Tone.Ticks(note.duration).toSeconds();
    synth.triggerAttack(midiToHz(note.pitch), time, note.velocity);

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

    synth.triggerRelease(time + duration);
  }, events);

  part.start(0);
  return {
    dispose() {
      part.dispose();
    }
  };
}