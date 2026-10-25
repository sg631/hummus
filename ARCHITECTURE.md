# hum-daw: how the code fits together

A music maker for people who don't know music: sing a melody and it becomes notes, add a
drum loop, your voice on top, effects, and play it all back.

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
| `music/` | The data (what a note, a track, a project is) and pure logic on it: time, rhythm, MIDI export. No sound, no screen. |
| `audio/` | Making sound with Tone.js: the engine, instruments, the mixer, the metronome. |
| `transcription/` | Voice → notes. A black box: use only what `transcription/index.ts` exports. |
| `state/` | The app's shared, live data: the project, what's selected, the recorder, the mic. |
| `components/` | The screen, in pieces. `components/app/` is the app; `components/ui/` are ready-made buttons, sliders, switches. |
| `src/routes/` | Pages. `+page.svelte` (the app) only arranges components. |

## The data: a project

All in `src/lib/music/types.ts`.

```
Project            name, bpm, timeSignature, key, scale, detune (cents)
├─ instruments: InstrumentPreset[]   your presets: id, name, engine ('fm' …), params
└─ tracks: Track[]   each has id, name, volume (dB), pan (-1…1), mute, solo, swing, effects: Effect[]
   │   └─ Effect     type ('reverb', 'chorus' …), enabled, params { decay: 2, mix: 0.3 … }
   ├─ MidiTrack      kind 'midi'   instrument (a preset id: 'piano' …)   poly?   clips: NoteClip[]
   │   │             placements: Placement[] (the playlist)   current (the clip being edited)
   │   └─ NoteClip   start (ticks)  notes: Note[]   source? (recorded: notes as sung, quantize
   │                 settings, the singer's tuning)   pitchTrack? (the pitch heard, frame by frame)
   │       └─ Note   pitch (MIDI number, 60 = middle C), start + duration (ticks), velocity
   ├─ VoiceTrack     kind 'voice'  clips: VoiceClip[]   (recorded audio; edit?: trims, speed,
   │                                                     pitch, gain, fades, reverse)
   └─ DrumTrack      kind 'drums'  rows: DrumRow[]   patterns: DrumPattern[]   placements   current
       ├─ DrumRow    sound ('kick', 'clap' …), volume, pan, swing?, mute, effects (an instrument)
       └─ DrumPattern name, bars (1–8), steps { rowId: on/off per sixteenth }

Placement          clipId (a NoteClip or DrumPattern), start (ticks), length? (longer loops it)
```

**Time is in ticks:** 480 per quarter note (`PPQ` in `music/time.ts`). A note at tick 960
is on beat 3 whatever the tempo, so changing `bpm` speeds everything up without moving
notes. Only transcription works in seconds.

**Tell track kinds apart with `kind`:** inside `if (track.kind === 'midi') { … }`,
TypeScript knows the track has `clips` and `instrument`.

**Not in the project:** recording settings (count-in, metronome, play-along, how a take
becomes notes) are in `state/settings.svelte.ts`, saved in the browser separately: they're
how you like to record, whatever the song.

## How things happen

**Pattern / Song** (the switch next to Play; `view.play`): **Song** plays the whole
arrangement from the playhead. **Pattern** loops just the selected track's current clip
or drum pattern (a voice track: `loopBars` bars from the playhead's bar), built by
`patternProject` and played with the transport looping.
- **Recording in Song mode** starts at the playhead's bar with everything else playing
  along (`shiftProject` makes the song start there); the take becomes a new clip placed
  there (or fills the current clip if it's empty and placed there), or a new recording at
  that bar on a voice track.
- **Loop record (Pattern mode)**: the loop keeps repeating while you sing, and you hear
  the layers so far. Every pass is a layer (`music/looper.ts`): a melody's notes from all
  passes are folded onto the loop and added to the clip (`foldNotes`); a voice take is cut
  into one recording per pass, stacked at the loop's start (`slicePasses`). One pass into
  an empty clip is an ordinary take (quantize bar, redo take…). Ctrl+Z undoes it.
- Settings → Recording → Looper length: the loop for an empty clip or a voice track.

**The playlist** (`Playlist.svelte`, the Playlist tab; `music/arrange.ts`): the whole song,
one lane per track. A clip's notes (or a drum pattern's steps) are stored once on its
track; the playlist holds only placements (`{ clipId, start, length? }`), so copying a
block adds a few bytes, not another copy of the notes, and editing a clip changes every
block of it ("Make unique" copies one when it should differ). A block longer than its
clip loops it; shorter cuts it off. `expandPlacements` turns placements into plain clips
for the mixer and MIDI export.
- Click a lane: place the track's current clip. Drag: move (snap: bar, beat, off; Alt:
  beat). Ctrl-drag: a copy. Right edge: length. Double-click: edit that clip. Right-click:
  copy after it, make unique, one-loop length, delete. Delete key, ruler, middle-drag,
  Ctrl + wheel as in the piano roll.
