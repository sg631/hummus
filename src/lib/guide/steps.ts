// The guide's steps, in order. Each step shows a headline and a hint, reveals parts of the
// studio (`reveal` / `hide`: the ids in PARTS), and moves on by itself once its `done()`
// is true (on the next bar line), or with Next for things that only need showing
// (`next: true`), or by a choice (`choices`). `enter()` runs as the step starts (record,
// play…). `music` and `cutoff` change the backing track from that step on: what plays,
// and how open its low-pass is.
//
// Parts are shown or hidden by GuideStage.svelte: big ones (the panels) it lays out
// itself; small ones are elements marked data-guide="<id>" in the components.
import { SvelteSet } from 'svelte/reactivity';
import { liveInput } from '$lib/state/live-input.svelte';
import { liveKeys, setComputerKeys } from '$lib/state/live-keys.svelte';
import { currentClip, project, selection } from '$lib/state/project.svelte';
import { recorder } from '$lib/state/recorder.svelte';
import { recordingSettings } from '$lib/state/settings.svelte';
import { playhead } from '$lib/state/playhead.svelte';
import { view } from '$lib/state/view.svelte';
import { ui } from '$lib/state/ui.svelte';
import { history } from '$lib/state/history.svelte';
import { noteKeys } from '$lib/music/keyboard';
import { barTicks } from '$lib/music/time';
import type { DrumTrack, MidiTrack, Track, VoiceTrack } from '$lib/music/types';
import { FULL, type Layers } from './backing';
import { currentEpoch, guide, loopRecord, playLoop, playSong, restartPlaying } from './guide.svelte';

export const PARTS = [
  // panels (GuideStage lays these out)
  'meter', 'editor', 'tracks', 'playlist', 'mixer', 'topbar',
  // the top bar
  'top.loop', 'top.input', 'top.mode', 'top.count', 'top.song', 'top.sound', 'top.extra', 'top.right',
  // track cards
  'track.instrument', 'track.mix', 'track.manage', 'track.poly', 'track.effects', 'add.melody', 'add.voice', 'add.drums',
  // the piano roll
  'roll.toolbar', 'roll.expression', 'roll.quantize', 'roll.lanes', 'roll.sheet'
] as const;
export type Part = (typeof PARTS)[number];

export interface GuideStep {
  id: string;
  title: string;
  hint: string | (() => string);
  reveal?: Part[];
  hide?: Part[];
  focus?: string; // a data-guide id to point at
  cutoff?: number; // the backing track's low-pass, Hz (opens as the guide goes on)
  music?: Partial<Layers>; // the backing's arrangement from here (changes on the last step's)
  enter?: () => void | Promise<void>;
  done?: () => boolean;
  next?: boolean; // a Next button instead of done()
  choices?: { label: string; to?: string }[]; // buttons: on to the next step, or to step `to`
}

const BARS = 4; // the guide's loop
const bar = () => barTicks(project.timeSignature);
const melody = () => project.tracks.find((t): t is MidiTrack => t.kind === 'midi');
const chordTrack = () => project.tracks.filter((t): t is MidiTrack => t.kind === 'midi')[1];
const voice = () => project.tracks.find((t): t is VoiceTrack => t.kind === 'voice');
const drums = () => project.tracks.find((t): t is DrumTrack => t.kind === 'drums');
const select = (t: Track | undefined) => t && (selection.trackId = t.id);
const shape = (t: MidiTrack | undefined, lengths = false) =>
  t ? currentClip(t).notes.map((n) => `${n.pitch}@${n.start}${lengths ? `+${n.duration}` : ''}`).sort().join(',') : '';

// Values a step compares against (what it was when the step started).
let before = '';
// Reactive, so a step's done() is checked again when something is seen.
const seen = new SvelteSet<string>();
const mark = (what: string, now: boolean) => {
  if (now && !seen.has(what)) seen.add(what);
  return seen.has(what);
};
let pitchesHeard = new Set<number>(); // pitch classes played on the keyboard this step
const heardPitches = () => {
  for (const p of liveKeys.sounding) pitchesHeard.add(p % 12);
  return pitchesHeard;
};
const holding = (pcs: number[]) => pcs.every((pc) => liveKeys.sounding.some((p) => p % 12 === pc));
let heardAt = 0; // the hum step: when a note was last heard, and for how long in all (ms)
let hummed = 0;

