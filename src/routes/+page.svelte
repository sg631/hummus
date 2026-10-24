<script lang="ts">
  import * as Tone from 'tone';
  import { Midi } from 'tonal';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import Tuner from '$lib/components/tuner/Tuner.svelte';
  import DebugContour, { type DebugNote } from '$lib/components/debug/DebugContour.svelte';
  import { liveInput } from '$lib/state/live-input.svelte';
  import {
    DEFAULT_EXPRESSION_SETTINGS,
    DEFAULT_NOTE_SETTINGS,
    LiveTranscriber,
    buildNotes,
    encodeTake,
    interpretNote,
    toClip,
    type ExpressionSettings,
    type NoteSettings,
    type TranscribedNote,
    type Transcription
  } from '$lib/transcription';
  import type { PitchFrame } from '$lib/music/types';
  import { PPQ } from '$lib/music/time';
  import { GRID_OPTIONS, quantizeNotes, removeOverlaps, type QuantizeSettings } from '$lib/music/quantize';
  import { scheduleClip, type ScheduledClip } from '$lib/audio/playback';
  import { Metronome } from '$lib/audio/metronome';
  import { initAudio } from '$lib/audio/engine';
  import LatencyCalibration from '$lib/components/latency/LatencyCalibration.svelte';
  import DeviceSelect from '$lib/components/devices/DeviceSelect.svelte';
  import { latency } from '$lib/state/latency.svelte';
  import { clipsToMidi } from '$lib/music/midi';
  import { downloadBlob } from '$lib/download';

  const COUNT_IN_OPTIONS = [0, 1, 2]; // bars
  const BEATS_OPTIONS = [2, 3, 4, 6];

  // Internal, never displayed, so not $state.
  let transcriber: LiveTranscriber | null = null;
  let synth: Tone.Synth | null = null;
  let scheduled: ScheduledClip | null = null;
  let metronome: Metronome | null = null;

  // Displayed. Big, replaced wholesale, never mutated: $state.raw skips deep proxying.
  let recording = $state(false);
  let tempo = $state({ bpm: 100, beatsPerBar: 4, countInBars: 1, metronome: true });
  let takeBpm = $state(100); // the tempo the take was sung to; notes are placed by it
  let beat = $state<number | null>(null); // current beat while the transport runs
  let countInBeats = $state(0);
  const countingIn = $derived(recording && beat !== null && beat < countInBeats);
  let error = $state('');
  let live = $state.raw<Transcription | null>(null); // the take so far, while recording
  let take = $state.raw<Transcription | null>(null); // the finished take
  let settings = $state<{
    notes: NoteSettings;
    expression: ExpressionSettings;
    quantize: QuantizeSettings;
  }>({
    notes: { ...DEFAULT_NOTE_SETTINGS },
    expression: { ...DEFAULT_EXPRESSION_SETTINGS },
    quantize: { grid: PPQ / 4, strength: 1, durations: true }
  });

  // Everything below re-derives instantly when a setting changes; the take is never modified.
  const current = $derived(take ?? live);
  const notes = $derived(
    current
      ? buildNotes(current, settings.notes, { samples: current.audio, sampleRate: current.sampleRate })
      : []
  );
  const tuningCents = $derived(
    notes.length ? notes.reduce((sum, n) => sum + n.referenceCents, 0) / notes.length : 0
  );
  const clip = $derived.by(() => {
    if (!take) return null;
    const c = toClip(notes, takeBpm, settings.expression, 'take');
    return { ...c, notes: removeOverlaps(quantizeNotes(c.notes, settings.quantize)) };
  });

  // The chart shows pYIN's pitch track (what the notes are built from) under the notes.
  const debugFrames = $derived.by((): PitchFrame[] => {
    const t = current?.track;
    if (!t) return [];
    return t.times.map((time, i) => ({ time, hz: t.hz[i], clarity: t.prob[i], rms: 1 }));
  });
  const debugNotes = $derived(
    notes.map(
      (n: TranscribedNote): DebugNote => ({
        start: n.start,
        end: n.end,
        pitch: n.pitch,
        t: n.curve.t,
        cleaned: interpretNote(n, settings.expression).curve
      })
    )
  );

  // How far a note was from the singer's own tuning (not from A440).
  const offsetFromTuning = (n: TranscribedNote) => (n.sung - n.pitch) * 100 - n.referenceCents;

  function noteName(midi: number) {
    return Midi.midiToNoteName(Math.round(midi));
  }

  // Reset the transport and put the metronome on it at the current tempo.
  function prepareTransport() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(); // clear anything scheduled before
    transport.position = 0;
    transport.bpm.value = tempo.bpm;
    transport.timeSignature = tempo.beatsPerBar;

    metronome ??= new Metronome();
    metronome.beatsPerBar = tempo.beatsPerBar;
    metronome.enabled = tempo.metronome;
    metronome.onBeat = (b) => (beat = b);
    metronome.schedule();
    return transport;
  }

  async function startRecording() {
    await liveInput.start();
    if (!liveInput.listening) return; // e.g. permission denied

    stopPlayback();
    error = '';
    live = null;
    take = null;
    takeBpm = tempo.bpm;
    countInBeats = tempo.countInBars * tempo.beatsPerBar;

    // Transport time 0 starts the count-in; the take starts on the downbeat after it,
    // so the take's time 0 is bar 1, beat 1 and the quantize grid lines up with the clicks.
    const transport = prepareTransport();
    const startAt = Tone.now() + 0.1;
    const downbeat = startAt + (countInBeats * 60) / tempo.bpm;
    transport.start(startAt);

    transcriber = new LiveTranscriber(liveInput, (t) => (live = t));
    // The mic hears you sing on a click a little after it was scheduled.
    transcriber.start(downbeat + latency.value);
    recording = true;
  }

  function stopRecording() {
    if (!transcriber) return;
    recording = false;
    Tone.getTransport().stop();
    metronome?.unschedule();
    Tone.getDraw().cancel(0);
    beat = null;
    take = transcriber.stop();
    transcriber = null;
    live = null;
  }

  // Stopped during the count-in: nothing was sung, so throw the take away.
  function cancelRecording() {
    recording = false;
    Tone.getTransport().stop();
    metronome?.unschedule();
    Tone.getDraw().cancel(0);
    beat = null;
    transcriber?.stop();
    transcriber = null;
    live = null;
  }

  function toggleRecording() {
    if (countingIn) cancelRecording();
    else if (recording) stopRecording();
    else startRecording();
  }

  async function play() {
    if (!clip) return;
    await initAudio();
    scheduled?.dispose();
    const transport = prepareTransport();
    synth ??= new Tone.Synth().toDestination();
    scheduled = scheduleClip(clip, synth);
    transport.start();
  }

  function stopPlayback() {
    Tone.getTransport().stop();
    metronome?.unschedule();
    Tone.getDraw().cancel(0);
    beat = null;
    synth?.triggerRelease(); // silence the note still sounding
  }

  function exportMidi() {
    if (clip) downloadBlob(clipsToMidi([clip], tempo.bpm), 'melody.mid');
  }

  // The take's audio as a file, to replay as a regression test (see takes.test.ts).
  function saveTake() {
    if (!take) return;
    const file = encodeTake(take.audio, take.sampleRate, takeBpm);
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    downloadBlob(blob, `take-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  }

  // Clean up when leaving the page.
  $effect(() => () => {
    transcriber?.stop();
    liveInput.stop();
    stopPlayback();
    scheduled?.dispose();
    synth?.dispose();
    metronome?.dispose();
  });
</script>

<main class="mx-auto flex max-w-3xl flex-col items-center gap-8 p-12">
  <Tuner input={liveInput} />

  <div class="flex flex-wrap justify-center gap-2">
    <Button variant={recording ? 'destructive' : 'default'} onclick={toggleRecording}>
      {countingIn ? 'Cancel' : recording ? 'Stop' : 'Record'}
    </Button>
    <Button variant="outline" onclick={play} disabled={!clip || recording}>Play</Button>
    <Button variant="outline" onclick={stopPlayback} disabled={!clip}>Stop playback</Button>
    <Button variant="outline" onclick={exportMidi} disabled={!clip || clip.notes.length === 0}>
      Export MIDI
    </Button>
    <Button variant="outline" onclick={saveTake} disabled={!take}>Save take</Button>
  </div>

  <div class="flex h-8 items-center gap-2" aria-live="polite">
    {#if beat !== null}
      {@const inBar = (beat % tempo.beatsPerBar) + 1}
      {#each Array.from({ length: tempo.beatsPerBar }, (_, i) => i + 1) as b (b)}
        <span
          class="size-3 rounded-full transition-colors {b === inBar
            ? countingIn
              ? 'bg-amber-500'
              : 'bg-primary'
            : 'bg-muted'}"
        ></span>
      {/each}
      <span class="text-muted-foreground ml-2 w-28 font-mono text-sm">
        {#if countingIn}
          count-in {countInBeats - beat}
        {:else}
          bar {Math.floor((beat - (recording ? countInBeats : 0)) / tempo.beatsPerBar) + 1}
        {/if}
      </span>
    {/if}
  </div>

  <section class="flex w-full flex-col gap-4 rounded-lg border p-4">
    <h2 class="text-sm font-semibold">Tempo</h2>

    <div class="flex flex-col gap-2">
      <Label>BPM: {tempo.bpm}</Label>
      <Slider type="single" bind:value={tempo.bpm} min={40} max={240} step={1} disabled={recording} />
    </div>

    <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div class="flex items-center gap-2">
        <Label>Beats per bar</Label>
        <ToggleGroup.Root
          type="single"
          disabled={recording}
          bind:value={
            () => String(tempo.beatsPerBar),
            (v) => {
              if (v) tempo.beatsPerBar = Number(v);
            }
          }
        >
          {#each BEATS_OPTIONS as n (n)}
            <ToggleGroup.Item value={String(n)}>{n}</ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </div>

      <div class="flex items-center gap-2">
        <Label>Count-in</Label>
        <ToggleGroup.Root
          type="single"
          disabled={recording}
          bind:value={
            () => String(tempo.countInBars),
            (v) => {
              if (v) tempo.countInBars = Number(v);
            }
          }
        >
          {#each COUNT_IN_OPTIONS as n (n)}
            <ToggleGroup.Item value={String(n)}>{n === 0 ? 'Off' : `${n} bar${n > 1 ? 's' : ''}`}</ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </div>

      <div class="flex items-center gap-2">
        <Switch
          id="metronome"
          bind:checked={
            () => tempo.metronome,
            (v) => {
              tempo.metronome = v;
              if (metronome) metronome.enabled = v; // takes effect on the next click
            }
          }
        />
        <Label for="metronome">Metronome</Label>
      </div>
    </div>
    {#if take && takeBpm !== tempo.bpm}
      <p class="text-muted-foreground text-xs">
        Recorded at {takeBpm} BPM; playing at {tempo.bpm} changes the speed.
      </p>
    {/if}
  </section>

  <DeviceSelect disabled={recording} />

  <LatencyCalibration input={liveInput} disabled={recording} />

  {#if liveInput.error || error}
    <p class="text-destructive text-sm">{liveInput.error || error}</p>
  {/if}

  {#if debugFrames.length > 0}
    <DebugContour frames={debugFrames} notes={debugNotes} minClarity={0.5} />
  {/if}

  <section class="flex w-full flex-col gap-4 rounded-lg border p-4">
    <h2 class="text-sm font-semibold">Note detection</h2>

    <div class="flex flex-col gap-2">
      <Label>Minimum note: {Math.round(settings.notes.minNoteSec * 1000)} ms</Label>
      <Slider type="single" bind:value={settings.notes.minNoteSec} min={0.1} max={0.4} step={0.01} />
    </div>

    <div class="flex items-center gap-2">
      <Switch id="relative" bind:checked={settings.notes.relativeTuning} />
      <Label for="relative">
        Name notes against your own tuning
        {#if settings.notes.relativeTuning && notes.length}
          <span class="text-muted-foreground">
            (yours: {tuningCents > 0 ? '+' : ''}{Math.round(tuningCents)}¢ from A440)
          </span>
        {/if}
      </Label>
    </div>

    {#if settings.notes.relativeTuning}
      <div class="flex flex-col gap-2">
        <Label>Tuning follows drift over: {settings.notes.referenceSec} s</Label>
        <Slider type="single" bind:value={settings.notes.referenceSec} min={2} max={60} step={1} />
      </div>
    {/if}

    <h2 class="mt-2 text-sm font-semibold">Expression</h2>

    <div class="flex flex-col gap-2">
      <Label>Pitch correction: {Math.round(settings.expression.correction * 100)}%</Label>
      <Slider type="single" bind:value={settings.expression.correction} min={0} max={1} step={0.05} />
    </div>

    <div class="flex flex-col gap-2">
      <Label>Vibrato kept: {Math.round(settings.expression.vibrato * 100)}%</Label>
      <Slider type="single" bind:value={settings.expression.vibrato} min={0} max={1} step={0.05} />
    </div>

    <div class="flex flex-col gap-2">
      <Label>Drift and scoops kept: {Math.round(settings.expression.drift * 100)}%</Label>
      <Slider type="single" bind:value={settings.expression.drift} min={0} max={1} step={0.05} />
    </div>
    <p class="text-muted-foreground text-xs">
      The voice's natural fast roughness is always removed; a synth makes it sound broken.
    </p>

    <h2 class="mt-2 text-sm font-semibold">Quantize</h2>

    <ToggleGroup.Root
      type="single"
      bind:value={
        () => String(settings.quantize.grid),
        (v) => {
          if (v) settings.quantize.grid = Number(v);
        }
      }
    >
      {#each GRID_OPTIONS as option (option.ticks)}
        <ToggleGroup.Item value={String(option.ticks)}>{option.label}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>

    <div class="flex flex-col gap-2">
      <Label>Strength: {Math.round(settings.quantize.strength * 100)}%</Label>
      <Slider type="single" bind:value={settings.quantize.strength} min={0} max={1} step={0.05} />
    </div>

    <div class="flex items-center gap-2">
      <Switch id="durations" bind:checked={settings.quantize.durations} />
      <Label for="durations">Quantize note lengths</Label>
    </div>
  </section>

  <ol class="w-full space-y-1 font-mono text-sm">
    {#each notes as note (note.id)}
      {@const interp = interpretNote(note, settings.expression)}
      {@const off = offsetFromTuning(note)}
      <li class="flex flex-wrap items-center gap-2">
        <span class="w-10">{noteName(note.pitch)}</span>
        {#if note.alternatives.length}
          <span
            class="rounded bg-violet-500/15 px-1.5 text-violet-600"
            title="The audio is ambiguous: it could also be these"
          >
            or {note.alternatives.map(noteName).join(' / ')}?
          </span>
        {/if}
        {#if Math.abs(off) >= 15}
          <span class="rounded bg-amber-500/15 px-1.5 text-amber-600">
            {off > 0 ? '+' : ''}{Math.round(off)}¢
          </span>
        {/if}
        {#if Math.abs(interp.driftCents) >= 30}
          <span class="rounded bg-sky-500/15 px-1.5 text-sky-600">
            drift {interp.driftCents > 0 ? '+' : ''}{Math.round(interp.driftCents)}¢
          </span>
        {/if}
        <span class="text-muted-foreground ml-auto">
          {note.start.toFixed(2)}s · {(note.end - note.start).toFixed(2)}s
        </span>
      </li>
    {:else}
      {#if take}
        <li class="text-muted-foreground">No notes detected. Try singing "da da da" a bit louder.</li>
      {:else if recording}
        <li class="text-muted-foreground">Notes appear a couple of seconds after you sing them.</li>
      {/if}
    {/each}
  </ol>
</main>
