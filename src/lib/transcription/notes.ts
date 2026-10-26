// Detected notes → named notes with their sung curves. Pure: re-run freely when settings change.
//
// Notes are named from the audio alone: no key, scale or expected melody, so any melody
// (chromatic, modulating, atonal) is written as sung. Where the audio itself is
// ambiguous, the note says so (`alternatives`) instead of the transcription guessing.
import { median } from '$lib/music/math';
import { dbToVelocity, toDecibels } from '$lib/music/tuning';
import type { Articulation, NoteCurve } from '$lib/music/types';
import type { Analysis, DetectedNote, PitchTrack, TranscribedNote } from './types';

export interface NoteSettings {
  minNoteSec: number;      // shorter notes are dropped (the note model already drops < 0.05 s)
  relativeTuning: boolean; // name notes relative to the singer's own tuning, not A440
  referenceSec: number;    // how far (in time) other notes inform a note's tuning reference
  // Optional lean towards a scale: a note sung within `cents` of the halfway point to an
  // in-scale neighbour is named as that neighbour. Off unless set (the guide's first
  // take uses it, so a first melody lands in the backing's key).
  scaleBias?: { pitchClasses: number[]; cents: number };
}

export const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  minNoteSec: 0.06, // fast runs and ornaments go down to ~70 ms a note
  relativeTuning: true,
  referenceSec: 8
};

const REFERENCE_PRIOR_SEC = 0.5; // the tuning reference leans to A440 like this much singing would
const LEVEL_WINDOW_SEC = 0.02;   // loudness is measured over this much audio around each frame
const AMBIGUOUS_CENTS = 35;      // a note this far from its semitone could be the neighbour
// Articulation.
const LEGATO_GAP_SEC = 0.03;  // a slur into a note starting within this is legato
const STACCATO_RATIO = 0.6;   // sounding at most this share of the time to the next note...
const STACCATO_GAP_SEC = 0.06; // ...with at least this much rest after it, is staccato
const ATTACK_SEC = 0.08;      // a note's attack: its first 80 ms
const ACCENT_DB = 4;          // an attack this much louder than its neighbours' is an accent...
const ACCENT_BODY_DB = 2;     // ...if it's also louder than the rest of its own note
const NEIGHBOURS_SEC = 3;     // neighbours: notes starting within this

const toMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

// `audio` (optional) gives loudness for velocity and the curve's dB.
export function buildNotes(
  analysis: Analysis,
  s: NoteSettings = DEFAULT_NOTE_SETTINGS,
  audio?: { samples: Float32Array; sampleRate: number }
): TranscribedNote[] {
  const kept = analysis.notes.filter((n) => n.duration >= s.minNoteSec);
  const sung = kept.map((n) => toMidi(n.freq));
  const spans = kept.map((n) => ({ start: n.time, end: n.time + n.duration }));

  const built = kept.map((n, i) => {
    const referenceCents = s.relativeTuning ? tuningReference(i, spans, sung, s.referenceSec) : 0;
    const tuned = sung[i] - referenceCents / 100;
    const pitch = nudge(tuned, s.scaleBias);
    const curve = noteCurve(n, analysis.track, audio);
    return {
      id: `${Math.round(n.time * 1000)}:${pitch}`,
      pitch,
      alternatives: alternatives(tuned, curve.pitch.map((m) => m - referenceCents / 100)),
      start: n.time,
      end: n.time + n.duration,
      velocity: curve.db.length ? dbToVelocity(median(curve.db)) : 0.8,
      curve,
      sung: sung[i],
      referenceCents
    };
  });
  const attacks = built.map((n) => attackLevel(n.curve));
  return built.map((n, i) => ({ ...n, articulation: articulation(i, kept, built, attacks) }));
}

// From how the note ended and what follows (legato, staccato), and its attack's level
// against its neighbours' (accent). Measured, so any of it can be wrong on unclear audio.
function articulation(
  i: number,
  detected: DetectedNote[],
  notes: { start: number; end: number; curve: NoteCurve }[],
  attacks: ({ peak: number; body: number } | null)[]
): Articulation {
  const n = notes[i];
  const next = notes[i + 1];
  let kind: Articulation['kind'] = 'normal';
  if (next && detected[i].endedBy === 'slur' && next.start - n.end < LEGATO_GAP_SEC) kind = 'legato';
  else if (
    next &&
    detected[i].endedBy !== 'slur' &&
    (n.end - n.start) / (next.start - n.start) <= STACCATO_RATIO &&
    next.start - n.end >= STACCATO_GAP_SEC
  ) {
    kind = 'staccato';
  }

  const own = attacks[i];
  const others = attacks
    .filter((a, j) => j !== i && a && Math.abs(notes[j].start - n.start) <= NEIGHBOURS_SEC)
    .map((a) => a!.peak);
  const accentDb = own && others.length >= 2 ? own.peak - median(others) : 0;
  const accent = !!own && accentDb >= ACCENT_DB && own.peak - own.body >= ACCENT_BODY_DB;
  return { kind, accent, accentDb: Math.round(accentDb * 10) / 10 };
}

