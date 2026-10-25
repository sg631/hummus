# hum-daw: how the code fits together

A music maker for people who don't know music: sing a melody and it becomes notes, add
chords from a list, a drum loop, your voice on top, effects, and play it all back.

## Running it

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173. Restart it after installing or removing packages, or moving pages. |
| `npm test` | Run the tests (`*.test.ts` files). |
| `npm run check` | Type-check everything. Run it when something looks wrong: it often says exactly what. |

Pages: `/` is the app. `/bench` is the transcription test bench (record a take and see
exactly what transcription made of it).

## The folders

Everything is in `src/lib/`, in layers. A layer may only use the layers above it in this
table, never below:

| Folder | What it is |
|---|---|
| `music/` | The data (what a note, a track, a project is) and pure logic on it: time, rhythm, chords, MIDI export. No sound, no screen. |
| `audio/` | Making sound with Tone.js: the engine, instruments, the mixer, the metronome. |
| `transcription/` | Voice → notes. A black box: use only what `transcription/index.ts` exports. |
| `state/` | The app's shared, live data: the project, what's selected, the recorder, the mic. |
| `components/` | The screen, in pieces. `components/app/` is the app; `components/ui/` are ready-made buttons, sliders, switches. |
| `src/routes/` | Pages. `+page.svelte` (the app) only arranges components. |

## The data: a project

All in `src/lib/music/types.ts`.

```
Project            name, bpm, timeSignature
└─ tracks: Track[]   each has id, name, volume (dB), mute, effects { reverb, delay }
   ├─ MidiTrack      kind 'midi'   instrument ('piano' …)   clips: NoteClip[]
   │   └─ NoteClip   start (ticks)  notes: Note[]
   │       └─ Note   pitch (MIDI number, 60 = middle C), start + duration (ticks), velocity
   ├─ VoiceTrack     kind 'voice'  clips: VoiceClip[]   (recorded audio, not transcribed)
   └─ DrumTrack      kind 'drums'  steps[sound][step]   (on/off grid, 16 steps per bar)
```

**Time is in ticks:** 480 per quarter note (`PPQ` in `music/time.ts`). A note at tick 960
is on beat 3 whatever the tempo, so changing `bpm` speeds everything up without moving
notes. Only transcription works in seconds.

**Tell track kinds apart with `kind`:** inside `if (track.kind === 'midi') { … }`,
TypeScript knows the track has `clips` and `instrument`.

## How things happen

**Recording a melody**
1. Record (`components/app/TransportBar.svelte`) calls `recorder.start(…)`. That's
   `state/recorder.svelte.ts`, done for you: count-in, metronome, mic.
2. Stop calls `recorder.stop()`, which returns `{ take, bpm, timeSignature }`.
3. `takeToClip(take, bpm, timeSignature)` turns the take into a `NoteClip`. That's
   `$lib/transcription`, done for you: notes, expression, rhythm quantized.
4. `addNoteClip(track.id, clip)` (`state/project.svelte.ts`) puts it on the track. The
   piano roll shows it, because it reads the project.

**Recording a voice track:** the same steps 1–2, then keep `take.audio` as a `VoiceClip`
instead (`addVoiceClip`). Pass `playAlong` to `recorder.start` to hear the other tracks
while you sing.

**Playing:** `playProject(project)` (`audio/mixer.ts`) builds a chain per track and
schedules its notes on Tone's transport, then starts it:
```
instrument / recording / drums → reverb → delay → channel (volume, mute) → speakers
```

**Chords:** `chordClip(key, numerals, timeSignature)` (`music/chords.ts`) makes an ordinary
`NoteClip`, put on a new MIDI track. The piano roll and the mixer then treat chords like any
other notes.

## Svelte in five minutes

A `.svelte` file is a component: a `<script>` (TypeScript), then markup (HTML), styled with
Tailwind classes (`class="flex gap-2 p-3"`).

| You write | It means | Example |
|---|---|---|
| `let x = $state(0)` | a value the screen follows: change it, and the screen updates | `TransportBar.svelte` (`playing`) |
| `const y = $derived(x * 2)` | a value kept up to date from others | `+page.svelte` (`track`) |
| `let { track } = $props()` | data passed in by the parent: `<PianoRoll {track} />` | `PianoRoll.svelte` |
| `{expression}` in markup | show a value | `{project.bpm} BPM` |
| `{#if a}…{:else if b}…{:else}…{/if}` | show one thing or another | `+page.svelte` |
| `{#each list as item (item.id)}…{/each}` | repeat for each item | `TrackList.svelte` |
| `onclick={() => doIt()}` | run code on click (also `onpointerdown`, `onkeydown` …) | `TrackList.svelte` |
| `bind:value={obj.field}` | keep an input and a value in sync (`bind:checked` for switches) | the bench's sliders |

