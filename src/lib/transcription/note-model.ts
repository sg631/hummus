// Notes from the pitch track: Tony's note model (Mauch et al., TENOR 2015), from
// @audio/pitch-pyin 2.1.0 (notes.js, MIT, https://github.com/audiojs/pitch), changed where
// it failed on real singing:
//
// - Legato. Tony only changes note through a "silent" state, which voiced audio barely
//   fits, so a quick run or a slide between notes merged into one note (named by the
//   median of both: often neither). Here a held note can also move straight to another
//   pitch, which the decoder takes when the new pitch holds for a few frames.
// - Re-articulation. Tony starts a new note on any +3 dB jump within 12 ms, so loudness
//   wobble split notes and a soft consonant ("la la") didn't. Here a new note starts at a
//   dip in loudness: a valley at least DIP_DB below the level on both sides of it.
// - Each note says how it ended (`endedBy`): at a rest, a re-attack, or a slur into the
//   next pitch. Articulation is read from that (notes.ts).
//
// The model itself is Tony's: every note pitch, 3 per semitone, has an attack, a stable
// and a silent state. Attack and stable states emit the tracked pitch through a Gaussian
// of 5 and 0.8 semitones, so a scoop into a note and a ±½ semitone vibrato both stay
// inside it; silent states emit the unvoiced share. The next note's interval from the
// last is weighted by a Gaussian of 0.7 semitones (0 or 0.5…13 semitones apart).
import viterbi, { type ViterbiModel } from './viterbi.js';

const PPS = 3; // pitch states per semitone
const ATTACK = 0.9, STABLE = 0.99, SILENT = 0.9999; // self-transitions; stable → silent 0.01
const JUMP = 0.7, MIN_JUMP = 0.5, MAX_JUMP = 13;  // interval prior between notes, semitones
const SD_ATTACK = 5;                                // pitch spread of attack states, semitones
const VOICED = 0.9, PRIOR = 0.7, PRIOR_WEIGHT = 0.5; // tracked pitch enters with probability 0.9
const SD_STABLE = 0.8;                              // ...and of stable states
// Ours. A held note moves straight to another pitch with this probability per frame,
// shared by interval as the jump prior. Smaller holds notes longer before changing.
const LEGATO = 0.01;
const DIP_DB = 5;          // a valley this deep on both sides is a re-articulation
const DIP_SPAN_SEC = 0.15; // ...looking this far either side of it
const DIP_LOCAL_SEC = 0.02; // ...and the lowest point within this either side
// A note must hold a pitch: a short one joined to a neighbour by a slur whose middle still
// moves this much (semitones) is part of a glide (a scoop into the next note, a fall from
// the last), and joins that note. Legato lets a glide split, so this undoes it.
const GLIDE_SEMITONES = 0.5;
const GLIDE_MAX_SEC = 0.35;

export type NoteEnd = 'rest' | 'attack' | 'slur';

export interface TrackFrame {
  time: number; // seconds
  f0: number;   // Hz, 0 unvoiced
  prob: number; // voiced probability
  rms: number;  // level of the frame
}

export interface ModelNote {
  time: number;     // seconds
  duration: number; // seconds
  freq: number;     // Hz, median of the note's frame pitches
  clarity: number;  // mean voiced probability
  endedBy: NoteEnd; // a rest (silence or unvoiced) follows, a re-attack, or a slur to another pitch
}

const midi = (f: number) => 69 + 12 * Math.log2(f / 440);
const pdf = (x: number, sd: number) => Math.exp((-x * x) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));

