# hum-daw: how the code fits together

A music maker for people who don't know music: sing a melody and it becomes notes, add a
drum loop, your voice on top, effects, and play it all back.

## Running it

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173. Restart it after installing or removing packages, or moving pages. |
| `npm test` | Run the tests (`*.test.ts` files). |
| `npm run check` | Type-check everything. Run it when something looks wrong: it often says exactly what. |

Pages:
- `/`: the home page (your projects). `src/routes/(app)/+page.svelte`.
- `/studio/<project id>`: the studio, with that project open (`src/routes/(app)/studio/[[id]]/+page.svelte`).
  The address follows the open project (File → New / Open change it, so Back works);
  opening the app at such an address opens that project; `/studio` alone opens the last one.
- `(app)/+layout.svelte`: what both share, started once (projects, undo history, your sounds,
  live keys, offline status, shared windows, the toast).
- `/bench`: the transcription test bench (record a take and see exactly what transcription
  made of it), outside the `(app)` group.

`npm run build` makes the offline-capable app (`build/`); `npx vite preview` serves it.
The service worker only fully works in a build.

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
| `src/routes/` | Pages: home and studio in the `(app)` group, `/bench`. They only arrange components. |
| `src/service-worker.ts` | Saves the app and every sample it fetches, so it works offline. |

## The data: a project

All in `src/lib/music/types.ts`.

