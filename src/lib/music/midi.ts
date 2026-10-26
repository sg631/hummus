import { Midi } from '@tonejs/midi';
import { playedVelocity } from './articulation';
import type { TimeSignature } from './time';
import type { NoteClip } from './types';

// MIDI pitch bend's usual range: ±2 semitones (the value −1 … 1 covers it).
export const BEND_RANGE = 2;

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

// Every melody track as its own MIDI track (named after it), for the whole song.
export function tracksToMidi(tracks: { name: string; clips: NoteClip[] }[], bpm: number, timeSignature: TimeSignature = [4, 4]): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature });
  midi.header.update();
  for (const t of tracks) {
    const track = midi.addTrack();
    track.name = t.name;
    for (const clip of t.clips) {
      for (const n of clip.notes) {
        track.addNote({ midi: n.pitch, ticks: clip.start + n.start, durationTicks: n.duration, velocity: playedVelocity(n) });
      }
      // Controller lanes: pitch bend (MIDI's usual ±2 semitone range) and the mod wheel (CC 1).
      const end = clip.start + clip.duration;
      for (const p of clip.controllers?.bend ?? []) {
        // @tonejs/midi reads bends as −1 … 1 but writes the number as given, and the file
        // wants −8192 … 8191: scale it here.
        const v = Math.max(-1, Math.min(1, p.value / BEND_RANGE));
        if (clip.start + p.tick <= end) track.addPitchBend({ ticks: clip.start + p.tick, value: Math.round(v * 8191) });
      }
      for (const p of clip.controllers?.mod ?? []) {
        if (clip.start + p.tick <= end) track.addCC({ number: 1, ticks: clip.start + p.tick, value: Math.max(0, Math.min(1, p.value)) });
      }
    }
  }
  return new Blob([new Uint8Array(midi.toArray())], { type: 'audio/midi' });
}