// The loudest level in the note's attack, and the median after it (dB); null without levels.
function attackLevel(curve: NoteCurve): { peak: number; body: number } | null {
  const attack = curve.db.filter((d, k) => curve.t[k] < ATTACK_SEC && d > -Infinity);
  const body = curve.db.filter((d, k) => curve.t[k] >= ATTACK_SEC && d > -Infinity);
  if (!attack.length) return null;
  return { peak: Math.max(...attack), body: body.length ? median(body) : Math.max(...attack) };
}

// The offset (cents from A440 semitones) the other notes share, weighted by length and
// by how close in time they are. A note never shifts its own reference, so one badly-off
// note is named by how far it really is. Offsets wrap at ±50, so they're averaged as
// angles. The result is then scaled toward 0 (A440) by how much there is to go on: the
// singing's length against REFERENCE_PRIOR_SEC, and how well the notes agree.
export function tuningReference(
  index: number,
  notes: { start: number; end: number }[],
  sung: number[],
  referenceSec: number
): number {
  const middle = (n: { start: number; end: number }) => (n.start + n.end) / 2;
  let x = 0;
  let y = 0;
  let total = 0;
  notes.forEach((n, j) => {
    if (j === index) return;
    const offset = sung[j] - Math.round(sung[j]); // -0.5 to 0.5 semitones
    const distance = Math.abs(middle(n) - middle(notes[index]));
    const weight = (n.end - n.start) * Math.exp(-distance / referenceSec);
    x += weight * Math.cos(2 * Math.PI * offset);
    y += weight * Math.sin(2 * Math.PI * offset);
    total += weight;
  });
  if (total === 0) return 0;
  const agreement = Math.hypot(x, y) / total; // 1 when every offset is the same
  const confidence = (total / (total + REFERENCE_PRIOR_SEC)) * agreement;
  return (Math.atan2(y, x) / (2 * Math.PI)) * 100 * confidence;
}

// The nearest semitone, or (with a scale bias) the in-scale neighbour when the note
// sits close enough to halfway towards it.
function nudge(tuned: number, bias?: NoteSettings['scaleBias']): number {
  const pitch = Math.round(tuned);
  if (!bias) return pitch;
  const inScale = (p: number) => bias.pitchClasses.includes(((p % 12) + 12) % 12);
  if (inScale(pitch)) return pitch;
  const neighbour = pitch + (tuned >= pitch ? 1 : -1);
  return inScale(neighbour) && Math.abs(tuned - pitch) * 100 >= 50 - bias.cents ? neighbour : pitch;
}

// Other semitones the note could be, from its own audio: the neighbour when the note
// sits near halfway, then the semitones it starts and ends on when they differ from its
// name (a scoop that never settles, a fall-off). Pitches are relative to the singer's
// tuning. Measured, not decided: the note is still named by its median.
export function alternatives(tuned: number, frames: number[]): number[] {
  const pitch = Math.round(tuned);
  const found: number[] = [];
  if (Math.abs(tuned - pitch) * 100 >= AMBIGUOUS_CENTS) found.push(pitch + Math.sign(tuned - pitch));
  if (frames.length >= 8) {
    const quarter = Math.floor(frames.length / 4);
    for (const part of [frames.slice(0, quarter), frames.slice(-quarter)]) {
      const semitone = Math.round(median(part));
      if (semitone !== pitch && !found.includes(semitone)) found.push(semitone);
    }
  }
  return found;
}

// The pitch track's voiced frames inside the note (already smoothed by pYIN's HMM).
function noteCurve(
  n: DetectedNote,
  track: PitchTrack,
  audio?: { samples: Float32Array; sampleRate: number }
): NoteCurve {
  const curve: NoteCurve = { t: [], pitch: [], raw: [], db: [] };
  const end = n.time + n.duration;
  for (let i = firstAtOrAfter(track.times, n.time); i < track.times.length && track.times[i] < end; i++) {
    if (track.hz[i] <= 0) continue;
    const midi = toMidi(track.hz[i]);
    curve.t.push(track.times[i] - n.time);
    curve.pitch.push(midi);
    curve.raw.push(midi);
    if (audio) curve.db.push(levelAt(audio.samples, audio.sampleRate, track.times[i]));
  }
  return curve;
}

function levelAt(samples: Float32Array, sampleRate: number, time: number): number {
  const half = Math.round((LEVEL_WINDOW_SEC / 2) * sampleRate);
  const center = Math.round(time * sampleRate);
  const from = Math.max(0, center - half);
  const to = Math.min(samples.length, center + half);
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return to > from ? toDecibels(Math.sqrt(sum / (to - from))) : -Infinity;
}

function firstAtOrAfter(times: number[], time: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
