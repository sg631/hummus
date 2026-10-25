import { Midi } from '@tonejs/midi';
import { playedVelocity } from './articulation';
import type { TimeSignature } from './time';
import type { NoteClip } from './types';

export function clipsToMidi(clips: NoteClip[], bpm: number, timeSignature: TimeSignature = [4, 4]): Blob {
  const midi = new Midi(); // 480 ticks per beat by default, same as yours
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature });
  midi.header.update();
  const track = midi.addTrack();

  for (const clip of clips) {
    for (const n of clip.notes) {
      track.addNote({
        midi: n.pitch,
        ticks: clip.start + n.start,
        durationTicks: n.duration,
        velocity: playedVelocity(n) // accents play harder
      });
    }
  }

  return new Blob([new Uint8Array(midi.toArray())], { type: 'audio/midi' });
}
