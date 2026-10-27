// The guide's backing track: a four-bar loop (drums, bass, pad and an arpeggio, C major:
// Cmaj9 Am9 A♭maj9 B♭6/9) that plays under the whole guide, built up and stripped back as the guide
// goes (`setLayers`: each step says what plays, and a crash marks the new step). It isn't part of the project: it doesn't
// show anywhere, isn't exported or recorded, and can't be edited.
//
// It keeps its own clock (the audio context's time, not Tone's transport), because the
// app stops and restarts the transport every time you press Play or Record. Instead, Play
// and Record start the transport *on the backing's beat* (`alignStart`, through
// audio/sync.ts), so what you play and sing lines up with it.
//
//   startBacking({ cutoff: 300 })      // after a click (audio needs one)
//   setCutoff(2000, 2)                 // open the low-pass over two bars, from the next bar
//   atNextBar((time) => …)             // run something on the next bar line
//   fadeOutBacking(1)                  // fade out over a bar, then stop
//
// Parts the song already plays are dropped while it plays (`covered`): add drums and play
// the song, and the backing's drums step aside for yours.
import * as Tone from 'tone';

export const BACKING_BPM = 126;
const LOOKAHEAD = 0.15; // seconds scheduled ahead
const STEPS_PER_BAR = 16;

// Cmaj9, Am9, A♭maj9, B♭6/9 (I – vi – ♭VI – ♭VII): each chord's notes (MIDI), and the bass
// root. The last two borrow from C minor, so ♭VII → I lands home strongly. G is held
// through all four; the other voices move by step.
const CHORDS: { notes: number[]; root: number }[] = [
  { notes: [64, 67, 71, 74], root: 48 },
  { notes: [64, 67, 71, 72], root: 45 },
  { notes: [63, 67, 70, 72], root: 44 },
  { notes: [62, 67, 70, 72], root: 46 }
];
const ARP = [0, 1, 2, 1]; // chord-note order, one per eighth, an octave up

// What plays: the guide builds the arrangement up (and strips it back) step by step.
export interface Layers {
  kick: 0 | 1 | 2; // off, half time (beats 1 and 3), four on the floor
  snare: boolean; // beats 2 and 4
  hats: 0 | 1 | 2; // off, off-beats, off-beats and sixteenths
  bass: boolean;
  pad: boolean;
  arp: boolean;
}
export const FULL: Layers = { kick: 2, snare: true, hats: 2, bass: true, pad: true, arp: true };
let layers: Layers = { ...FULL };
let pendingLayers: Layers | null = null;
let crashAt = -1; // the sixteenth a crash cymbal falls on (a new step)

export interface Coverage {
  drums: boolean;
  harmony: boolean;
}

interface Voices {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;
  crash: Tone.NoiseSynth;
  bass: Tone.MonoSynth;
  pad: Tone.PolySynth;
  arp: Tone.Synth;
  drums: Tone.Gain;
  bassBus: Tone.Gain;
  harmony: Tone.Gain;
  filter: Tone.Filter;
  out: Tone.Gain;
  click: Tone.Synth;
}

let v: Voices | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0; // when the next sixteenth plays (audio context seconds)
let step = 0; // which sixteenth that is, from the start
let chordShift = 0;
let pendingShift: { from: number; shift: number } | null = null;
let covered: () => Coverage = () => ({ drums: false, harmony: false });
let bpm: () => number = () => BACKING_BPM;
let cutoffNow = 300;

const now = () => Tone.getContext().currentTime;
const sixteenth = () => 60 / bpm() / 4;
export const barSeconds = () => (60 / bpm()) * 4;
const midi = (n: number) => Tone.Frequency(n, 'midi').toFrequency();