**Shared state** lives in `.svelte.ts` files in `state/`: `export const project = $state({…})`.
Any component that imports it and reads `project.tracks` updates when it changes, and
changing it directly (`track.mute = true`, `project.tracks.push(t)`) is fine.

**Ready-made controls:** `Button`, `Slider`, `Switch`, `Label`, `Select`, `Tabs`… in
`components/ui/`. The bench (`routes/bench/+page.svelte`) shows how to use Button, Slider,
Switch and ToggleGroup.

## What's done and what's yours

**Done**
- `transcription/`: voice → notes, `takeToClip`.
- `music/time.ts`, `quantize.ts`, `rhythm.ts`, `midi.ts`, `articulation.ts`, `tuning.ts`.
- `audio/engine.ts`, `metronome.ts`, `playback.ts`.
- `state/recorder.svelte.ts`, `live-input`, `latency`, `audio-devices`.
- `music/types.ts`: the data model.

**Yours.** Every `TODO(you)` comment says what to write. Search the project for
`TODO(you)`. Functions you haven't written yet throw `Error: TODO: …`, so the browser
console (F12) tells you exactly what's missing when you click something.

## Build order

Each step works on its own, so check it in the browser before moving on. If time runs
out, cut from the bottom.

1. **Tracks.** `state/project.svelte.ts`: `addMidiTrack`, `addVoiceTrack`, `addDrumTrack`,
   `removeTrack`. Then `TrackList.svelte`: the add buttons' `onclick`, and mute, volume,
   instrument and delete per row. *Check:* adding tracks shows rows, clicking selects.
2. **Record a melody.** `addNoteClip`, then `toggleRecord` in `TransportBar.svelte`.
   *Check:* sing, stop, and notes appear in the piano roll.
3. **Play it.** `audio/instruments.ts` (`createInstrument`), then `audio/mixer.ts`
   (`buildChain`, `scheduleProject`, `playProject`, `stopProject`), Play / Stop in
   `TransportBar`, and a BPM slider. *Check:* you hear the melody; BPM changes its speed.
3a. **Effects.** Reverb and delay sliders in `TrackList` (the mixer reads them).
4. **Voice track.** `addVoiceClip`, the voice branch of `toggleRecord`, the voice part of
   `scheduleProject`, then `playAlong`.
5. **Chords.** `chordClip` in `music/chords.ts`, then `ChordPicker.svelte`.
6. **Drums.** `createDrum`, the drums part of `scheduleProject`, then `DrumGrid.svelte`.
7. **Piano roll editing.** The steps listed in `PianoRoll.svelte`.
8. **Save and load.** `saveProject` / `loadProject`, a Save button, and loading on start.
9. **MIDI export** (nice). `clipsToMidi` in `music/midi.ts` takes clips: collect all MIDI
   tracks' clips and offer a download (`downloadBlob` in `$lib/download.ts`).

## Gotchas

- **Audio only starts after a click.** Browsers block sound until the user clicks; call
  `initAudio()` (or `playProject`, which does) from a click handler.
- **Put copies into the project, not live values.** `$state.snapshot(x)` makes a plain copy.
- **Scheduling uses ticks as `${ticks}i`.** Tone reads `'960i'` as "tick 960".
- **Stop before playing again.** Otherwise the old Parts keep playing on top:
  `playProject` should call `stopProject` first.
- **Restart `npm run dev`** after installing packages or moving pages, or you get old pages
  and 500 errors.
- **Read errors in the browser console (F12)**, and run `npm run check` for type errors.

## Who wrote what

Earlier sessions with Claude also built parts of `audio/`, `state/` and `components/`
(audio devices, latency calibration, the metronome, the tuner): check those against your
own records and the git history. From this session, AI-written: everything in
`transcription/`; `music/quantize.ts`, `rhythm.ts`,
`articulation.ts`; `state/recorder.svelte.ts` (moved from the bench); the data model in
`music/types.ts`; the starter files in `components/app/`, `state/project.svelte.ts`,
`audio/mixer.ts`, `audio/instruments.ts` and `music/chords.ts`, which are structure and
TODO notes only, their bodies are yours; and this guide.