// Note HMM over `count` pitches from `low` (MIDI) in steps of 1/3 semitone.
// States 3p + {0 attack, 1 stable, 2 silent}.
function noteModel(low: number, count: number) {
  const S = 3 * count;
  const reach = Math.ceil(MAX_JUMP * PPS) - 1;
  const w = 2 * reach + 1;
  const allowed = (d: number) => {
    const s = Math.abs(d) / PPS;
    return s === 0 || (s > MIN_JUMP && s < MAX_JUMP);
  };
  // lj: silent p → attack p + d (any allowed interval, including the same pitch: a re-attack).
  // ll: stable p → attack p + d (legato: another pitch only).
  const lj = new Float64Array(count * w).fill(-Infinity);
  const ll = new Float64Array(count * w).fill(-Infinity);
  for (let p = 0; p < count; p++) {
    let sum = 0;
    let sumOther = 0;
    for (let q = Math.max(0, p - reach); q <= Math.min(count - 1, p + reach); q++) {
      if (!allowed(q - p)) continue;
      sum += pdf((q - p) / PPS, JUMP);
      if (q !== p) sumOther += pdf((q - p) / PPS, JUMP);
    }
    for (let q = Math.max(0, p - reach); q <= Math.min(count - 1, p + reach); q++) {
      if (!allowed(q - p)) continue;
      const weight = pdf((q - p) / PPS, JUMP);
      lj[p * w + q - p + reach] = Math.log(((1 - SILENT) * weight) / sum);
      if (q !== p) ll[p * w + q - p + reach] = Math.log((LEGATO * weight) / sumOther);
    }
  }
  const la = Math.log(ATTACK), las = Math.log(1 - ATTACK);
  const ls = Math.log(STABLE - LEGATO), lss = Math.log(1 - STABLE);
  const lsil = Math.log(SILENT), init = Math.log(1 / count);

  // observation: MIDI pitch of a voiced frame, or NaN
  const obs = new Float64Array(S);
  const emit = (m: number) => {
    const pitched = (m === m ? VOICED : 0) * (1 - PRIOR_WEIGHT) + PRIOR * PRIOR_WEIGHT;
    const silent = Math.log((1 - pitched) / count);
    if (m === m) {
      let sum = 0;
      for (let p = 0; p < count; p++) {
        const mu = low + p / PPS;
        sum += obs[3 * p] = pdf(m - mu, SD_ATTACK);
        sum += obs[3 * p + 1] = pdf(m - mu, SD_STABLE);
      }
      const k = Math.log(pitched / sum);
      for (let p = 0; p < count; p++) {
        obs[3 * p] = Math.log(obs[3 * p]) + k;
        obs[3 * p + 1] = Math.log(obs[3 * p + 1]) + k;
      }
    } else {
      const v = Math.log(pitched / (2 * count));
      for (let p = 0; p < count; p++) obs[3 * p] = obs[3 * p + 1] = v;
    }
    for (let p = 0; p < count; p++) obs[3 * p + 2] = silent;
    return obs;
  };

  const model: ViterbiModel = {
    S,
    init(delta, o) {
      for (let s = 0; s < S; s++) delta[s] = s % 3 === 2 ? init + o[s] : -Infinity;
    },
    step(delta, next, psi, o) {
      for (let q = 0; q < count; q++) {
        const a = 3 * q, st = a + 1, sl = a + 2;
        let best = -Infinity, arg = a;
        const lo = Math.max(0, q - reach), hi = Math.min(count - 1, q + reach);
        for (let p = lo; p <= hi; p++) {
          if (p === q) {
            const v = delta[a] + la;
            if (v > best) { best = v; arg = a; }
          }
          const fromSilent = delta[3 * p + 2] + lj[p * w + q - p + reach];
          if (fromSilent > best) { best = fromSilent; arg = 3 * p + 2; }
          const fromStable = delta[3 * p + 1] + ll[p * w + q - p + reach];
          if (fromStable > best) { best = fromStable; arg = 3 * p + 1; }
        }
        next[a] = best + o[a]; psi[a] = arg;
        let x = delta[a] + las, y = delta[st] + ls;
        if (y > x) { next[st] = y + o[st]; psi[st] = st; } else { next[st] = x + o[st]; psi[st] = a; }
        x = delta[st] + lss; y = delta[sl] + lsil;
        if (y > x) { next[sl] = y + o[sl]; psi[sl] = sl; } else { next[sl] = x + o[sl]; psi[sl] = st; }
      }
    }
  };
  return { model, emit };
}

interface Decided extends TrackFrame {
  kind: number;  // 0 attack, 1 stable, 2 silent
  pitch: number; // pitch state index
}

