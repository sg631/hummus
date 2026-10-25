import * as Tone from 'tone';
import { playedVelocity, slursInto } from '$lib/music/articulation';
import { bends, detuneAt } from '$lib/music/note-expression';
import { midiToHz } from '$lib/music/tuning';
import { swingTicks, type SwingUnit } from '$lib/music/drums';
import type { NoteClip, VoiceEdit } from '$lib/music/types';
import type { Instrument } from './instruments';

export interface ScheduledClip {
  dispose(): void;
}

// `offsetTicks`: where project tick 0 is on the transport (after a count-in, while recording).
// `detuneCents`: the song's tuning shift (project.detune). `swing`: the track's swing.
export function scheduleClip(
  clip: NoteClip,
  synth: Instrument,
  offsetTicks = 0,
  detuneCents = 0,
  swing: { amount: number; unit: SwingUnit } = { amount: 0.5, unit: 8 }
): ScheduledClip {
  const hz = (pitch: number) => midiToHz(pitch + detuneCents / 100);
  // Where a note plays: its place on the timeline, pushed late if it's on a swung off-beat.
  const at = (start: number) => {
    const tick = clip.start + start;
    return `${Math.round(tick + (swing.amount === 0.5 ? 0 : swingTicks(tick, swing.amount, swing.unit)))}i`;
  };
  if (synth instanceof Tone.Sampler || synth instanceof Tone.PolySynth) return schedulePolyphonic(clip, synth, offsetTicks, hz, at);
  const sorted = [...clip.notes].sort((a, b) => a.start - b.start);
  const events = sorted.map((n, i) => ({
    ...n,
    time: at(n.start),
    slurredFrom: i > 0 && slursInto(sorted[i - 1], n), // legato: change pitch, no new attack
    slursOn: slursInto(n, sorted[i + 1]), // ...and don't release before the next note
    // One note at a time: if the next note starts first, it takes over, and releasing
    // this one would cut the next one short.
    cutBy: !!sorted[i + 1] && sorted[i + 1].start < n.start + n.duration,
    previous: sorted[i - 1]?.pitch // for a glide from the note before
  }));

  const STEP = 0.01; // seconds between pitch-bend points

  const part = new Tone.Part((time, note) => {
    const duration = Tone.Ticks(note.duration).toSeconds();
    if (note.slurredFrom) synth.setNote(hz(note.pitch), time);
    else synth.triggerAttack(hz(note.pitch), time, playedVelocity(note));

    // Bend the pitch: the sung curve (slides, vibrato the interpreter kept) plus the
    // expression set in the piano roll, exactly as the piano roll draws it.
    synth.detune.cancelScheduledValues(time);
    if (bends(note)) {
      synth.detune.setValueAtTime(detuneAt(note, 0, duration, note.previous), time);
      for (let t = STEP; t < duration; t += STEP) {
        synth.detune.linearRampToValueAtTime(detuneAt(note, t, duration, note.previous), time + t);
      }
    } else {
      synth.detune.setValueAtTime(0, time);
    }

    if (!note.slursOn && !note.cutBy) synth.triggerRelease(time + duration);
  }, events);

  part.start(`${offsetTicks}i`);
  return {
    dispose() {
      part.dispose();
    }
  };
}
// A sampler or a polyphonic synth: each note as written, at its pitch, overlapping freely
// (chords); no bends or slurs.
function schedulePolyphonic(
  clip: NoteClip,
  instrument: Tone.Sampler | Tone.PolySynth,
  offsetTicks: number,
  hz: (pitch: number) => number,
  at: (start: number) => string
): ScheduledClip {
  const events = clip.notes.map((n) => ({ ...n, time: at(n.start) }));
  const part = new Tone.Part((time, note) => {
    if (instrument instanceof Tone.Sampler && !instrument.loaded) return; // still downloading: skip rather than error
    instrument.triggerAttackRelease(hz(note.pitch), Tone.Ticks(note.duration).toSeconds(), time, playedVelocity(note));
  }, events);
  part.start(`${offsetTicks}i`);
  return { dispose: () => part.dispose() };
}

// Plays a recording on the transport from `startTicks`. `rate` is playing tempo / recorded
// tempo: the recording speeds up or slows down to stay with the notes, at the same pitch
// (Tone's GrainPlayer; untouched at the original tempo). `edit` trims, speeds up, pitches,
// fades or reverses it (the voice editor). It plays into `output` (a track's effects), or
// straight to the speakers.
export function scheduleRecording(
  audio: Float32Array,
  sampleRate: number,
  rate: number,
  volumeDb = 0,
  output?: Tone.ToneAudioNode,
  startTicks = 0,
  detuneCents = 0,
  edit: VoiceEdit = {}
): ScheduledClip {
  const raw = new AudioBuffer({ length: Math.max(1, audio.length), sampleRate, numberOfChannels: 1 });
  raw.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);
  const buffer = new Tone.ToneAudioBuffer(raw);
  const full = raw.duration;
  const speed = rate * (edit.speed ?? 1);
  const detune = detuneCents + (edit.pitch ?? 0) * 100;
  const trimStart = Math.max(0, Math.min(full, edit.trimStart ?? 0));
  const trimEnd = Math.max(trimStart, Math.min(full, edit.trimEnd ?? full));
  const player =
    speed === 1 && detune === 0
      ? new Tone.Player(buffer)
      : // Short grains suit a voice: long ones smear notes into each other.
        new Tone.GrainPlayer({ url: buffer, playbackRate: speed, detune, grainSize: 0.08, overlap: 0.04 });
  player.reverse = !!edit.reverse;
  player.volume.value = volumeDb + (edit.gain ?? 0);

  // Fades: a gain after the player, moved along with the transport.
  const fade = new Tone.Gain(1);
  player.connect(fade);
  if (output) fade.connect(output);
  else fade.toDestination();
  const length = (trimEnd - trimStart) / speed; // seconds on the timeline
  const fadeIn = Math.min(edit.fadeIn ?? 0, length / 2);
  const fadeOut = Math.min(edit.fadeOut ?? 0, length / 2);
  const fades =
    fadeIn > 0 || fadeOut > 0
      ? Tone.getTransport().schedule((time) => {
          fade.gain.cancelScheduledValues(time);
          fade.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, time);
          if (fadeIn > 0) fade.gain.linearRampToValueAtTime(1, time + fadeIn);
          if (fadeOut > 0) {
            fade.gain.setValueAtTime(1, time + length - fadeOut);
            fade.gain.linearRampToValueAtTime(0, time + length);
          }
        }, `${startTicks}i`)
      : null;

  // A reversed buffer plays from its end: the trim measures from there.
  const offset = edit.reverse ? full - trimEnd : trimStart;
  player.sync().start(`${startTicks}i`, offset, trimEnd - trimStart);
  return {
    dispose() {
      if (fades !== null) Tone.getTransport().clear(fades);
      player.unsync();
      player.dispose();
      fade.dispose();
      buffer.dispose();
    }
  };
}
