import * as Tone from 'tone';
import { playedVelocity, slursInto } from '$lib/music/articulation';
import { bends, detuneAt } from '$lib/music/note-expression';
import { midiToHz } from '$lib/music/tuning';
import { swingTicks, type SwingUnit } from '$lib/music/drums';
import type { NoteClip, VoiceEdit } from '$lib/music/types';
import { canPlay, type Instrument } from './instruments';
import { PPQ } from '$lib/music/time';
import { valueAt } from '$lib/music/automation';

export interface ScheduledClip {
  dispose(): void;
  // A recording following a tempo lane: its speed to match the tempo now.
  setTempo?(bpm: number): void;
  // A recording following key shift / tuning lanes: the song's pitch shift now (cents).
  setShift?(cents: number): void;
}

// `offsetTicks`: where project tick 0 is on the transport (after a count-in, while recording).
// `detuneCents`: the song's pitch shift (tuning + key shift, cents). `swing`: the track's
// swing. Either can be a function of the note's tick in the song, read as each note plays,
// so automation lanes are heard exactly where they change.
type Live<T> = T | ((tick: number) => T);
const read = <T>(v: Live<T>, tick: number): T => (typeof v === 'function' ? (v as (tick: number) => T)(tick) : v);

export function scheduleClip(
  clip: NoteClip,
  synth: Instrument,
  offsetTicks = 0,
  detuneCents: Live<number> = 0,
  swing: Live<{ amount: number; unit: SwingUnit }> = { amount: 0.5, unit: 8 }
): ScheduledClip {
  const transport = Tone.getTransport();
  // Ticks → seconds on the transport playing this (when exporting, the offline one: Tone's
  // global conversions would use the live transport's tempo).
  const seconds = (ticks: number) => (ticks / PPQ) * (60 / transport.bpm.value);
  const hz = (pitch: number, start: number) => midiToHz(pitch + read(detuneCents, clip.start + start) / 100);
  // Notes are scheduled on the beat; a swung off-beat is pushed late as it plays.
  const at = (start: number) => `${Math.round(clip.start + start)}i`;
  const late = (start: number) => {
    const s = read(swing, clip.start + start);
    if (s.amount === 0.5) return 0;
    return (swingTicks(clip.start + start, s.amount, s.unit) / PPQ) * (60 / transport.bpm.value);
  };
  // The clip's controller lanes (pitch bend, mod wheel): cents to add at a tick of the clip
  // (`time`: when, for the mod wheel's vibrato).
  const bendLane = clip.controllers?.bend?.length ? clip.controllers.bend : null;
  const modLane = clip.controllers?.mod?.length ? clip.controllers.mod : null;
  const MOD_CENTS = 50; // the vibrato at full mod wheel
  const MOD_HZ = 5.5;
  const controlCents = (tick: number, time: number) =>
    (bendLane ? (valueAt(bendLane, tick) ?? 0) * 100 : 0) + (modLane ? (valueAt(modLane, tick) ?? 0) * MOD_CENTS * Math.sin(2 * Math.PI * MOD_HZ * time) : 0);
  if (synth instanceof Tone.Sampler || synth instanceof Tone.PolySynth) {
    // Chords and samples: the bend where each note starts (no vibrato, no bending as it sounds).
    const bentHz = (pitch: number, start: number) => midiToHz(pitch + (read(detuneCents, clip.start + start) + (bendLane ? (valueAt(bendLane, start) ?? 0) * 100 : 0)) / 100);
    return schedulePolyphonic(clip, synth, offsetTicks, bentHz, at, late, seconds);
  }
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

  const part = new Tone.Part((onBeat, note) => {
    const time = onBeat + late(note.start);
    const duration = seconds(note.duration);
    if (note.slurredFrom) synth.setNote(hz(note.pitch, note.start), time);
    else synth.triggerAttack(hz(note.pitch, note.start), time, playedVelocity(note));

    // Bend the pitch: the sung curve (slides, vibrato the interpreter kept) plus the
    // expression set in the piano roll, exactly as the piano roll draws it, plus the clip's
    // pitch bend and mod wheel lanes.
    synth.detune.cancelScheduledValues(time);
    if (bendLane || modLane) {
      const ticksPerSec = (transport.bpm.value / 60) * PPQ;
      const at = (t: number) => (bends(note) ? detuneAt(note, t, duration, note.previous) : 0) + controlCents(note.start + t * ticksPerSec, time + t);
      synth.detune.setValueAtTime(at(0), time);
      for (let t = STEP; t < duration; t += STEP) synth.detune.linearRampToValueAtTime(at(t), time + t);
    } else if (bends(note)) {
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
  hz: (pitch: number, start: number) => number,
  at: (start: number) => string,
  late: (start: number) => number,
  seconds: (ticks: number) => number
): ScheduledClip {
  const events = clip.notes.map((n) => ({ ...n, time: at(n.start) }));
  const part = new Tone.Part((onBeat, note) => {
    const time = onBeat + late(note.start);
    if (!canPlay(instrument)) return; // still downloading (or couldn't): skip rather than error
    instrument.triggerAttackRelease(hz(note.pitch, note.start), seconds(note.duration), time, playedVelocity(note));
  }, events);
  part.start(`${offsetTicks}i`);
  return { dispose: () => part.dispose() };
}

// Plays a recording on the transport from `startTicks`. `rate` is playing tempo / recorded
// tempo: the recording speeds up or slows down to stay with the notes, at the same pitch
// (Tone's GrainPlayer; untouched at the original tempo). `edit` trims, speeds up, pitches,
// fades or reverses it (the voice editor). It plays into `output` (a track's effects), or
// straight to the speakers.
// `followTempo` (a tempo lane is playing): it's stretched as the tempo changes, so it stays
// on the beat, and it stops at its place in the song rather than after a fixed time.
export function scheduleRecording(
  audio: Float32Array,
  sampleRate: number,
  rate: number,
  volumeDb = 0,
  output?: Tone.ToneAudioNode,
  startTicks = 0,
  detuneCents = 0,
  edit: VoiceEdit = {},
  followTempo?: { recordedBpm: number },
  followPitch = false
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
    speed === 1 && detune === 0 && !followTempo && !followPitch
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

  // A reversed buffer plays from its end: the trim measures from there. If it started
  // before the transport's 0 (recording from the playhead), it picks up part-way.
  const transport = Tone.getTransport();
  const skip = startTicks < 0 ? ((-startTicks / PPQ) * (60 / transport.bpm.value)) * speed : 0;
  const offset = (edit.reverse ? full - trimEnd : trimStart) + skip;
  const duration = trimEnd - trimStart - skip;
  if (duration > 0 && followTempo) {
    // Its length in the song (ticks) doesn't change with the tempo: stop it there.
    const editSpeed = edit.speed ?? 1;
    const lengthTicks = ((trimEnd - trimStart) / editSpeed) * (followTempo.recordedBpm / 60) * PPQ;
    player.sync().start(`${Math.max(0, startTicks)}i`, offset);
    player.stop(`${Math.round(startTicks + lengthTicks)}i`);
  } else if (duration > 0) player.sync().start(`${Math.max(0, startTicks)}i`, offset, duration);
  return {
    setTempo:
      followTempo && player instanceof Tone.GrainPlayer
        ? (bpm: number) => (player.playbackRate = (bpm / followTempo.recordedBpm) * (edit.speed ?? 1))
        : undefined,
    setShift:
      followPitch && player instanceof Tone.GrainPlayer ? (cents: number) => (player.detune = cents + (edit.pitch ?? 0) * 100) : undefined,
    dispose() {
      if (fades !== null) Tone.getTransport().clear(fades);
      player.unsync();
      player.dispose();
      fade.dispose();
      buffer.dispose();
    }
  };
}