function build(): Voices {
  const out = new Tone.Gain(0).toDestination();
  const filter = new Tone.Filter({ type: 'lowpass', frequency: cutoffNow, Q: 0.8, rolloff: -24 }).connect(out);
  const drums = new Tone.Gain(1).connect(filter);
  const bassBus = new Tone.Gain(1).connect(filter);
  const harmony = new Tone.Gain(1).connect(filter);
  const snareTone = new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 0.7 }).connect(drums);
  const hatTone = new Tone.Filter({ type: 'highpass', frequency: 7500 }).connect(drums);
  const padVerb = new Tone.Gain(1).connect(harmony);
  return {
    out,
    filter,
    drums,
    bassBus,
    harmony,
    kick: new Tone.MembraneSynth({ pitchDecay: 0.035, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0 }, volume: -4 }).connect(drums),
    snare: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -10 }).connect(snareTone),
    crash: new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 1.4, sustain: 0 }, volume: -17 }).connect(hatTone),
    hat: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 }, volume: -20 }).connect(hatTone),
    bass: new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      filterEnvelope: { attack: 0.004, decay: 0.14, sustain: 0.15, release: 0.1, baseFrequency: 110, octaves: 2.6 },
      envelope: { attack: 0.004, decay: 0.18, sustain: 0.35, release: 0.08 },
      volume: -9
    }).connect(bassBus),
    pad: new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { attack: 0.35, decay: 0.4, sustain: 0.55, release: 1.1 },
      volume: -21
    }).connect(padVerb),
    arp: new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.003, decay: 0.16, sustain: 0, release: 0.08 }, volume: -15 }).connect(harmony),
    click: new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 }, volume: -6 }).toDestination()
  };
}

function chordFor(stepIndex: number) {
  const bar = Math.floor(stepIndex / STEPS_PER_BAR);
  return CHORDS[(((bar + chordShift) % 4) + 4) % 4];
}

function play(s: number, t: number) {
  if (!v) return;
  const inBar = s % STEPS_PER_BAR;
  if (inBar === 0) {
    if (pendingLayers) {
      layers = pendingLayers;
      pendingLayers = null;
    }
    if (pendingShift && s >= pendingShift.from) {
      chordShift = pendingShift.shift;
      pendingShift = null;
    }
    // What the song covers right now, from this bar.
    const c = covered();
    v.drums.gain.setTargetAtTime(c.drums ? 0 : 1, t, 0.01);
    v.harmony.gain.setTargetAtTime(c.harmony ? 0 : 1, t, 0.01);
  }
  const chord = chordFor(s);
  const sixteenthSec = sixteenth();
  const L = layers;
  if (s === crashAt) v.crash.triggerAttackRelease(1.2, t);
  // Drums: four on the floor (or half time), a snare on 2 and 4, hats on the off-beats
  // (and quiet sixteenths between).
  if (L.kick === 2 ? inBar % 4 === 0 : L.kick === 1 && inBar % 8 === 0) v.kick.triggerAttackRelease('C1', 0.2, t);
  if (L.snare && (inBar === 4 || inBar === 12)) v.snare.triggerAttackRelease(0.15, t);
  if (L.hats && inBar % 4 === 2) v.hat.triggerAttackRelease(0.04, t, 1);
  else if (L.hats === 2 && inBar % 2 === 1) v.hat.triggerAttackRelease(0.03, t, 0.35);
  // Bass: the root on the off-beat eighths, an octave jump at the end of the bar.
  if (L.bass && inBar % 4 === 2) v.bass.triggerAttackRelease(midi(chord.root + (inBar === 14 ? 12 : 0)), sixteenthSec * 1.6, t, 0.9);
  // Pad: the chord, held for the bar.
  if (L.pad && inBar === 0) v.pad.triggerAttackRelease(chord.notes.map(midi), barSeconds() * 0.95, t, 0.7);
  // Arpeggio: the chord's notes an octave up, on the eighths.
  if (L.arp && inBar % 2 === 0) v.arp.triggerAttackRelease(midi(chord.notes[ARP[(inBar / 2) % ARP.length]] + 12), sixteenthSec * 1.5, t, inBar % 4 === 0 ? 0.75 : 0.5);
}

function pump() {
  const horizon = now() + LOOKAHEAD;
  while (nextTime < horizon) {
    play(step, nextTime);
    nextTime += sixteenth();
    step++;
  }
}

export function backingRunning() {
  return timer !== null;
}

// Starts the loop (fading in over a bar) if it isn't playing. Call from a click handler
// the first time (browsers only start audio after one).
export async function startBacking(options: { cutoff?: number; covered?: () => Coverage; bpm?: () => number; layers?: Layers } = {}) {
  await Tone.start();
  if (options.covered) covered = options.covered;
  if (options.bpm) bpm = options.bpm;
  if (options.cutoff) cutoffNow = options.cutoff;
  if (options.layers && !timer) layers = { ...options.layers };
  v ??= build();
  if (timer) return;
  const t = now() + 0.05;
  v.filter.frequency.cancelScheduledValues(t);
  v.filter.frequency.setValueAtTime(cutoffNow, t);
  v.out.gain.cancelScheduledValues(t);
  v.out.gain.setValueAtTime(0, t);
  v.out.gain.linearRampToValueAtTime(0.9, t + barSeconds());
  nextTime = t;
  step = 0;
  chordShift = 0;
  pendingShift = null;
  timer = setInterval(pump, 25);
  pump();
}