- Melody tracks start with one clip placed at bar 1. The piano roll edits one clip (the
  clip picker: pick, +, ⧉ copy, ✎ rename, ✕ delete), drawn from its own start; its ruler
  and Paste work in song time from the clip's first placement. Recording (and Redo take)
  fills the current clip, so every block of it plays the new take.
- Drum tracks with nothing placed loop their current pattern for the whole song; once
  patterns are placed, only placements play. Voice recordings show as blocks (drag to
  move; Ctrl-drag copies, sharing the same audio).
- Older saves are upgraded on load (clip positions become placements; drum steps move
  into a pattern).

**Right-click menus** (`state/context-menu.svelte.ts`, `ContextMenu.svelte`): one menu for
the whole app. `use:contextMenu={() => items}` on any element gives it a menu, worked out
when it opens. Knobs (reset to default, min, max, type a value), track cards, effects,
notes, the piano roll's empty space and ruler, drum rows, voice recordings and the track
list all have one. The browser's own menu is off except in text fields. Inner menus win
over outer ones (the action is a native listener that stops the event).

**Scrollbars**: thin, rounded, theme-coloured (`routes/layout.css`).

**Dropdowns**: every dropdown is `Dropdown.svelte` (shadcn-svelte's Select): give it
`options` (`{ value, label, group? }`) and `bind:value`. Grouped options get headings.
"+ Add sound" in the drum grid is a shadcn dropdown menu. No browser `<select>`s are left.

**Tracks** (`state/project.svelte.ts`, `components/app/TrackList.svelte`)
- `+ Melody`, `+ Voice`, `+ Drums` call `addMidiTrack()`, `addVoiceTrack()`,
  `addDrumTrack()`. Each builds a track object, pushes it onto `project.tracks` and selects
  it. Because `project` is `$state`, the new row appears by itself.
- Each row's controls are bound straight to the track: `bind:checked={track.mute}`,
  `bind:value={track.volume}` and `bind:value={track.pan}` (knobs)… Turning a knob changes
  the project, nothing else. An `$effect` in `TrackList` then calls `applyMix(project)`, which
  copies those values onto the sound that's playing, so you hear changes straight away.
- ✕ calls `removeTrack(id)`; ⧉ `duplicateTrack(id)` (a copy right after it: instrument,
  settings, effects, notes). Double-click the name (or right-click → Rename) to rename.
- **M** mutes; **S** solos: when any track is soloed, only soloed tracks play (worked out
  in `applyMix`, not with Tone's own solo, which would also silence drum rows).
- **Swing** knob on melody and drum tracks: only that track swings. Melody notes on
  off-beats are pushed late when scheduled (`swingTicks` in `music/drums.ts`).
- **Allow Polyphony (multiple notes)** (melody tracks): `track.poly`. The instrument becomes a
  `Tone.PolySynth` of its engine (samplers always are), so notes can overlap; sung bends
  and slurs don't play on it. Edit it in the piano roll as usual.

**Effects** (`music/effects.ts`, `audio/effects.ts`, `AddEffectDialog`, `EffectDialog`)
- `music/effects.ts` is the catalogue: `EFFECTS` lists 28 effects (reverb, delays,
  chorus, flanger, phaser, distortion, guitar amp, fuzz, bitcrusher, filters, EQ,
  compressor, gain…), each with a name, category,
  description and its settings (`params`: label, min, max, default, unit). Pure data, so
  adding an effect starts here.
- A chain is drawn by `EffectList.svelte`, used by track cards and by drum rows (FX):
  the functions take an owner id, a track's or a row's (`effectOwner`).
- `+ Effect` on a track opens `AddEffectDialog`: a search box over `searchEffects(query)`,
  results grouped by category. Clicking one calls `addEffect(trackId, type)`, which adds
  `{ type, enabled: true, params: defaultParams(type) }` to the end of `track.effects`, and
  opens that effect's own window.
- Reorder a track's effects by dragging them by the ⋮⋮ grip in its list (`moveEffectTo`);
  the effect window's ↑ / ↓ move one step.
- `EffectDialog` draws one knob per setting from the catalogue, bound to
  `effect.params[key]`, plus on/off, move earlier/later (`moveEffect`), reset and remove.
  Frequency settings (`log: true`) use a ratio slider, so low and high frequencies are
  equally easy to set.
- Guitar amp and fuzz are "racks" (`Rack` in `audio/effects.ts`): several Tone nodes in
  a row (drive → tone → cabinet → level), each setting mapped to the node it changes.
  The bitcrusher is our own AudioWorklet (`CRUSHER_CODE`): Tone's only lowers bit depth,
  which is nearly inaudible; ours also lowers the sample rate, and uses mid-rise levels
  so 1 bit is a square-wave buzz rather than silence.
- Sound: `audio/effects.ts` turns an `Effect` into a Tone.js node (`createEffect`); a
  setting's key is the node's own property name (`mix` is Tone's `wet`). The mixer wires a
  track's enabled effects in order. While playing, `applyMix` updates settings in place,
  and rewires the chain if effects were added, removed, reordered or switched on/off.

**Instruments** (`music/instruments.ts`, `audio/instruments.ts`, `InstrumentDialog`)
- An instrument is a **preset**: an engine (one of Tone.js's instruments: basic synth,
  AM, FM, duo, filter synth, membrane) plus settings (`params`, e.g. waveform, envelope,
  filter). `ENGINES` lists each engine's settings, the same way `EFFECTS` lists effects'.
  A setting's key is Tone's own option name (`'envelope.attack'`), so `presetOptions`
  turns a preset into Tone options without any per-setting code.
- `BUILT_IN_PRESETS` (piano, synth, bass, pluck, bell, organ, soft lead, tom) are fixed.
  Yours are in `project.instruments`, saved with the project. A track's `instrument` is a
  preset id; `presetById` looks in yours, then built-ins, then falls back to the piano.
- Track row: a dropdown to switch presets quickly, and ✎ for the instrument window: the
  preset list, Duplicate (`addPreset` copies the current preset into yours), and a control
  per setting for your presets, plus a one-octave keyboard to try the sound
  (`previewNote`). Changing the engine resets the settings except volume.
- Sound: `createInstrument(preset)` makes the Tone instrument. While playing, `applyMix`
  applies changed settings in place (`applyPreset`); a different engine waits for the next
  Play. Every engine plays one note at a time, so sung slides and vibrato still play.
- Sampled instruments (`music/samples.ts`): 20 real instruments from
  [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (piano, guitars,
  strings, brass, woodwinds, harp, xylophone…), plus soprano, alto, tenor and baritone sax
  from the FluidR3 GM soundfont via
  [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) (better than the
  tonejs-instruments saxophone, kept as "Saxophone (older samples)"), as the `sampler` engine (`Tone.Sampler`)
  and a built-in preset each. The recordings download from the project's site the first
  time they're used (`loadSamples`, cached), so they need internet; Play and Record wait
  for them (`loadProjectSamples`). A sampler plays notes as written: no sung slides or
  vibrato. License: CC-BY 3.0, so the credit (`SAMPLES_CREDIT`) must stay visible; the
  instrument window shows it.

**Top bar** (`TransportBar.svelte`): Play, Record, the tempo wheel, the time signature
(`TimeSignatureInput.svelte`: two number fields stacked like sheet music; the bottom one only takes 2, 4, 8 or 16,
arrow keys step between them and other numbers snap to the nearest), the count-in
(Off / 1 / 2 bars, the same setting as Settings → Recording),
the metronome button (clicks while recording *and* playing, switched live:
`setPlaybackMetronome`, `recorder.setMetronome`), and the tuning knob: `project.detune`
shifts every instrument and voice recording by up to ±100 cents (`scheduleClip` /
`scheduleRecording` take it; previews use it too). Drums and the click aren't tuned.
On the right, always there, the tuner (`MicMeter.svelte`, built from the bench's
`components/tuner/`): the note you're singing, a cents meter and the mic level, measured
against the song's tuning. The mic button turns it on or off (remembered; an "on" mic
starts on your first click, since browsers need one); it's on while recording anyway.

**Shift keys** (`music/shift-keys.ts`, `state/shift-keys.svelte.ts`): while recording a
melody, hold 1–9 or 0 (= 10) to move what you sing up that many semitones, with − held to
move it down instead, and Z X C V for −2, −1, +1, +2 octaves (they add up). Physical key
positions (`e.code`), spread out so keyboards register them together. While recording,
the times the shift changed are kept (`startShiftKeys` / `stopShiftKeys`); afterwards
`applyShifts` works on the take as sung (`clip.source`) and quantizes again:
- a note takes the shift held as it starts (a key pressed up to 0.12 s after still counts);
- changing the shift while a note is held splits it there: the rest is a new note at the
  new shift, attacked again, or, with the slide key (` / ~) held, slid into (the first
  part becomes legato, the second gets a short glide).
A badge next to Record shows the shift (and "slide"). The tour lists the keys.

**Playhead** (`state/playhead.svelte.ts`): Tone's transport isn't `$state`, so while
playing (or recording) `startPlayhead` reads its position every screen frame
(`requestAnimationFrame`) into `playhead.ticks`. The piano roll draws a red line there and
scrolls to follow it; the drum grid rings the step playing; the top bar shows bar and beat.
While recording, ticks count from the end of the count-in.

**Knobs and the tempo wheel** (`components/ui/knob`, `components/ui/wheel-picker`, from the
[more-shadcn-svelte](https://more-shadcn.noair.fun) registry): knobs for volume, pan, drum
row volume, swing, effect and instrument settings, and note velocity. Drag up or down,
arrow keys when focused, double-click to reset. `format` shows the value ("−6 dB", "L 30").
Settings that feel even on a ratio scale (frequencies, times) turn a 0–1000 knob mapped by
ratio (`toSlider` / `fromSlider`). The tempo is a wheel (`BpmWheel.svelte`): scroll, drag
or click a number; it opens over the page on hover.

**Guided tour** (`components/app/AppTour.svelte`, `state/tour.svelte.ts`, the registry's
`walkthrough`): starts by itself on the first visit; Skip tour (or Esc) or Finish
remembers that in the browser; the Tour button starts it again. Each step points at an
element by id (`id="tour-…"`); to add one, add it to `STEPS` and the id to the element.

**Voice editor** (`VoiceEditor.svelte`, for voice tracks): each recording as a waveform on
the timeline. Drag it to move it, drag its edges to trim (the cut parts show faded).
Knobs for speed (pitch unchanged), pitch (speed unchanged), gain, fades; reverse,
normalize, ½×/2×/±1 buttons, right-click for more. Nothing changes the audio: the edits are
`clip.edit`, applied when it plays (`scheduleRecording` in `audio/playback.ts`, with a
GrainPlayer for speed and pitch), so Reset gets the original back. Applies on the next Play.

**The take** (`state/takes.svelte.ts`): the last recording into each melody track is kept
in memory while the app is open (too big to save). The piano roll's toolbar uses it:
**Redo take** transcribes it again with the current Settings → Transcription (what the
test bench did live), **+ Voice track** puts the recording itself on a voice track,
**Save take** downloads it as a test file. **MIDI** downloads the track's notes; the top
bar's **Export MIDI** downloads every melody track (`tracksToMidi` in `music/midi.ts`).

**Settings** (`components/app/SettingsDialog.svelte`, the Settings button): a modal with
four tabs.
- Song: tempo, time signature, key and scale. These are in `project`, saved with it. The
  key only shades the piano roll rows outside the scale (`scalePitchClasses` in
  `music/key.ts`); transcription never uses it.
- Recording: count-in (off, 1, 2 bars), metronome, hear other tracks while recording.
- Devices: microphone and speakers (`DeviceSelect`), latency calibration.
- Transcription: the note detection, expression and quantize settings from the test bench.
  `TransportBar` passes them to `recorder.start` and `takeToClip`, so they apply to the
  next recording.

**Recording** (`components/app/TransportBar.svelte`, `toggleRecord`)
1. Record calls `recorder.start(…)` (`state/recorder.svelte.ts`): count-in, metronome, mic.
   Its `playAlong` schedules every *other* track, so you hear them while you sing.
2. Stop recording calls `recorder.stop()`, which returns `{ take, bpm, timeSignature }`, and
   `stopProject()` silences the play-along.
3. The track's old recording is cleared (`clearClips`): every take starts at bar 1, so a new
   one replaces the old.
4. Melody track: `takeToClip(…)` turns the take into notes, `addNoteClip` stores them, and
   the piano roll shows them. Voice track: the raw audio is stored as a `VoiceClip`
   (`addVoiceClip`).

**Playing** (`audio/mixer.ts`): Play calls `playProject(project)`, which stops anything
still playing, sets the tempo, calls `scheduleProject` and starts Tone's transport.
`scheduleProject` builds a chain per track:
```
instrument / recording / drums → input → effect 1 → effect 2 → … → channel (volume, mute) → speakers
```
and puts its sounds on the transport:
- melody: `createInstrument(preset)` (`audio/instruments.ts`), then `scheduleClip`
  (`audio/playback.ts`) for each clip. Instruments play one note at a time, like a voice,
  so the sung slides and vibrato bend the pitch, and legato notes slur.
- voice: `scheduleRecording` plays the audio, stretched if the tempo changed.
- drums: one sound per row (`createDrum`), and a `Tone.Sequence` stepping through 16
  sixteenths, forever. It reads `track.steps` as it goes, so grid clicks are heard live.

Stop calls `stopProject()`: stop the transport, then `dispose()` every node made for this
playback (the `disposables` list), or they'd pile up.

**Editing notes** (`components/app/PianoRoll.svelte`): sing a sketch, then fix it here.
- Layout: a toolbar (pitch lines, snap grid, zoom, undo/redo, the selected notes' details
  and velocity knob, a Keys list of shortcuts), the Expression bar, the Quantize bar, then
  one scrolling area with the ruler stuck to the top (bar numbers; click or drag to move
  the playhead), the keyboard stuck to the left (click a key to hear it), the notes, and
  the velocity lane stuck to the bottom. The bars above are always there and one row
  high, so the notes never jump when selecting or adding.
- The playhead's start position is `playhead.cursor` (`state/playhead.svelte.ts`): Play
  starts there, Paste goes there, and dragging it while playing jumps playback (`seek`).
  Home goes back to the start.
- Position maths goes through four functions: `x`, `ticksAt` (ticks ↔ pixels, with the
  zoom `pxPerBeat`) and `y`, `pitchAt` (pitch ↔ pixels). Notes are handled in absolute
  ticks with `music/note-edit.ts` (`Placed` = a note plus its clip), so clips don't matter.
- Mouse: click empty space adds a note (drag and its end follows the pointer; a plain
  click uses the last length); click a note selects it (and
  plays it); Shift/Ctrl-click adds or removes; Shift-drag on empty space box-selects,
  adding to the selection; drag moves the selection (snapped; Alt for free); Ctrl-drag
  copies; a note's left or right edge changes its start or end; right-click deletes the
  note (all selected notes, if it's selected); Alt+right-click opens the note menu.
- Hold the middle button (wheel) and drag to pan; the browser's own middle-click
  autoscroll is switched off there. Ctrl + wheel zooms.
- Keys (`onKey`): Delete, Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), Ctrl+A, Esc, Ctrl+C/X/V
  (pastes at the playhead's start position, the dashed line), Ctrl+D duplicate,
  arrows transpose (↑↓, Shift = octave) and move (←→, Shift = bar), Q quantize to the
  grid, A swap to an alternative pitch (notes with a white dot: transcription wasn't
  sure), P pitch lines, Home playhead to the start, = / − zoom. Space plays and stops (in
  `TransportBar`).
- **Expression** (`ExpressionPanel.svelte`, for the selected notes;
  `music/note-expression.ts`): Sung (how much of the sung pitch curve plays, 0–150%),
  Slide in / Slide out (semitones and time), Glide (from the previous note's pitch),
  Vibrato (depth and rate), Legato, Flatten, Reset; for all selected notes, stored in
  `note.expression`. `detuneAt(note, t)` gives the pitch at any moment: playback bends
  the synth by it (`scheduleClip`, every 10 ms) and the piano roll draws it as a line on
  each note (Pitch button or P to hide), so the line is exactly what you hear. Sampled
  instruments don't bend.
- What transcription heard: a violet line (the take's pitch, frame by frame,
  `clip.pitchTrack`) under the notes, and a red one live while recording into the track.
  With the notes' own pitch lines (Pitch button) you see what was sung and what plays.
- The toolbar shows, for one selected note, what the bench showed: how far off it was
  sung, its scoop / fall / drift, and the other pitches it could be.
- Velocity lane: drag over the bars to set how hard notes play (only the selected ones,
  if any are). Notes are drawn fainter the softer they are.
- **Undo** (`state/history.svelte.ts`): every edit calls `checkpoint(track, 'what')`
  first, which keeps a copy of the track's clips; `undo()` / `redo()` swap them back.
  Re-recording a melody is a step too, so Ctrl+Z brings the old take back. A drag that
  didn't change anything removes its step again (`dropCheckpoint`).
- Any edit by hand ends live re-quantizing for that clip (`clip.source` is dropped):
  re-quantizing rebuilds notes from the take and would undo the edits.

**Drums** (`music/drums.ts`, `components/app/DrumGrid.svelte`, `createDrum` in
`audio/instruments.ts`)
- Each row is an instrument of its own: volume and pan knobs, M (mute), FX (its own effect
  chain), right-click for quick patterns (every beat, off-beats, clear). In the mixer each
  row gets a chain like a track's, feeding the drum track's chain.
- A drum track has rows (sounds) and patterns (steps). A pattern is 1–8 bars long (Bars
  − / +, or ×2 copying the bars it has); a bar is sixteenths in the song's time signature
  (`stepsPerBar`: 16 in 4/4, 12 in 3/4 and 6/8), grouped by beat and bar. The pattern
  picker: + New, Copy, Rename, Delete.
- Each row can swing on its own (its swing knob; right-click the row → Follow track swing). 14 sounds
  (`DRUM_SOUNDS`: kicks, snare, clap, rimshot, hi-hats, toms, crash, ride, cowbell, shaker),
  all made from Tone.js synths. "+ Add sound" adds a row (`addDrumRow`), ✕ removes one,
  the dropdown changes its sound.
- A step's button: `onclick={() => (row.steps[step] = !on)}`.
- Swing: `track.swing` (50% straight … 75%) on eighths or sixteenths. `swingOffset` works
  out how late each step plays; the drum loop adds it to the step's time. "Match
  melody" copies the swing measured on a recorded melody (`measuredSwing`).
- The mixer's drum `Loop` works out the step from the transport position and the time
  signature, and reads the rows as it plays, so new rows, sounds, volumes, swing and a
  changed time signature are heard straight away.

**Quantize bar** (`components/app/QuantizePanel.svelte`, above the piano roll)
- A recorded clip keeps its notes as sung in `clip.source` (`takeToClip` puts them there).
  Every change in the bar (grid, strength, lengths, swing auto or a set amount) re-runs
  `requantize(source)` and replaces `clip.notes`, so you can try settings on a take.
- The bar also shows what the rhythm reading found (from the test bench): how far behind
  or ahead of the beat you sat (allowed for), how many beats could be read another way,
  and your tuning against A440 (`source.tuningCents`).
- Changing the time signature re-quantizes recorded clips in the new meter (the Auto grid
  follows it: beats, compound time); the piano roll's beat lines follow it too.
- Editing notes by hand drops `source` (the sung timing no longer matches the notes); the
  bar's "Quantize now" then snaps the notes as they are.
- Settings → Transcription → Quantize is only where *new* takes start.

**Saving** (`saveProject` / `loadProject`): Save writes the project to `localStorage` as
JSON. Voice recordings are left out (too big), so voice tracks come back empty. The page
calls `loadProject` when it opens (`onMount` in `routes/+page.svelte`).

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
| `bind:value={obj.field}` | keep an input and a value in sync (`bind:checked` for switches) | `TrackList.svelte` (volume, mute) |
| `$effect(() => { … })` | run code now, and again whenever a `$state` value it read changes | `TrackList.svelte` (`applyMix`) |
| `onMount(fn)` | run once when the component first appears | `+page.svelte` (`loadProject`) |
| `bind:this={el}` | get the real HTML/SVG element, e.g. to measure it | `PianoRoll.svelte` (`svg`) |

**Shared state** lives in `.svelte.ts` files in `state/`: `export const project = $state({…})`.
Any component that imports it and reads `project.tracks` updates when it changes, and
changing it directly (`track.mute = true`, `project.tracks.push(t)`) is fine.

That's the whole data story of this app: **the screen and the sound both read `project`.**
Components never keep their own copy of a track; they change `project`, and every part
that reads it catches up. The one exception is sound that's already playing: Tone.js isn't
Svelte, so `applyMix` (volume, mute, effects) and the drum `Sequence` (steps) read the
project again themselves; everything else is picked up on the next Play.

**Ready-made controls:** `Button`, `Slider`, `Switch`, `Label`, `Select`, `Tabs`, `Knob`,
`WheelPicker`, `Walkthrough`… in
`components/ui/`. The bench (`routes/bench/+page.svelte`) shows how to use Button, Slider,
Switch and ToggleGroup.

## What's done

All main features: tracks (add, delete, mute, volume), instruments (presets, your own
presets with every setting of six Tone.js engines), a playhead, effects (searchable
picker, per-effect window), recording a melody or a voice, playback with play-along,
drums, piano roll editing, settings (song, recording, devices, transcription), save and
load.
Not built: chords (`music/chords.ts`, `ChordPicker.svelte` are still stubs with `TODO(you)`,
and no longer shown on the page)
and MIDI export (`clipsToMidi` in `music/midi.ts` exists; nothing calls it yet).

Known limits, on purpose:
- Changing the tempo, an instrument's engine, or deleting a track applies on the next
  Play (other instrument and effect changes are heard straight away).
- Every recording starts at bar 1 and replaces that track's last one.
- Synth instruments play one note at a time: overlapping notes cut each other off.
- Sampled instruments need internet the first time, and don't play sung slides or vibrato.
- Changing transcription settings doesn't change takes already recorded; record again.
- Re-quantizing works on recorded takes until you edit their notes by hand.

## What you don't need to touch

These work and nothing in the app needs changing in them. Read them if curious, but
editing them is how things break:

| Leave alone | Why |
|---|---|
| `transcription/` (all of it) | Voice → notes. Only `takeToClip` is used, from `TransportBar`. |
| `music/quantize.ts`, `rhythm.ts`, `articulation.ts`, `tuning.ts`, `latency.ts`, `time.ts` | Rhythm, pitch and time maths used by transcription and playback. |
| `music/types.ts` | The data model. Change it and every file using it needs changing. |
| `audio/effects.ts`, `audio/mixer.ts` | Effect nodes and chain wiring. To add an effect: an entry in `EFFECTS` (`music/effects.ts`) and a `case` in `create` (`audio/effects.ts`). |
| `state/settings.svelte.ts` | Loading and saving recording settings. |
| `state/playhead.svelte.ts` | Copies the transport's position into `$state` every frame. |
| `music/samples.ts` | Which recordings each sampled instrument loads (generated from the tonejs-instruments file list). |
| `swingOffset` in `music/drums.ts`, `requantize` / `measuredSwing` in `music/quantize.ts` | Swing and quantize maths, tested. |
| `audio/instruments.ts` (except `createDrum`) | Builds instruments from presets. To add an engine: an entry in `ENGINES` (`music/instruments.ts`) and a `case` in `createEngine`. |
| `audio/engine.ts`, `metronome.ts`, `playback.ts`, `pitch-tracker.ts`, `analysis-processor.ts`, `latency-calibration.ts` | Low-level sound and mic plumbing. |
| `state/recorder.svelte.ts`, `live-input.svelte.ts`, `latency.svelte.ts`, `audio-devices.svelte.ts` | Mic, count-in, latency: used through `recorder` only. |
| `components/ui/` | Ready-made controls (shadcn-svelte, plus knob, wheel-picker and walkthrough from more-shadcn-svelte). Use them, don't edit them. The registry versions were patched slightly to pass `npm run check`: the knob got `format`, keyboard control and a tabindex; small type fixes in wheel-picker and walkthrough. |
| `state/history.svelte.ts`, `music/note-edit.ts` | Undo/redo, and note editing in absolute ticks (tested). |
| `state/tour.svelte.ts` | Whether the tour has been seen. |
| `state/context-menu.svelte.ts`, `ContextMenu.svelte` | The right-click menu system. |
| `state/takes.svelte.ts` | The last take per track, in memory. |
| `music/arrange.ts`, `music/looper.ts` | Placements → what plays; pattern mode; looper layers (tested). |
| `state/view.svelte.ts` | Editor or Playlist in the main area. |
| `music/shift-keys.ts`, `state/shift-keys.svelte.ts` | Shift keys while recording (tested). |
| `music/note-expression.ts` | A note's pitch over time from its curve and expression (tested). |
| `components/tuner/`, `devices/`, `latency/`, `debug/`, `routes/bench/` | The test bench at `/bench` (the tuner pieces are also used by the top bar's `MicMeter`). |

What you're most likely to change, if anything: the look of the components in
`components/app/`, the built-in presets (`BUILT_IN_PRESETS` in `music/instruments.ts`), the
setting ranges in `ENGINES`, the drum sounds in
`createDrum`, the effects' ranges and defaults in `music/effects.ts`, and the zoom and
range constants at the top of `PianoRoll.svelte`.

## Testing in a browser

In development (`npm run dev`), `window.__hum` exposes `{ project, addNoteClip,
addVoiceClip }` so automated browser tests can set up state (it isn't in builds).

## Gotchas

- **Audio only starts after a click.** Browsers block sound until the user clicks; call
  `initAudio()` (or `playProject`, which does) from a click handler.
- **Put copies into the project, not live values.** `$state.snapshot(x)` makes a plain copy.
- **Scheduling uses ticks as `${ticks}i`.** Tone reads `'960i'` as "tick 960".
- **Stop before playing again.** Otherwise the old Parts keep playing on top:
  `playProject` and Record call `stopProject` first.
- **Restart `npm run dev`** after installing packages or moving pages, or you get old pages
  and 500 errors.
- **Read errors in the browser console (F12)**, and run `npm run check` for type errors.

## Who wrote what

Earlier sessions with Claude built parts of `audio/`, `state/` and `components/` (audio
devices, latency calibration, the metronome, the tuner), everything in `transcription/`,
`music/quantize.ts`, `rhythm.ts`, `articulation.ts`, `state/recorder.svelte.ts`, the data
model in `music/types.ts`, and the starter files (structure and TODO notes) in
`components/app/`, `state/project.svelte.ts`, `audio/mixer.ts`, `audio/instruments.ts` and
`music/chords.ts`.

A later session with Claude (2026-10-25), at the user's request, filled in the app
features: `state/project.svelte.ts`, `audio/mixer.ts`, `audio/instruments.ts`, the changes to
`audio/playback.ts` (time offset, output node, overlapping notes), `TransportBar.svelte`,
`TrackList.svelte`, `PianoRoll.svelte`, `DrumGrid.svelte`, the load-on-start in
`routes/+page.svelte`, and this guide. The same day, also at the user's request: the
Settings dialog (`SettingsDialog.svelte`, `state/settings.svelte.ts`), `key`/`scale` restored
to the project (`music/key.ts`; the original data model had them, the scaffold dropped them),
and the effects system (`music/effects.ts`, `audio/effects.ts`, `AddEffectDialog.svelte`,
`EffectDialog.svelte`, the effect chain in `audio/mixer.ts`). Then knobs, track pan, the
tempo wheel and the guided tour (`BpmWheel.svelte`, `AppTour.svelte`,
`state/tour.svelte.ts`, the more-shadcn components and their patches), and the full piano
roll editor (`PianoRoll.svelte` rewritten, `state/history.svelte.ts`, `music/note-edit.ts`).
Then note expression (slides, glide, vibrato, bend amount: `music/note-expression.ts`,
`ExpressionPanel.svelte`, pitch lines in the piano roll, playback in `scheduleClip`), the
count-in toggle and `TimeSignatureInput.svelte` (with shadcn-svelte's `input`),
then drum pattern lengths, per-sound drum swing and the playlist with shared clips
(`music/arrange.ts`, `Playlist.svelte`, `state/view.svelte.ts`, the clip/pattern functions in
`state/project.svelte.ts`, the drum grid rewrite), and right-click menus everywhere, custom scrollbars, track renaming, duplicating and
solo, per-track swing, polyphonic tracks ("Allow Polyphony"), drum rows as full instruments (pan,
mute, effects), the voice editor, the take's pitch line and the bench's readouts in the
app (rhythm, tuning, note details, redo take, voice track, save take, MIDI export), the
always-visible meters, and the bitcrusher's 1-bit fix (`EffectList.svelte`,
`VoiceEditor.svelte`, `ContextMenu.svelte`, `state/context-menu.svelte.ts`,
`state/takes.svelte.ts`), middle-drag panning, the top bar's time signature, metronome button and tuning
(`project.detune`), shift keys, and the guitar effects (amp, fuzz, flanger, gain) with
our own bitcrusher worklet.
Then the playhead
(`state/playhead.svelte.ts`, in `TransportBar`, `PianoRoll`, `DrumGrid`) and instrument
presets (`music/instruments.ts`, `audio/instruments.ts` rewritten, `InstrumentDialog.svelte`,
`project.instruments`, live instrument updates in `audio/mixer.ts`). Then sampled
instruments (`music/samples.ts`, the `sampler` engine), drum rows, sounds and swing
(`music/drums.ts`, `DrumGrid.svelte`, `createDrum`, `scheduleDrums` in `audio/mixer.ts`), and
re-quantizing recorded clips (`NoteClip.source`, `requantize`, `QuantizePanel.svelte`).
