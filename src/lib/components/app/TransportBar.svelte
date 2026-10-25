<!--
  The top bar: play / stop, tempo, record into the selected track, save, and Settings
  (time signature, key, count-in, metronome, devices, transcription: SettingsDialog).

  Svelte reminders:
  - onclick={fn} runs fn on click; `async` functions are fine.
  - bind:value={project.bpm} keeps an input (or Slider) and the value in sync.
  - {#if …}…{:else}…{/if} shows one thing or another.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { loadProjectSamples, playProject, scheduleProject, setPlaybackMetronome, stopProject } from '$lib/audio/mixer';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { applyShifts, formatShift } from '$lib/music/shift-keys';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { shiftKeys, startShiftKeys, stopShiftKeys } from '$lib/state/shift-keys.svelte';
  import {
    recordIntoClip,
    addVoiceClip,
    clearClips,
    project,
    saveProject,
    selectedTrack
  } from '$lib/state/project.svelte';
  import { beatTicks } from '$lib/music/time';
  import { playhead, startPlayhead, stopPlayhead } from '$lib/state/playhead.svelte';
  import { checkpoint } from '$lib/state/history.svelte';
  import { recorder } from '$lib/state/recorder.svelte';
  import { rememberTake } from '$lib/state/takes.svelte';
  import { tracksToMidi } from '$lib/music/midi';
  import { expandPlacements } from '$lib/music/arrange';
  import { barTicks } from '$lib/music/time';
  import { downloadBlob } from '$lib/download';
  import { startTour } from '$lib/state/tour.svelte';
  import { recordingSettings } from '$lib/state/settings.svelte';
  import { takeToClip } from '$lib/transcription';
  import SettingsDialog from './SettingsDialog.svelte';
  import BpmWheel from './BpmWheel.svelte';
  import TimeSignatureInput from './TimeSignatureInput.svelte';
  import MicMeter from './MicMeter.svelte';

  let playing = $state(false);
  let message = $state(''); // a short note (saved, mic blocked…), shown as a toast for a few seconds
  $effect(() => {
    if (!message || message.endsWith('…')) return; // "Loading…" stays until it's replaced
    const shown = message;
    const timer = setTimeout(() => message === shown && (message = ''), 4000);
    return () => clearTimeout(timer);
  });
  let settingsOpen = $state(false);

  // "bar 2 · beat 3" from the playhead.
  const position = $derived.by(() => {
    const beat = Math.floor(Math.max(0, playhead.ticks) / beatTicks(project.timeSignature));
    const perBar = project.timeSignature[0];
    return `bar ${Math.floor(beat / perBar) + 1} · beat ${(beat % perBar) + 1}`;
  });

  async function play() {
    message = 'Loading…';
    try {
      // From the start position (the piano roll's ruler). The first time, sampled instruments download first.
      await playProject(project, { metronome: recordingSettings.metronome, from: playhead.cursor });
      message = '';
    } catch (e) {
      message = `Could not play: ${e instanceof Error ? e.message : e}`;
      return;
    }
    startPlayhead();
    playing = true;
  }

  function stop() {
    stopProject();
    stopPlayhead();
    playing = false;
  }

  // Record into the selected track: its notes (melody track) or its audio (voice track).
  // The other tracks play along. A new recording replaces the track's last one.
  async function toggleRecord() {
    const track = selectedTrack();
    if (!track || track.kind === 'drums') return;

    if (recorder.recording) {
      if (recorder.countingIn) {
        stopShiftKeys();
        recorder.cancel();
        stopProject();
        stopPlayhead();
        return;
      }
      const changes = stopShiftKeys();
      const result = recorder.stop();
      stopProject(); // silence the play-along
      stopPlayhead();
      if (!result) return;
      if (track.kind === 'midi') checkpoint(track, 'Record'); // Ctrl+Z brings the old take back
      if (track.kind === 'voice') clearClips(track.id);
      if (track.kind === 'midi') {
        const clip = takeToClip(result.take, result.bpm, result.timeSignature, $state.snapshot(recordingSettings.take));
        applyShifts(clip, changes, result.bpm); // the shift keys held while singing
        recordIntoClip(track.id, clip); // into the clip the piano roll is editing
        // Kept (this session) so the piano roll can redo the transcription, add the voice…
        rememberTake(track.id, { take: result.take, bpm: result.bpm, timeSignature: result.timeSignature, shifts: changes });
        message = clip.notes.length ? `${clip.notes.length} notes` : 'No notes heard: try singing louder.';
      } else {
        addVoiceClip(track.id, {
          id: crypto.randomUUID(),
          start: 0,
          audio: result.take.audio,
          sampleRate: result.take.sampleRate,
          recordedBpm: result.bpm
        });
        message = 'Voice recorded.';
      }
      return;
    }

    stop();
    message = 'Loading instruments…';
    await loadProjectSamples(project); // sampled instruments playing along must be ready
    message = '';
    const started = await recorder.start({
      bpm: project.bpm,
      timeSignature: project.timeSignature,
      countInBars: recordingSettings.countInBars,
      metronome: recordingSettings.metronome,
      // Every track except the one being recorded (you'd hear the old take otherwise).
      playAlong: recordingSettings.playAlong
        ? (offset) => scheduleProject({ ...project, tracks: project.tracks.filter((t) => t.id !== track.id) }, offset)
        : undefined
    });
    if (!started) message = 'The microphone is blocked: allow it in the browser.';
    else {
      startPlayhead(recorder.countInBeats * beatTicks(project.timeSignature));
      if (track.kind === 'midi') startShiftKeys(recorder.takeStart);
    }
  }

  // The metronome button: clicks while recording and playing, switched live.
  function toggleMetronome() {
    recordingSettings.metronome = !recordingSettings.metronome;
    setPlaybackMetronome(recordingSettings.metronome);
    recorder.setMetronome(recordingSettings.metronome);
  }

  const formatCents = (v: number) => (v === 0 ? 'A440' : `${v > 0 ? '+' : '−'}${Math.abs(v)}¢`);

  // Every melody track as a MIDI file (one MIDI track each).
  function exportMidi() {
    const bar = barTicks(project.timeSignature);
    const tracks = project.tracks.flatMap((t) =>
      t.kind === 'midi' ? [{ name: t.name, clips: expandPlacements($state.snapshot(t.clips), $state.snapshot(t.placements), bar) }] : []
    );
    downloadBlob(tracksToMidi(tracks, project.bpm, project.timeSignature), `${project.name || 'song'}.mid`);
  }

  function save() {
    try {
      saveProject();
      message = 'Saved (voice recordings are not saved).';
    } catch (e) {
      message = `Could not save: ${e instanceof Error ? e.message : e}`;
    }
  }
</script>

<!-- Space: play / stop (not while typing, or with a window open). -->
<svelte:window
  onkeydown={(e) => {
    const target = e.target as HTMLElement;
    if (e.code !== 'Space' || recorder.recording || target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
    e.preventDefault();
    if (playing) stop();
    else play();
  }}
/>

<div class="flex flex-wrap items-center gap-3 border-b p-3">
  <!-- The id="tour-…" spans are what the guided tour (AppTour.svelte) points at. -->
  <span id="tour-play" class="inline-flex">
    <Button onclick={playing ? stop : play} disabled={recorder.recording}>
      {playing ? 'Stop' : 'Play'}
    </Button>
  </span>

  <span id="tour-record" class="inline-flex">
    <Button
      variant={recorder.recording ? 'destructive' : 'outline'}
      onclick={toggleRecord}
      disabled={!selectedTrack() || selectedTrack()?.kind === 'drums'}
    >
      {recorder.countingIn ? 'Cancel' : recorder.recording ? 'Stop recording' : 'Record'}
    </Button>
  </span>

  {#if recorder.countingIn && recorder.beat !== null}
    <span class="font-mono text-sm">count-in {recorder.beat + 1}</span>
  {:else if playhead.running}
    <span class="font-mono text-sm">{position}</span>
  {/if}

  <!-- While recording a melody: the shift held now (shift keys, music/shift-keys.ts). -->
  {#if shiftKeys.active}
    <span
      class="rounded px-2 py-1 font-mono text-xs {shiftKeys.shift ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground'}"
      title="Hold 1–9 / 0 (+ semitones), with − to go down; Z X C V: −2 −1 +1 +2 octaves; ` held: slide to the new note"
    >
      shift {formatShift(shiftKeys.shift)}{shiftKeys.slide ? ' · slide' : ''}
    </span>
  {/if}

  <!-- Song: tempo, time signature, metronome, tuning. -->
  <div id="tour-song" class="flex items-center gap-2">
    <!-- Tempo. Changing it while playing applies on the next Play. -->
    <div id="tour-bpm"><BpmWheel disabled={recorder.recording} /></div>

    <TimeSignatureInput disabled={recorder.recording} />

    <button
      class="flex h-10 w-10 items-center justify-center rounded-md border {recordingSettings.metronome ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
      onclick={toggleMetronome}
      aria-pressed={recordingSettings.metronome}
      title="Metronome {recordingSettings.metronome ? 'on' : 'off'}"
    >
      <!-- A metronome: the case, and its pendulum. -->
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 3h6l4 18H5L9 3z" />
        <path d="M12 17l5-11" />
        <path d="M8 17h8" />
      </svg>
    </button>

    <!-- Count-in: bars of clicks before recording starts (also in Settings → Recording). -->
    <div class="flex items-center gap-1.5" title="Bars of clicks before recording starts">
      <span class="text-muted-foreground text-xs">Count-in</span>
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="outline"
        disabled={recorder.recording}
        bind:value={() => String(recordingSettings.countInBars), (v) => v && (recordingSettings.countInBars = Number(v))}
      >
        <ToggleGroup.Item value="0" aria-label="No count-in">Off</ToggleGroup.Item>
        <ToggleGroup.Item value="1" aria-label="One bar">1</ToggleGroup.Item>
        <ToggleGroup.Item value="2" aria-label="Two bars">2</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>

    <div title="Tuning: shifts every instrument and voice (double-click: back to A440)">
      <Knob size={28} bind:value={project.detune} min={-100} max={100} step={1} defaultValue={0} format={formatCents} />
    </div>
  </div>

  <span id="tour-save" class="inline-flex">
    <Button variant="outline" onclick={save} disabled={recorder.recording}>Save</Button>
  </span>
  <Button
    variant="outline"
    onclick={exportMidi}
    disabled={recorder.recording || !project.tracks.some((t) => t.kind === 'midi' && t.clips.some((c) => c.notes.length))}
    title="Download every melody track's notes as a MIDI file">Export MIDI</Button
  >
  <span id="tour-settings" class="inline-flex">
    <Button variant="outline" onclick={() => (settingsOpen = true)} disabled={recorder.recording}>Settings</Button>
  </span>
  <Button variant="ghost" onclick={startTour} disabled={recorder.recording}>Tour</Button>
  <span class="text-muted-foreground text-sm">{project.key} {project.scale}</span>

  <!-- On the right: the mic's note, tuning and level (a tuner). -->
  <div class="ml-auto"><MicMeter /></div>

  <!-- Messages (saved, mic blocked…) as a toast: they don't push the bar around. -->
  {#if message}
    <div class="bg-popover text-popover-foreground pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3 py-1.5 text-sm shadow-md" role="status">
      {message}
    </div>
  {/if}
</div>

<SettingsDialog bind:open={settingsOpen} />
