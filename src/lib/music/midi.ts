import { Midi } from '@tonejs/midi';
import type { NoteClip } from './types';

export function clipsToMidi(clips: NoteClip[], bpm: number): Blob {
  const midi = new Midi(); // 480 ticks per beat by default, same as yours
  midi.header.setTempo(bpm);
  const track = midi.addTrack();

  for (const clip of clips) {
    for (const n of clip.notes) {
      track.addNote({
        midi: n.pitch,
        ticks: clip.start + n.start,
        durationTicks: n.duration,
        velocity: n.velocity
      });
    }
  }

  return new Blob([new Uint8Array(midi.toArray())], { type: 'audio/midi' });
}