export function stopBacking() {
  if (timer) clearInterval(timer);
  timer = null;
  if (v) {
    v.out.gain.cancelScheduledValues(now());
    v.out.gain.setValueAtTime(0, now());
    v.pad.releaseAll();
  }
}

// The next bar line at or after `after` (audio context seconds), and which sixteenth it is.
function nextBar(after: number): { time: number; step: number } {
  let s = Math.ceil(step / STEPS_PER_BAR) * STEPS_PER_BAR;
  let t = nextTime + (s - step) * sixteenth();
  while (t < after) {
    t += STEPS_PER_BAR * sixteenth();
    s += STEPS_PER_BAR;
  }
  return { time: t, step: s };
}

// When the next bar starts (now + `minAhead` at the earliest). Without the backing: now.
export function nextBarTime(minAhead = 0.05): number {
  return timer ? nextBar(now() + minAhead).time : now() + minAhead;
}

// Runs `fn` on the next bar line (+ `bars` more), as the music gets there.
export function atNextBar(fn: (time: number) => void, bars = 0): ReturnType<typeof setTimeout> {
  const time = nextBarTime(0.08) + bars * barSeconds();
  return setTimeout(() => fn(time), Math.max(0, (time - now()) * 1000 - 20));
}

// When to start Tone's transport so the song lines up with the backing: its bar lines on
// the backing's, and its bar `songTick` falls under the matching chord (bar 1: Cmaj9, bar
// 2: Am9…). `leadBars`: bars before `songTick` is reached (a count-in). Returns an audio
// context time to pass to transport.start().
export function alignStart(leadBars: number, songTick: number, barTicks: number): number {
  const barSec = barSeconds();
  const frac = (((songTick % barTicks) + barTicks) % barTicks) / barTicks;
  const rest = frac > 0 ? 1 - frac : 0; // seconds (in bars) until the song's next bar line
  const at = nextBar(now() + 0.2 + rest * barSec);
  const songBar = Math.floor(songTick / barTicks) + (frac > 0 ? 1 : 0); // the song's bar at that line
  const backingBar = at.step / STEPS_PER_BAR + leadBars;
  pendingShift = { from: at.step, shift: (((songBar - backingBar) % 4) + 4) % 4 };
  return at.time - rest * barSec;
}

// The arrangement from the next bar on; `crash`: a cymbal on that bar's first beat.
export function setLayers(next: Layers, crash = false) {
  if (!timer) {
    layers = { ...next };
    return;
  }
  pendingLayers = { ...next };
  if (crash) crashAt = nextBar(now() + 0.05).step;
}

// Opens (or closes) the low-pass to `hz` over `bars` bars, starting on the next bar.
export function setCutoff(hz: number, bars = 1) {
  cutoffNow = hz;
  if (!v || !timer) return;
  const from = nextBarTime(0.05);
  const f = v.filter.frequency;
  f.cancelScheduledValues(from);
  f.setValueAtTime(f.getValueAtTime(from), from);
  f.exponentialRampToValueAtTime(hz, from + bars * barSeconds());
}

// Fades out over `bars` bars from the next bar line, then stops. Resolves when it's silent.
export function fadeOutBacking(bars = 1): Promise<void> {
  if (!v || !timer) return Promise.resolve();
  const from = nextBarTime(0.05);
  const end = from + bars * barSeconds();
  v.out.gain.cancelScheduledValues(from);
  v.out.gain.setValueAtTime(v.out.gain.getValueAtTime(from), from);
  v.out.gain.linearRampToValueAtTime(0, end);
  return new Promise((resolve) =>
    setTimeout(() => {
      stopBacking();
      resolve();
    }, (end - now()) * 1000)
  );
}

// A short tick (the "sound is on" click).
export async function clickSound() {
  await Tone.start();
  v ??= build();
  v.click.triggerAttackRelease('A5', 0.08, now() + 0.01);
}

// Development: when this file is reloaded, the old copy stops (else two would play).
if (import.meta.hot) import.meta.hot.dispose(() => stopBacking());

// The backing's output node (for recording it, e.g. a trailer's music).
export function backingOutput(): Tone.Gain | null {
  return v?.out ?? null;
}