```
Project            name, bpm, timeSignature, key, scale, detune (cents), transpose, masterVolume
├─ instruments: InstrumentPreset[]   your presets: id, name, engine ('fm' …), params
├─ masterEffects: Effect[]           on the whole song (the mixer's Master strip)
├─ buses: Bus[]                      shared effect channels / groups: id, name, volume, pan, mute, effects
├─ markers: Marker[]                 named places on the ruler: id, tick, name
├─ automation: AutomationLane[]      target (what it changes), points [{ tick, value }], enabled
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

Placement          clipId (a NoteClip or DrumPattern), start (ticks), length? (longer loops it),
                   offset? (where in the clip it begins), muted?
Track extras       output? (a bus id: routed into it), sends? [{ busId, level dB }]
VoiceClip extras   muted? (a take you're not using)
LoopRegion         start, end (ticks), enabled   (project.loop: what Song mode repeats)
AutomationTarget   { kind: 'mix', ownerId, param: 'volume' | 'pan' }
                   { kind: 'effect', ownerId, effectId, param }   (ownerId: a track, a drum row, or 'master')
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

**The mixer** (`Mixer.svelte`, the Mixer tab; `ChannelStrip.svelte`, `Fader.svelte`): every
track side by side, the Master on the right. A strip shows the same settings as a track card
(effects, pan, volume as a fader, mute, solo) plus a level meter; drum tracks' "Rows" adds a
strip per drum sound. The Master strip's effects are `project.masterEffects` and its fader
is `project.masterVolume`. Meters read `level(id)` from `audio/mixer.ts` every frame (each
playing chain feeds a `Tone.Meter`).

**Buses** (`project.buses`, `addBus` / `addReverbBus` / `setSend` / `removeBus` in
`state/project.svelte.ts`, the mixer's bus strips): a bus is a channel other tracks feed,
with its own effects, volume and pan, playing into the master.
- Sends: a copy of a track's sound into a bus after its volume (one reverb for many
  tracks). Each track strip has a send knob per bus (automatable, `{ kind: 'send' }`).
- Output: a track can play into a bus instead of the master (a group: one fader, one set of
  effects for all of them). The strip's "Out" menu.
- Quick: right-click a track strip → "Send to a new reverb bus" or "Route into a new group bus".
- `audio/mixer.ts` builds bus chains first, then routes tracks (`routeTrack`, live while
  playing: changing an output reconnects its meter, analyser and sends too).

**Sidechain** (`Ducker` in `audio/effects.ts`, `state/sidechain.ts`): a "Sidechain (duck)"
effect pushes its track down whenever another track or drum row plays (the pumping of
dance music, or the bass making room for the kick). The quick way: right-click a track
card or mixer strip → "…“Kick” plays". Its window picks the source and sets Duck by,
Sensitivity and Release. It listens to the source's input, before its volume and mute, so
a muted "ghost" kick still pumps (`wireSidechains` in `audio/mixer.ts`).

**Stereo**: channels keep stereo (Tone's channel defaults to folding everything to mono
before panning; `channelCount: 2` in `buildChain`), so stereo samples, ping-pong delay,
reverb, the widener and the chorus are heard wide. Tracks use a −3 dB centre pan law
(`PAN_LAW`). The chorus (`StereoChorus`) has its own delay and wobble per side: R delay
offset (ms) and Stereo spread (how far apart the two wobbles run, 0–180°), plus feedback.

**Automation** (`music/automation.ts`, `AutomationLaneRow.svelte`, `AutomationDrop.svelte`,
`state/automation.svelte.ts`): settings that change over the song: volumes, pans, swing,
effect settings, instrument settings, the master, the tempo, the time signature, the key
shift and the tuning, and toggles (mute, solo, an effect on / off: lanes of 0 / 1). A lane
is a line through points, level before the first and after the last (`valueAt`).
- Every knob says what it controls as part of its definition: the Knob's `automate` prop
  is required, a target or `false` for knobs that aren't song settings (a selected note's
  expression or velocity, a recording's edit, the slicer's sensitivity). Toggles and other
  controls use the `automatable` action (`use:automatable={target}`).
- Each segment has a shape (`AutomationPoint.shape`, `shapeAt`): line, curve (`tension`),
  S-curve, hold, or a wave (sine, triangle, square, saw; `cycles`) between its two values.
  Right-click between two points to pick one; drag the ring in the middle of a segment to
  bend it (on a wave: more / fewer cycles), double-click the ring for a straight line.
- Make a lane first: "+ Lane" in the playlist adds an empty one (`addEmptyLane`).
- Then Ctrl+drag a control onto it: any knob or fader with an `automate` target (track,
  drum row, master, effect windows), the tempo field or the time signature
  (`startKnobDrag`). Let go anywhere else and nothing changes (Esc cancels too). Dropping
  on a lane that already has a setting switches it (`assignLane`); a setting that already
  has a lane keeps it.
  - Dragged out of a window (an effect's settings), the window fades to 20% and lets the
    pointer through (`body.knob-drag-outside` in `routes/layout.css`), so you can drop on
    the playlist behind it.
  - If the playlist isn't on screen, a preview of its lanes slides up from the bottom to
    drop on (`AutomationDrop.svelte`), with a chip under the pointer saying what's dragged.
- Or right-click a control: "Automate in <empty lane>", "Automate in a new lane", or "Show
  its automation" (`automationMenu`).
- Key shift, tuning and swing are read from their lanes at each note's own tick
  (`scheduleClip` takes them as functions of the tick; `laneValue` in the mixer), not from the
  loop's last value: a note and a lane change on the same beat used to go either way. Voice
  recordings follow key shift and tuning lanes too (`followPitch`). Toggles and instrument
  settings redo the mix when their lane changes.
- Tempo: the transport's tempo follows the lane while playing (notes stay on their ticks;
  export length follows it, `secondsBetween`). Time signature: beats per bar, stepping at
  the next bar line (`meterAt`); drums play each bar's share of their pattern and the
  metronome accents each bar. The playlist's bar lines stay in the song's own signature,
  and voice recordings don't stretch with tempo changes.
- Edit it in the playlist, under the tracks: click to add a point and drag it (Shift: only
  up/down; Alt: no snap; it snaps to sixteenths), right-click a point to delete it,
  double-click to type its value; right-click the lane to flatten it, turn it off or delete it.
- While the song plays, automated knobs and faders turn amber and follow the lane
  (`shown(lane, value)`); the knob's own value comes back on Stop or when the lane is off.
- Plays in Song mode only (Pattern mode loops a clip, which has no place in the song).
- Deleting a track, drum row or effect deletes its lanes. Reverb size and pre-delay can't be
  automated (changing them rebuilds the reverb).

**Layout** (`state/layout.svelte.ts`, `DockLayout.svelte`, `DockNode.svelte`,
`PanelView.svelte`): a docking layout. The panels (Tracks, Editor, Playlist, Mixer) sit in
stacks of tabs inside a tree of rows and columns (`DockNode`: a split with `sizes`, or a
stack), or float as windows (`layout.floating`), or are hidden.
- Drag a panel's tab: five targets appear in the middle of each stack (left / right / top /
  bottom: dock beside it; centre: add as a tab); drop anywhere else to float it
  (`pressPanel`, `dock`, `floatPanel`). A floating window: drag its title (onto a target to
  dock it again), its right / bottom edges or corner to resize; ⇲ docks it back, – hides it.
- Drag any border between panels to resize (`setSizes`). ⋯ on a stack: float, hide,
  layouts. View menu: show / hide each panel, float one, layouts (`PRESETS`), reset.
- Opening a panel from anywhere (`view.main = 'playlist'`) brings it to the front wherever
  it is (`showPanel`). Kept in this browser (localStorage).
- With two editing panels on screen, keyboard shortcuts go to the one last clicked
  (`keysFor`).

**The playlist** (`Playlist.svelte`, the Playlist tab; `music/arrange.ts`): the whole song,
one lane per track. A clip's notes (or a drum pattern's steps) are stored once on its
track; the playlist holds only placements (`{ clipId, start, length? }`), so copying a
block adds a few bytes, not another copy of the notes, and editing a clip changes every
block of it ("Make unique" copies one when it should differ). A block longer than its
clip loops it; shorter cuts it off. `expandPlacements` turns placements into plain clips
for the mixer and MIDI export.
- Click a lane: place the track's current clip. Drag: move (snap: bar, beat, off; Alt:
  beat). Ctrl-drag: a copy. Right edge: length. Double-click: edit that clip. Right-click:
  copy after it, make unique, one-loop length, delete. Ruler, middle-drag, Ctrl + wheel as
  in the piano roll.
- Place (top of the playlist): every clip and pattern, listed under its track's instrument
  (and the track's name); picking one makes it that track's current one, and that lane gets
  an amber mark. Hovering empty space shows a dashed outline of what a click places there.
  "+ New" makes an empty one to place. A block's right-click menu can also replace it with
  (or place after it) the current one, for lanes already full of blocks.
- Selecting: click a block; Shift+click adds / removes; Shift+drag across lanes draws a box;
  Ctrl+A selects all. Dragging moves every selected block. Keys: Delete, Ctrl+C / X / V
  (pastes at the playhead), Ctrl+D (a copy right after), ← → (nudge by the snap), Esc.
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

**Top bar layout**: groups of two rows with dividers: Play over Record; Pattern/Song over
Over/Replace; Count-in over Save and Settings; BPM over time signature and Click; Master
volume, Key shift (±12 semitones: melodies and voice recordings, not drums) and Tune
knobs; MIDI over Guide; the mic meter over the position, shift badge and key. Master volume
is `project.masterVolume` (`setMasterVolume`), key shift `project.transpose` (added to the
tuning when scheduling).

**Drum sound library** (`music/drum-samples.ts`, `SoundBrowser.svelte`): two recorded
acoustic kits (AVL Drumkits, CC-BY-SA 3.0), the TR-808 (Michael Fischer, no restrictions)
and percussion (VCSL, CC0), downloaded from jsDelivr when first used (`loadDrumSound`;
Play and Record wait for them), each hit a one-shot player so cymbals ring on. A row's
sound button and "+ Add sound" open the browser: search, ▶ to listen, click to use; the
credit is shown there.
- **Your sounds** (`state/user-samples.svelte.ts`): uploaded audio files and slices, kept
  in this browser's IndexedDB (Dexie), so they're in every project here but not in the
  project save (a project using them elsewhere plays them silent). Ids start with `u:`.
- **Slicer** (`Slicer.svelte`, `music/slice.ts`): open a file or a voice recording; hits
  are found where loudness jumps (`findOnsets`, Sensitivity); click markers to remove,
  the waveform to add, a slice's number to hear it; "Add N sounds" keeps each slice and
  adds it as a drum row.

**Instrument browser** (`InstrumentBrowser.svelte`, the track's instrument button):
search over synths, sampled instruments, your presets and your sounds (an uploaded
recording played at every pitch: a sampler preset with `sample: 'u:…'` and a root note);
▶ to listen; "+ New synth preset" and "Upload a sample…" open the editor afterwards.

**Track cards** fold to their title row (▾ / ▸, `track.collapsed`; right-click the list:
Collapse all / Expand all).

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
ratio (`toSlider` / `fromSlider`). The tempo is a field (`BpmInput.svelte`): type it, scroll
over it (Shift: by 5) or use the arrows; hovering shows Tap tempo (click Tap or press T).

**The guide** (`guide/`, `components/guide/`): builds a first song ("First song", A minor,
126 BPM) one feature at a time over a backing track.
- `Intro.svelte`: black screen, logo, "Click to enable sound", then Begin guide / Skip
  (both on the beat). The studio opens it the first time; never by itself on the home page.
- `guide/backing.ts`: the backing loop (Am F C G: drums, bass, pad, arpeggio), synthesized
  on its own clock, not in the project. Each step sets what plays (`setLayers`, a crash on
  each new step) and how open its low-pass is; parts the song already plays drop out while
  it plays. Play and Record start the transport on its bar lines (`audio/sync.ts`).
- `guide/steps.ts`: the steps: headline, hint, what they reveal or hide (`PARTS`, matched
  by `data-guide="…"` attributes in the components), `done()` (moves on at the next bar),
  or Next / choices. Voice, piano roll, quantize, editing, tracks, transport, mix,
  expression, playlist, polyphony and the computer keyboard, the top bar, loop, voice
  tracks, drums, mixer, automation; music theory (skippable); sheet music.
- `guide/guide.svelte.ts`: where it is (kept in the browser: leave and come back, the home
  page offers "Continue the guide"), Previous / Next, the recording settings it borrows
  (given back after). The first take leans its note naming towards C major / A minor
  (`scaleBias` in transcription/notes.ts).
- `GuideStage.svelte`: the studio as the guide shows it, captions along the bottom.

**Sheet music** (`components/app/SheetView.svelte`, `music/notation.ts`): the editor's
Sheet button shows a melody track's clip as notation (ABC drawn by abcjs): sixteenth
timing, ties over bar lines, the song's key signature, a clef from the notes' range, the
bar playing in red. Read-only; edit in the piano roll.

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
instrument / recording / drums → input → effect 1 → effect 2 → … → channel (volume, pan, mute)
  → master input → master effects → speakers (master volume)
```
A channel gets a meter (and an analyser) only once the mixer or a spectrum display asks for
it, so nothing extra runs while they're closed. A `Tone.Loop` every 32nd note sets each
automation lane's value at that moment (`scheduleAutomation`); while a lane moves a
setting, `applyMix` leaves it alone.
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
- Keys (`onKey`): Delete, Ctrl+A, Esc, Ctrl+C/X/V
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
- **Undo**: the app-wide history (see "Undo" below). Edits here call
  `checkpoint(track, 'what')` first to name their step; a drag that didn't change anything
  drops it (`dropCheckpoint`).
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