// Streaming: push frames of the pitch track in order; each call returns the notes
// finished so far. `end()` finishes the rest.
export class NoteTracker {
  private queue: TrackFrame[] = [];
  private base = 0;
  private decode;
  private emit;
  private decided: Decided[] = []; // waiting for the level after them (re-articulation)
  private history: number[] = []; // levels (dB) of recent frames, oldest first
  private span: number;
  private local: number;
  private minFrames: number;
  private cur: { start: number; pitch: number; pitches: number[]; prob: number; slurredIn: boolean } | null = null;
  private held: Held | null = null;  // the last note, until the next one says how to join it
  private glide: Held | null = null; // glide pieces after it, until it's known where they lead
  private out: ModelNote[] = [];
  private frame = 0; // frames segmented

  constructor(
    private framesPerSec: number,
    minFreq: number,
    maxFreq: number,
    minDuration = 0.05
  ) {
    const low = Math.floor(midi(minFreq));
    const count = PPS * (Math.ceil(midi(maxFreq)) - low) + 1;
    const { model, emit } = noteModel(low, count);
    this.emit = emit;
    this.span = Math.round(DIP_SPAN_SEC * framesPerSec);
    this.local = Math.max(1, Math.round(DIP_LOCAL_SEC * framesPerSec));
    this.minFrames = minDuration * framesPerSec;
    this.decode = viterbi(model, (s, f) => {
      const r = this.queue[f - this.base];
      this.queue[f - this.base] = undefined!;
      if (f - this.base > 1024) {
        this.queue = this.queue.slice(f - this.base + 1);
        this.base = f + 1;
      }
      this.decided.push({ ...r, kind: s % 3, pitch: Math.floor(s / 3) });
      this.segmentReady();
    });
  }

  push(frame: TrackFrame): ModelNote[] {
    this.queue.push(frame);
    this.decode(this.emit(frame.f0 > 0 ? midi(frame.f0) : NaN));
    return this.take();
  }

  end(): ModelNote[] {
    this.decode.end();
    while (this.decided.length) this.segment(this.decided.shift()!, this.decided);
    if (this.cur) this.close(this.frame, 'rest');
    if (this.glide) {
      this.glide.note.endedBy = 'rest'; // can't slur into anything now
      this.finishGlide();
    }
    if (this.held) this.out.push(this.held.note);
    this.held = null;
    return this.take();
  }

  private take() {
    const found = this.out;
    this.out = [];
    return found;
  }

  // Frames are segmented once the level `span` frames after them is known.
  private segmentReady() {
    while (this.decided.length > this.span) this.segment(this.decided.shift()!, this.decided);
  }

  private segment(r: Decided, after: Decided[]) {
    const level = 20 * Math.log10(r.rms + 1e-9);
    const before = this.history;
    const dip = this.isDip(level, before, after.slice(0, this.span).map((a) => 20 * Math.log10(a.rms + 1e-9)));
    before.push(level);
    if (before.length > this.span) before.shift();

    const i = this.frame++;
    const sounding = r.kind < 2 && r.f0 > 0;
    if (!sounding || dip) {
      if (this.cur) this.close(i, dip ? 'attack' : 'rest');
      if (r.f0 <= 0) for (const h of [this.held, this.glide]) if (h) h.voicedSince = false;
      return;
    }
    if (this.cur && r.pitch !== this.cur.pitch && r.kind === 0) this.close(i, 'slur');
    if (!this.cur) this.cur = { start: i, pitch: r.pitch, pitches: [], prob: 0, slurredIn: this.joinsHeld(i, r.pitch) };
    this.cur.pitches.push(midi(r.f0));
    this.cur.prob += r.prob;
  }

  // Whether a note starting at frame `start` follows the held note without a break. A
  // note ended by the model's silent state while the voice kept sounding is decided now:
  // a slur if this is another pitch, else a re-attack.
  private joinsHeld(start: number, pitch: number): boolean {
    const h = this.glide ?? this.held;
    if (!h) return false;
    if (h.note.endedBy === 'rest' && h.voicedSince && (start - h.end) / this.framesPerSec < DIP_LOCAL_SEC * 3) {
      h.note.endedBy = pitch !== h.pitch ? 'slur' : 'attack';
    }
    return h.note.endedBy === 'slur';
  }

  // A valley in level: the lowest within ±local frames, and DIP_DB below the highest
  // level within `span` frames on each side.
  private isDip(level: number, before: number[], after: number[]): boolean {
    if (before.length < this.local || after.length < this.local) return false;
    for (let k = 1; k <= this.local; k++) {
      if (before[before.length - k] < level || after[k - 1] < level) return false;
    }
    return Math.max(...before) - level >= DIP_DB && Math.max(...after) - level >= DIP_DB;
  }