// Records a loop; on silence, says so and tries again. Stops trying if the step changes.
async function recordUntilHeard(passes: number) {
  const epoch = currentEpoch();
  for (;;) {
    const heard = await loopRecord(passes);
    if (heard || !guide.active || epoch !== currentEpoch()) return;
    guide.hint = 'Nothing heard. Sing a little louder, or closer to the mic. Again from the next bar.';
  }
}
async function recordStep(passes: number) {
  const epoch = currentEpoch();
  await recordUntilHeard(passes);
  if (epoch !== currentEpoch()) return;
  guide.hint = '';
  seen.add('recorded');
}

// The computer keys that play these notes (semitones above C4), in this layout.
function keysFor(semitones: number[]): string {
  const map = noteKeys(liveKeys.layout);
  return semitones.map((n) => Object.entries(map).find(([, v]) => v === n)?.[0].replace('Key', '') ?? '?').join(' ');
}
const chord = (notes: number[]) => keysFor(notes).split(' ').join(' + ');
const C_MAJOR = [0, 4, 7];
const A_MINOR = [0, 4, 9]; // C E A: A minor's notes, within one octave of keys
const A_MINOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const keyboardOn = () => {
  select(chordTrack() ?? melody());
  if (!liveKeys.computer) setComputerKeys(true);
};