**Offline** (`src/service-worker.ts`, `state/offline.svelte.ts`, `OfflineDialog.svelte`): the
service worker saves the app (a cache per version) and every sample and the logo font the
first time they're fetched (`hum-samples`, kept across versions), and serves them from there
after. File → Work offline… (or the home page) shows what's saved and "Save every sound for
offline use" fetches all of them (380 files, about 70 MB) and asks the browser to keep the
storage. Projects, recordings and your sounds are in IndexedDB or your folder already. A
sample that can't load (offline, not saved) no longer stops Play: the rest plays and the
transport bar names what's silent (`loadProjectSamples` returns it); it's tried again later.
An "Offline" badge shows in the menu bar when the connection's gone.

**Editing blocks and recordings** (`Playlist.svelte`, `splitPlacement` / `blockOffset` in
`music/arrange.ts`): drag a block's left edge to start later (or earlier) in its clip
(`offset`), its right edge for its length; a recording's edges trim it (its `edit.trimStart`
/ `trimEnd`; reversed recordings trim the other side). S (or right-click → Split) splits the
selected blocks and recordings at the playhead: the second half carries on from the same
point. Right-click: mute a block or take (`muted`: shown faded, not played), or "Keep only
this take" (mutes the track's recordings it overlaps: comping loop takes).