  private close(end: number, endedBy: NoteEnd) {
    const cur = this.cur!;
    this.cur = null;
    if (cur.pitches.length < this.minFrames) return;
    const note: Held = {
      note: {
        time: cur.start / this.framesPerSec,
        duration: (end - cur.start) / this.framesPerSec,
        freq: medianHz(cur.pitches),
        clarity: cur.prob / cur.pitches.length,
        endedBy
      },
      pitch: cur.pitch,
      pitches: cur.pitches,
      end,
      gliding: (end - cur.start) / this.framesPerSec <= GLIDE_MAX_SEC && movement(cur.pitches) >= GLIDE_SEMITONES,
      slurredIn: cur.slurredIn,
      voicedSince: true
    };

    if (note.gliding) {
      // consecutive glide pieces are one glide
      if (this.glide) {
        this.glide.note.duration = note.note.time + note.note.duration - this.glide.note.time;
        this.glide.note.endedBy = note.note.endedBy;
        this.glide.end = note.end;
        this.glide.pitches = [...this.glide.pitches, ...note.pitches];
      } else this.glide = note;
      if (this.glide.note.endedBy !== 'slur') this.finishGlide(); // else: decided by what it slurs into
      return;
    }
    if (this.glide) {
      const glide = this.glide;
      this.glide = null;
      if (approaches(glide.pitches, median(note.pitches))) {
        // a scoop (or passing glide) into this note
        note.note.duration += note.note.time - glide.note.time;
        note.note.time = glide.note.time;
        note.slurredIn = glide.slurredIn;
      } else this.keepGlide(glide); // it goes somewhere else first (a dip, a turn): a note of its own
    }
    this.hold(note);
  }

  // A glide that ended without slurring into a note: a fall (or glide) off the last
  // note, or, if it didn't come from one, a note of its own.
  private finishGlide() {
    const glide = this.glide!;
    this.glide = null;
    const h = this.held;
    if (glide.slurredIn && h && approaches([...glide.pitches].reverse(), median(h.pitches))) {
      h.note.duration = glide.note.time + glide.note.duration - h.note.time;
      h.note.endedBy = glide.note.endedBy;
      h.end = glide.end;
      h.voicedSince = true;
      return;
    }
    this.keepGlide(glide);
  }

  // A glide that isn't part of a neighbour: a note of its own, named by its pitches.
  private keepGlide(glide: Held) {
    glide.gliding = false;
    glide.note.freq = medianHz(glide.pitches);
    this.hold(glide);
  }

  private hold(note: Held) {
    if (this.held) this.out.push(this.held.note);
    this.held = note;
  }
}

interface Held {
  note: ModelNote;
  pitch: number;        // pitch state
  pitches: number[];    // its frames' pitches (MIDI)
  end: number;          // frame after the note
  gliding: boolean;     // short and still moving: part of a glide, not a note of its own
  slurredIn: boolean;   // reached from the note before by a slur
  voicedSince: boolean; // the voice kept sounding since it ended
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

// Whether a glide moves toward `target` from about as far as it ever gets: it starts
// within half a semitone of its farthest point (a scoop comes from below or above and
// arrives, maybe dipping a little first; a dip or a turn starts near the note and goes
// somewhere else). Read backwards, whether a fall moves away and keeps going.
function approaches(pitches: number[], target: number): boolean {
  const farthest = Math.max(...pitches.map((p) => Math.abs(p - target)));
  return Math.abs(pitches[0] - target) >= farthest - SCOOP_SLACK;
}
const SCOOP_SLACK = 0.5; // semitones

function medianHz(pitches: number[]): number {
  const sorted = [...pitches].sort((a, b) => a - b);
  return 440 * 2 ** ((sorted[sorted.length >> 1] - 69) / 12);
}

// How far the pitch moves across the middle half of a note (semitones), from a
// straight-line fit: a held pitch barely moves, a glide does.
function movement(pitches: number[]): number {
  const from = Math.floor(pitches.length / 4);
  const middle = pitches.slice(from, Math.max(from + 2, pitches.length - from));
  const n = middle.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = middle.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  middle.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return Math.abs((num / den) * (n - 1));
}