export const STEPS: GuideStep[] = [
  // ---------- Your voice ----------
  {
    id: 'hear',
    title: 'Your voice.',
    hint: 'Hum a note or two. The letter is its name (notes go A B C D E F G, then round again); the number is which octave: higher numbers, higher notes. The bar shows how in tune it is: in the middle is in tune.',
    reveal: ['meter'],
    cutoff: 450,
    music: { kick: 1, snare: false, hats: 0, bass: false, pad: true, arp: false },
    enter: () => {
      void liveInput.start();
    },
    // About two seconds of humming in all (not necessarily in one go).
    done: () => {
      const t = performance.now();
      const on = liveInput.active && !!liveInput.reading;
      if (on && heardAt) hummed += Math.min(200, t - heardAt);
      heardAt = on ? t : 0;
      return hummed > 2000;
    }
  },
  {
    id: 'sing',
    title: 'Sing along.',
    hint: 'Music counts in beats, four to a bar: each square is a beat, each group a bar. The loop is four bars and goes round twice. Hum anything over it.',
    cutoff: 650,
    music: { kick: 2, hats: 1, bass: true },
    enter: () => recordStep(2),
    done: () => seen.has('recorded')
  },
  {
    id: 'notes',
    title: 'Your voice, as notes.',
    hint: 'Each block is a note: higher up is a higher pitch, longer is held longer. Sing again; each note lands here as you go.',
    reveal: ['editor'],
    cutoff: 900,
    music: { snare: true },
    enter: () => recordStep(1),
    done: () => seen.has('recorded')
  },
  {
    id: 'roll',
    title: 'Reading the piano roll.',
    hint: 'The keyboard on the left names the rows: C4 is middle C. Thin lines are beats, darker ones bars, numbered along the top. Shaded rows are notes outside the song’s key (A minor): they tend to clash.',
    hide: ['meter'],
    cutoff: 1000,
    enter: () => playLoop(),
    next: true
  },
  {
    id: 'quantize',
    title: 'Quantize snaps timing to the grid.',
    hint: 'The grid: the beats, split into smaller steps. Set it to Off and listen (your timing as sung), then back to Auto.',
    reveal: ['roll.quantize'],
    focus: 'roll.quantize',
    cutoff: 1200,
    music: { hats: 2 },
    enter: () => playLoop(),
    done: () => {
      const source = melody() && currentClip(melody()!).source;
      if (!source) return true; // nothing to re-quantize: nothing to show
      return mark('off', source.quantize.grid === 0) && source.quantize.grid !== 0;
    }
  },
  {
    id: 'edit',
    title: 'Notes can be moved.',
    hint: 'Drag a note up, down or sideways.',
    cutoff: 1400,
    enter: () => {
      before = shape(melody());
    },
    done: () => shape(melody()) !== before
  },
  {
    id: 'undo',
    title: 'Undo.',
    hint: 'Ctrl+Z takes back the last change, anywhere in the app. Ctrl+Y brings it back.',
    done: () => history.redoLabel !== null
  },

  // ---------- Tracks ----------
  {
    id: 'tracks',
    title: 'Tracks.',
    hint: 'Each track plays one instrument. Pick another sound for this one.',
    reveal: ['tracks', 'track.instrument', 'topbar'],
    focus: 'track.instrument',
    cutoff: 1800,
    music: { arp: true },
    enter: () => {
      before = melody()?.instrument ?? '';
    },
    done: () => (melody()?.instrument ?? '') !== before
  },
  {
    id: 'transport',
    title: 'Play and Record.',
    hint: 'Stop, then Play again. Space does the same. Record records into the selected track.',
    focus: 'top.play',
    done: () => mark('stopped', !ui.playing) && ui.playing
  },
  {
    id: 'mix',
    title: 'Track controls.',
    hint: 'M mutes the track, S solos it. Volume and Pan are knobs: drag up or down. Mute it, then unmute it.',
    reveal: ['track.mix'],
    focus: 'track.mix',
    cutoff: 2200,
    done: () => mark('muted', !!melody()?.mute) && !melody()?.mute
  },
  {
    id: 'expression',
    title: 'Expression.',
    hint: 'Each note can slide, glide and wobble. Click a note, then turn up Vibrato.',
    reveal: ['roll.expression'],
    focus: 'roll.expression',
    cutoff: 2800,
    done: () => !!melody()?.clips.some((c) => c.notes.some((n) => (n.expression?.vibrato?.cents ?? 0) > 0))
  },
  {
    id: 'editor',
    title: 'The rest of the editor.',
    hint: 'The toolbar: which clip, Snap, zoom, the selected note. The lane at the bottom: velocity (how hard each note plays), pitch bend, mod wheel. Click empty space to add a note.',
    reveal: ['roll.toolbar', 'roll.lanes'],
    next: true
  },

  // ---------- The song ----------
  {
    id: 'playlist',
    title: 'Playlist.',
    hint: 'The song: clips arranged in time, bar by bar. Click bar 5 on the Melody lane to place your clip again.',
    reveal: ['playlist'],
    cutoff: 3500,
    done: () => !!melody()?.placements.some((p) => p.start >= BARS * bar())
  },
  {
    id: 'another',
    title: 'Another track.',
    hint: 'Press + Melody.',
    reveal: ['add.melody'],
    focus: 'add.melody',
    enter: () => {
      // The song now: eight bars, round and round.
      project.loop = { start: 0, end: 2 * BARS * bar(), enabled: true };
      return playSong();
    },
    done: () => !!chordTrack()
  },
  {
    id: 'poly',
    title: 'Polyphony.',
    hint: 'A track plays one note at a time unless it allows more. Several notes at once make a chord. Turn on Allow Polyphony.',
    reveal: ['track.poly'],
    focus: 'track.poly',
    done: () => !!chordTrack()?.poly
  },
  {
    id: 'chord',
    title: 'Your keyboard plays notes.',
    hint: () => `Hold ${chord(A_MINOR)} together: an A minor chord, the backing’s first.`,
    cutoff: 4500,
    music: { pad: false },
    enter: keyboardOn,
    done: () => mark('chord', liveKeys.sounding.length >= 3)
  },
  {
    id: 'chords',
    title: 'Record chords.',
    hint: () => `Press Record. After the count-in, play chords (${chord(A_MINOR)}, or any three keys) and press Stop when the loop has gone round.`,
    reveal: ['top.input'],
    focus: 'top.record',
    enter: () => {
      select(chordTrack());
      recordingSettings.input = 'keys';
      view.play = 'pattern';
    },
    done: () => {
      const t = chordTrack();
      if (!t || recorder.recording) return false;
      const notes = currentClip(t).notes;
      return notes.some((a) => notes.filter((b) => b.start < a.start + a.duration && a.start < b.start + b.duration).length >= 2);
    }
  },
  {
    id: 'topbar',
    title: 'The top bar.',
    hint: 'Pattern plays the selected track’s clip on a loop; Song plays everything. Switch to Song and press Play.',
    reveal: ['top.mode', 'top.count', 'top.song', 'top.sound', 'top.extra', 'top.right', 'top.loop'],
    focus: 'top.mode',
    cutoff: 6000,
    music: { pad: true },
    enter: () => {
      recordingSettings.input = 'voice';
      const t = chordTrack();
      if (t) currentClip(t).duration = Math.max(currentClip(t).duration, BARS * bar());
    },
    done: () => view.play === 'song' && ui.playing && !playhead.pattern
  },
  {
    id: 'loop',
    title: 'Loop.',
    hint: '⟳ repeats the loop region: the band along the top of the playlist’s ruler. Drag its right end to make it shorter.',
    focus: 'top.loop',
    enter: () => {
      before = JSON.stringify(project.loop);
    },
    done: () => JSON.stringify(project.loop) !== before
  },
  {
    id: 'voice',
    title: 'Voice tracks keep the recording itself.',
    hint: 'Press + Voice, then Record, and sing over the song. Stop when you’re done.',
    reveal: ['add.voice'],
    focus: 'add.voice',
    cutoff: 8000,
    enter: () => {
      view.play = 'song';
      if (project.loop) project.loop.enabled = true;
    },
    done: () => !!voice()?.clips.length && !recorder.recording
  },
  {
    id: 'drums',
    title: 'Drums.',
    hint: 'Press + Drums, then click the Kick row on every fourth step (1, 5, 9, 13). Play the song: the backing’s drums step aside for yours.',
    reveal: ['add.drums'],
    focus: 'add.drums',
    cutoff: 11000,
    done: () => {
      const t = drums();
      if (!t) return false;
      const kick = t.rows.find((r) => r.sound === 'kick');
      return !!kick && t.patterns.some((p) => (p.steps[kick.id] ?? []).filter(Boolean).length >= 4);
    }
  },
  {
    id: 'mixer',
    title: 'Mixer.',
    hint: 'Every track side by side: level, pan, effects, sends. Add a Reverb to the Voice track.',
    reveal: ['mixer', 'track.effects'],
    hide: ['editor'],
    cutoff: 15000,
    enter: () => playSong(),
    done: () => project.tracks.some((t) => t.effects.some((e) => e.type === 'reverb'))
  },
  {
    id: 'automation',
    title: 'Automation.',
    hint: 'Any knob can move over time. In the playlist, press + Lane, then Ctrl+drag a knob (a track’s Volume) onto the new lane.',
    hide: ['mixer'],
    reveal: ['track.manage'],
    done: () => project.automation.some((l) => l.target)
  },
  {
    id: 'draw',
    title: 'Draw the movement.',
    hint: 'Drag along the lane to draw how the knob moves. Play to hear it.',
    cutoff: 20000,
    done: () => project.automation.some((l) => l.target && l.points.length >= 2)
  },

  // ---------- Music theory (can be skipped) ----------
  {
    id: 'theory',
    title: 'Music theory, in a few minutes.',
    hint: 'What’s behind what you’ve made: notes, scales, chords and rhythm, played on your keyboard. Or skip to sheet music.',
    reveal: ['editor'],
    hide: ['playlist'],
    choices: [{ label: 'Learn the basics' }, { label: 'Skip to sheet music', to: 'sheet' }]
  },
  {
    id: 'pitch',
    title: 'Twelve notes.',
    hint: () => `Up the keyboard: C C♯ D D♯ E F F♯ G G♯ A A♯ B, then C again. Play them in turn: ${keysFor([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])}. The track’s piano roll lights up each key.`,
    music: { kick: 2, snare: false, hats: 1, bass: true, pad: false, arp: false },
    enter: () => {
      keyboardOn();
      view.sheet = false;
      pitchesHeard = new Set();
    },
    done: () => heardPitches().size >= 10
  },
  {
    id: 'octave',
    title: 'Semitones and octaves.',
    hint: () => `Each key is a semitone up from the last; ♯ (sharp) is a semitone up, ♭ (flat) a semitone down, so C♯ and D♭ are the same key. Twelve semitones make an octave: the same note, higher. Press X (an octave up), then play ${keysFor([0])}. Z comes back down.`,
    enter: keyboardOn,
    done: () => mark('up', liveKeys.octave !== 0) && liveKeys.octave !== 0 && liveKeys.sounding.length > 0
  },
  {
    id: 'scale',
    title: 'Scales and keys.',
    hint: () => `A scale picks seven of the twelve that sound right together. This song is in A minor: A B C D E F G, no sharps or flats. Play them: ${keysFor(A_MINOR_SCALE)}. The piano roll shades every note outside it.`,
    enter: () => {
      keyboardOn();
      liveKeys.octave = 0;
      pitchesHeard = new Set();
    },
    done: () => A_MINOR_SCALE.every((n) => heardPitches().has(n))
  },
  {
    id: 'triads',
    title: 'Chords: major and minor.',
    hint: () => `A chord stacks every other note of the scale: three notes, a triad. Hold ${chord(C_MAJOR)}: C major, bright. Then ${chord(A_MINOR)}: A minor, darker. They share two notes; one note makes the difference.`,
    enter: keyboardOn,
    done: () => mark('major', holding(C_MAJOR)) && mark('minor', holding(A_MINOR))
  },
  {
    id: 'progression',
    title: 'Chord progressions.',
    hint: 'The backing plays four chords, one a bar: A minor, F, C, G, then round again (listen to the bass: each chord’s root). A melody note that’s in the chord under it sounds settled; others pull towards one.',
    music: { kick: 0, hats: 0, bass: true, pad: true, arp: true },
    next: true
  },
  {
    id: 'rhythm',
    title: 'Beats, bars and tempo.',
    hint: 'The beat is the pulse you’d tap your foot to. 4/4 (the time signature): four beats to a bar; 3/4 has three, like a waltz. Tempo is beats per minute (BPM): this song is at 126. Scroll the BPM box or type a new one; the backing follows.',
    focus: 'top.song',
    music: { kick: 2, snare: true, hats: 2, bass: false, pad: false, arp: false },
    enter: () => {
      before = String(project.bpm);
    },
    done: () => String(project.bpm) !== before
  },

  // ---------- Sheet music ----------
  {
    id: 'sheet',
    title: 'Sheet music.',
    hint: 'The same notes, written the way musicians read them. Press Sheet in the editor’s toolbar.',
    reveal: ['editor', 'roll.sheet'],
    hide: ['playlist'],
    focus: 'roll.sheet',
    music: { ...FULL },
    enter: () => {
      select(melody());
      view.sheet = false;
      return restartPlaying('song'); // in time with the backing again (if the tempo changed)
    },
    done: () => view.sheet
  },
  {
    id: 'staff',
    title: 'The staff.',
    hint: 'Five lines: higher on them is higher in pitch. The clef at the start says which line is which (treble clef: the lines are E G B D F from the bottom, the spaces F A C E). Then the key signature (♯s or ♭s; A minor has none) and the time signature (4/4). Bar lines split the bars; the bar playing is red.',
    enter: () => {
      select(melody());
      view.sheet = true;
    },
    next: true
  },
  {
    id: 'lengths',
    title: 'Note lengths.',
    hint: 'Whole note (hollow, no stem): 4 beats. Half (hollow, with a stem): 2. Quarter (filled): 1. Eighth (one flag, or beamed together): ½. Sixteenth (two flags or beams): ¼. A dot adds half again; a curved tie joins two notes into one. Rests are silences of the same lengths.',
    music: { arp: false },
    next: true
  },
  {
    id: 'sheet-edit',
    title: 'Change it, see it.',
    hint: 'Press Piano roll, drag a note’s right end to make it longer, then press Sheet again.',
    music: { arp: true },
    enter: () => {
      select(melody());
      before = shape(melody(), true);
    },
    done: () => view.sheet && shape(melody(), true) !== before
  },

  {
    id: 'end',
    title: 'That’s the studio.',
    hint: () => `Saved as “${project.name}”. Also here: the menus (File, Edit, View, Help), export to WAV or MP3, panels you can drag and dock, and Help → Keyboard shortcuts.`,
    next: true
  }
];

// The arrangement at a step: every change up to it, over the full band.
export function musicAt(step: number): Layers {
  const m: Layers = { kick: 2, snare: false, hats: 1, bass: true, pad: true, arp: false };
  for (const s of STEPS.slice(0, step + 1)) Object.assign(m, s.music);
  return m;
}

// A new step: forget what the last one saw happen (`before` stays: Undo compares with
// what the step before it started with).
export function newStepMemory() {
  seen.clear();
  pitchesHeard = new Set();
  heardAt = 0;
  hummed = 0;
}