**Markers and time** (`addMarker`, `insertTime`, `deleteTime`): markers sit on the ruler
(right-click → Add a marker; Transport menu: at the playhead, or jump to one). The ruler's and
the loop region's menus insert empty bars or delete bars: blocks, recordings, automation points,
markers and the loop after the point all move.

**MIDI import** (`music/midi-import.ts`, File → Import MIDI file): each part with notes
becomes a melody track (polyphonic if notes overlap; instrument from its General MIDI
program); the drum channel becomes a drum track whose identical bars share one pattern. An
empty song takes the file's tempo and time signature.

**Controller lanes** (`NoteClip.controllers`, the piano roll's bottom lane: Velocity / Bend /
Mod): a clip's pitch bend (±12 semitones over every note playing) and mod wheel (a vibrato
that deepens, up to 50 cents). Drag to draw (it replaces what the stroke passes over),
right-click to clear. One-note instruments bend as notes sound (`scheduleClip`); chords and
sampled instruments take the bend where each note starts. MIDI import and export carry them
(pitch bend at MIDI's usual ±2 semitones, the mod wheel as CC 1).

**Recordings and tempo lanes** (`followTempo` in `scheduleRecording`): with a tempo lane, voice
recordings play through the time-stretching player, follow each tempo change (`tempoFollowers`
in the mixer) and stop at their place in the song, so they stay on the beat.

**Recording automation** (`touchAutomation` in `state/automation.svelte.ts`, Transport →
Record automation; "● Automation" in the menu bar while on): turning a knob or fader while the
song plays writes its moves into its lane (made if needed), replacing the points it passes over.

**Punch in/out** (Transport menu, `recordingSettings.punch`): Song-mode recording starts a bar
before the loop region and keeps only what falls inside it (notes cut at its end; a voice
recording trimmed to it).

**Hearing the mic** (`state/monitor.svelte.ts`, Input → Hear the mic; "🎧 Mic" in the menu bar):
the microphone live through the selected voice track's effects, volume and pan. Headphones.

**Stems and bouncing** (`onlyTrack`, `bounceTrack` in `audio/export.ts`): Export audio can write
each track as its own file (the others muted, through the same buses and master). Track menu →
Bounce to audio renders a track (without the master's effects) into a new voice track right
after it and mutes the original (`bounceToAudio`).

**Spectrum** (`Spectrum.svelte`, `spectrum(id)` in `audio/mixer.ts`): the master's frequencies
under the mixer's Master strip, and a channel's in the windows of EQ, filter, compressor and
auto-wah effects. Analysers are made when first shown, and draw only while playing.

**Repairing broken numbers** (`music/repair.ts`): a value that went NaN (as a playlist drag
once did) would stop a block drawing and playing and spoil the playlist's width.
`repairProject` mends what it can (positions, lengths, notes, automation points, mix
settings) when a project opens (a notice says how many) and before each Play.

**The home page** (`HomePage.svelte`, the `/` route): what the app opens on. The "hum-mus" logo (`Logo.svelte`: text in Smooch Sans at weight 800, loaded from
Google Fonts in `routes/+layout.svelte`; the Tailwind class `font-logo`), New project,
Import, the guide (or Continue the guide), and your projects as cards (name, "3 tracks · 100 BPM · 1:24", when last
saved; click to open; ⋯ to rename, duplicate, export or delete; search; sort by recent or
A–Z). The summaries are written with each save (`summarize` in `state/project-store.ts`).
"Back to <song>" returns to the open song; the logo in the menu bar (or File → Home) comes
back here (`goHome`; the studio stops playback as it closes). If the projects folder needs the browser's OK
again, the page says so with an Allow button.

**The menu bar** (`Menubar.svelte`): File, Edit, View, Track, Transport, Input, Help; in
the middle the project bar (the song's name: click to rename; the save status: click for
your projects; ↶ ↷); on the right the live-input switches (⌨ computer keyboard, MIDI). It
handles the app-wide shortcuts: Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo / redo, Ctrl+S save,
Ctrl+O open, Ctrl+K computer keyboard on / off. Windows anything can open (Settings,
Projects, History, Export, Shortcuts) are flags in `state/ui.svelte.ts`; the Transport
menu presses TransportBar's own functions through `transportActions`.

**Undo** (`state/history.svelte.ts`): one chain of steps for the whole project: notes,
tracks, the playlist, mixer, effects, automation, tempo (not the selection, the open tab
or the loop region). A step is a copy of the project from before an edit
(`state/clone.ts`: voice recordings' audio is shared between copies, never copied, since
it never changes in place). Edits are found by watching the project (`watchHistory`, an
`$effect` that reads it all through `signature`): a change becomes a step once nothing
has changed for 350 ms, so a knob turn or drag is one step. `checkpoint(track, 'Move
notes')` names the next step; unnamed ones get a name from what changed ("Edit Bass",
"Tempo"). Edit → History (`HistoryDialog.svelte`) jumps to any step (`jumpTo`). Only the
last 200 steps are kept; opening a project starts a new chain.

**Saving and projects** (`state/projects.svelte.ts`, `state/project-store.ts`,
`state/db.ts`, `ProjectsDialog.svelte`, `FolderAccessDialog.svelte`): any number of
projects, saved automatically 1.5 s after each change (File → Save automatically; Ctrl+S
saves now), voice recordings included. Two places to keep them:
- This browser (IndexedDB, through Dexie): `projects` (names), `projectData` (each project
  without its audio) and `audio` (each recording, stored once by id).
- A projects folder (File → Keep projects in a folder…; Chrome and Edge): a folder per song
  with `project.json` and `audio/<id>.wav` (32-bit float WAV, so any audio editor opens
  them). Choosing one copies the browser's projects into it. The folder's handle is kept
  in the database; on a later visit the browser asks again (once per visit, after a
  click): until you allow it, `library.folder.state` is `'needs-permission'`, nothing is
  saved, and FolderAccessDialog shows the folder's name and what to do (browsers never
  tell a page a folder's full path).
In both, recordings are written once (they never change), so an autosave after a note
edit writes a few kilobytes. `applyProject` (in `state/project.svelte.ts`) puts a saved
project in place, bringing older saves up to date; projects saved by older versions in
`localStorage` are moved into the database the first time. File → Export / Import
project file: a `.humproj` (JSON, recordings as base64) to share or back up one song.

**Exporting audio** (`audio/export.ts`, `ExportDialog.svelte`): File → Export audio
renders the song (or the loop region) offline with `Tone.Offline`, through the same
`scheduleProject` Play uses, so instruments, recordings, effects, automation and the
master are all in it, plus 2 s for reverb to ring out. Then `toWav` (16-bit, `music/wav.ts`)
or `toMp3` (lamejs, 128–320 kbps). The offline transport is set to PPQ ticks per beat like the live one (Tone's default is 192, which made exports 2.5× slow), and note lengths are converted on the transport doing the scheduling. Rendering offline is also why the mixer captures the
transport and destination when it schedules (callbacks run after Tone has switched back
to the live context) and makes every drum row's sound up front; `effectsReady` waits for
reverbs, the bitcrusher's worklet and samplers' recordings before rendering.

**The loop** (`project.loop`, ⟳ in the top bar, the strip at the top of the playlist's
ruler): Song mode repeats `start`–`end` while it's on (`playProject`'s `region`;
`setPlaybackLoop` moves it while playing). Drag across the strip to set it, drag the band
to move it, its ends to resize it; a block's right-click menu has "Loop this block".

**Playing from a keyboard** (`music/keyboard.ts`, `state/live-keys.svelte.ts`,
`audio/live.ts`, `ShortcutsDialog.svelte`): Ctrl+K (or ⌨ in the menu bar) makes the
computer keyboard play the selected track; Input → MIDI keyboard connects MIDI keyboards
(Web MIDI). Two layouts for the note keys (`e.code`, so any keyboard layout works):
compact (the default; A S D F G H then Q W E R T Y, a semitone each, one octave) and piano
(A S D F… white keys, W E T… black keys). Polyphonic tracks: chords; Z / X octave, C / V
softer / louder. One-note tracks: `MonoVoice` (the last key held sounds), with the shift
keys held as when singing (Z X C V octaves, numbers and − semitones, ` slide). Drum tracks:
the note keys play the rows in order. Live notes go into the track's playing chain while
the song plays (`chainInput`), otherwise into a small chain of their own with the track's
effects. The piano roll's keys light up for the notes sounding. Recording with Input set to
Keys (⌨ beside Record, or the Input menu) records what's played instead of the mic
(`startKeyCapture` / `stopKeyCapture`, `TakeBuilder`): notes as played, not quantized, a
slide stored as a legato note into a gliding one. The take then goes through the same
Over / Replace / looper logic as a sung one.

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
| `onMount(fn)` | run once when the component first appears | `+page.svelte` (`initProjects`) |
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
drums, piano roll editing, settings (song, recording, devices, transcription), projects
saved automatically (recordings included, in the browser or a folder), app-wide undo, the
mixer, automation, the loop, audio / MIDI export, and playing from a computer or MIDI
keyboard.
Also: buses and sends, markers and inserting / deleting time, splitting, trimming and muting
blocks and takes, MIDI import, recording automation, punch in/out, hearing the mic, stems,
bouncing to audio, a spectrum display.
Also: recordings stretching with a tempo lane, and per-clip controller lanes (pitch bend,
mod wheel).
Not built: chords (`music/chords.ts`, `ChordPicker.svelte` are still stubs with `TODO(you)`,
and no longer shown on the page).

Known limits, on purpose:
- Changing the tempo, an instrument's engine, or deleting a track applies on the next
  Play (other instrument and effect changes are heard straight away).
- Notes recorded from a keyboard aren't quantized (Quantize now in the piano roll does it).
- Your sounds (uploads, slices) stay in this browser: they aren't in project files or the
  projects folder.
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
| `state/history.svelte.ts`, `state/clone.ts`, `music/note-edit.ts` | App-wide undo/redo, copying the project, note editing in absolute ticks (tested). |
| `state/db.ts`, `state/project-store.ts`, `state/projects.svelte.ts`, `music/wav.ts` | Where projects are kept (browser database or a folder), autosave, project files, WAV (tested). |
| `audio/export.ts`, `audio/live.ts`, `music/keyboard.ts`, `state/live-keys.svelte.ts` | Audio export; live keyboard / MIDI playing and recording (key logic tested). |
| `guide/` | The guide: backing track, steps, progress (see The guide). |
| `music/notation.ts` | A clip as ABC notation (sheet music). |
| `state/context-menu.svelte.ts`, `ContextMenu.svelte` | The right-click menu system. |
| `state/takes.svelte.ts` | The last take per track, in memory. |
| `music/drum-samples.ts`, `music/slice.ts`, `state/user-samples.svelte.ts` | Drum sample catalogue (all links checked), slicing (tested), your sounds in IndexedDB. |
| `music/arrange.ts`, `music/looper.ts` | Placements → what plays; pattern mode; looper layers (tested). |
| `state/view.svelte.ts` | Editor, Playlist or Mixer in the main area. |
| `music/automation.ts`, `state/automation.svelte.ts`, `state/layout.svelte.ts` | Automation maths, tempo and meter (tested), Ctrl+drag / right-click automation from controls, the panel layout. |
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
addVoiceClip, layout }` so automated browser tests can set up state (it isn't in builds).

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
tempo control and the guided tour (`BpmInput.svelte`, `AppTour.svelte`,
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
Then the mixer view, master effects and meters (`Mixer.svelte`, `ChannelStrip.svelte`,
`Fader.svelte`, the master bus in `audio/mixer.ts`), automation (`music/automation.ts`,
`AutomationLaneRow.svelte`, `AutomationDrop.svelte`, `state/automation.svelte.ts`,
`scheduleAutomation`) and the panel layout (`state/layout.svelte.ts`, `PanelView.svelte`).
Then the docking layout (`DockLayout.svelte`, `DockNode.svelte`, `state/layout.svelte.ts` rewritten),
sidechain and the stereo chorus (`Ducker`, `StereoChorus`, `state/sidechain.ts`, stereo channels),
automation shapes, required knob targets and toggles, and playlist selection and shortcuts.
Before that, the home page and logo (`HomePage.svelte`, `Logo.svelte`), the menu bar and project bar (`Menubar.svelte`, `state/ui.svelte.ts`), projects and
saving with recordings and the projects folder (`state/projects.svelte.ts`,
`state/project-store.ts`, `state/db.ts`, the dialogs), app-wide undo (`state/history.svelte.ts`
rewritten, `state/clone.ts`), the loop, audio export (`audio/export.ts`, `music/wav.ts`), keyboard
and MIDI input (`music/keyboard.ts`, `state/live-keys.svelte.ts`, `audio/live.ts`, the recorder's
`mic` option) and the tempo field with tap tempo (`BpmInput.svelte`).
