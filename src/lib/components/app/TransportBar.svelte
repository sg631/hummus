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
  import { loadProjectSamples, missingSounds, playProject, scheduleProject, setMasterVolume, setPlaybackLoop, setPlaybackMetronome, stopProject } from '$lib/audio/mixer';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { applyShifts, formatShift } from '$lib/music/shift-keys';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { shiftKeys, startShiftKeys, stopShiftKeys } from '$lib/state/shift-keys.svelte';
  import {
    recordIntoClip,
    automationFor,
    addPlacement,
    currentClip,
    newContent,
    addVoiceClip,
    project,
    selectedTrack
  } from '$lib/state/project.svelte';
  import { beatTicks } from '$lib/music/time';
  import { playhead, startPlayhead, stopPlayhead } from '$lib/state/playhead.svelte';
  import { checkpoint } from '$lib/state/history.svelte';
  import { recorder } from '$lib/state/recorder.svelte';
  import { rememberTake } from '$lib/state/takes.svelte';
  import { view } from '$lib/state/view.svelte';
  import { repairProject } from '$lib/music/repair';
  import { resetAutomationWrite } from '$lib/state/automation.svelte';
  import { library, saveNow } from '$lib/state/projects.svelte';
  import { transportActions, ui } from '$lib/state/ui.svelte';
  import { liveKeys, setComputerKeys, startKeyCapture, stopKeyCapture } from '$lib/state/live-keys.svelte';
  import { shown } from '$lib/state/automation.svelte';
  import { KEY_SHIFT, TUNING } from '$lib/music/automation';
  import { patternProject, shiftProject } from '$lib/music/arrange';
  import { foldNotes, lastPassNotes, slicePasses } from '$lib/music/looper';
  import { placementAt } from '$lib/music/arrange';
  import { secondsToTicks, ticksToSeconds } from '$lib/music/time';
  import type { MidiTrack, NoteClip } from '$lib/music/types';
  import { tracksToMidi } from '$lib/music/midi';
  import { expandPlacements } from '$lib/music/arrange';
  import { barTicks } from '$lib/music/time';
  import { downloadBlob } from '$lib/download';
  import { openIntro } from '$lib/guide/guide.svelte';
  import { recordingSettings, saveRecordingSettings } from '$lib/state/settings.svelte';
  import { takeToClip } from '$lib/transcription';
  import SettingsDialog from './SettingsDialog.svelte';
  import BpmInput from './BpmInput.svelte';
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

  // "bar 2 · beat 3" from the playhead.
  const position = $derived.by(() => {
    const beat = Math.floor(Math.max(0, playhead.ticks) / beatTicks(project.timeSignature));
    const perBar = project.timeSignature[0];
    return `bar ${Math.floor(beat / perBar) + 1} · beat ${(beat % perBar) + 1}`;
  });

  // Play: the whole song from the playhead, or (pattern mode) the selected track's current
  // clip / pattern on a loop.
  async function play() {
    // Broken numbers (a block at position NaN…) would stop a track playing: mend them first.
    resetAutomationWrite(); // recording automation: a fresh pass
    const fixed = repairProject(project);
    if (fixed.length) console.warn('Repaired before playing:', fixed);
    message = 'Loading…';
    try {
      const track = selectedTrack();
      if (view.play === 'pattern' && track) {
        const pat = patternProject(project, track.id, playhead.cursor, recordingSettings.loopBars);
        if (!pat) throw new Error('nothing to loop');
        await playProject(pat.project, { metronome: recordingSettings.metronome, loop: pat.length });
        startPlayhead(0, { trackId: track.id, clipId: track.kind === 'voice' ? undefined : track.current, origin: pat.origin });
      } else {
        // From the start position (the ruler), or round the loop region if the loop is on.
        // The first time, sampled instruments download first.
        await playProject(project, { metronome: recordingSettings.metronome, from: playhead.cursor, region: project.loop?.enabled ? project.loop : undefined });
        startPlayhead();
      }
      message = view.play === 'pattern' && !track ? 'Pattern mode: select a track to loop it. Playing the song.' : '';
      if (missingSounds.length) message = `Not saved for offline use, so silent: ${missingSounds.join(', ')} (File → Work offline…)`;
    } catch (e) {
      message = `Could not play: ${e instanceof Error ? e.message : e}`;
      return;
    }
    playing = true;
  }

  function stop() {
    stopProject();
    stopPlayhead();
    playing = false;
  }

  // What the recording is doing: from the playhead in the song, or looping (pattern mode).
  // `keys`: a melody track recording what's played on a keyboard (Input: Keys), not sung.
  let recording: ({ mode: 'song'; from: number; punch?: { start: number; end: number } } | { mode: 'loop'; loopTicks: number; origin: number }) & { keys?: boolean } | null = null;

  // Record into the selected track: its notes (melody track) or its audio (voice track).
  // Song mode: from the playhead's bar, everything else playing along; the take goes there.
  // Pattern mode (looper): the clip / loop repeats while you sing; every pass is layered.
  async function toggleRecord() {
    const track = selectedTrack();
    if (!track || track.kind === 'drums') return;

    if (recorder.recording) {
      if (recorder.countingIn) {
        stopShiftKeys();
        stopKeyCapture();
        recorder.cancel();
        stopProject();
        stopPlayhead();
        return;
      }
      const changes = stopShiftKeys();
      const played = stopKeyCapture(); // Input: Keys: the notes played
      const result = recorder.stop();
      stopProject(); // silence the play-along
      stopPlayhead();
      const how = recording;
      recording = null;
      if (!result || !how) return;
      if (track.kind === 'midi') {
        checkpoint(track, how.mode === 'loop' ? 'Loop record' : 'Record'); // Ctrl+Z brings the old notes back
        let clip: NoteClip;
        let takeTicks: number;
        if (how.keys || !result.take) {
          // Played: the notes as they were played (no transcription, no quantizing).
          const end = Math.max(0, ...played.notes.map((n) => n.start + n.duration));
          clip = { id: crypto.randomUUID(), start: 0, duration: end, notes: played.notes };
          takeTicks = played.length;
        } else {
          clip = takeToClip(result.take, result.bpm, result.timeSignature, $state.snapshot(recordingSettings.take));
          applyShifts(clip, changes, result.bpm); // the shift keys held while singing
          // Kept (this session) so the piano roll can redo the transcription, add the voice…
          rememberTake(track.id, { take: result.take, bpm: result.bpm, timeSignature: result.timeSignature, shifts: changes });
          takeTicks = secondsToTicks(result.take.duration, result.bpm);
        }
        if (how.mode === 'song' && how.punch) {
          // Punch in/out: only what fell inside the loop region (song ticks), cut at its end.
          const lo = how.punch.start - how.from;
          const hi = how.punch.end - how.from;
          clip.notes = clip.notes.filter((n) => n.start >= lo && n.start < hi).map((n) => ({ ...n, duration: Math.min(n.duration, hi - n.start) }));
          clip.source = undefined;
        }
        const noNotes = how.keys ? 'No notes played.' : 'No notes heard: try singing louder.';
        const current = currentClip(track);
        // Over (overdub) adds notes; Replace swaps them. Only tracks that allow polyphony can
        // record over: one note at a time can't hold two layers.
        const over = !!track.poly && recordingSettings.overdub;
        const sung = $state.snapshot(clip.notes) as typeof clip.notes;
        const playing = placementAt(track.placements.filter((p) => p.clipId === current.id), how.mode === 'song' ? how.from : 0, (p) => p.length ?? Infinity);
        if (how.mode === 'loop' && over && (current.notes.length || clip.duration > how.loopTicks)) {
          // Layers: every pass's notes, folded onto the loop, added to the clip.
          current.notes.push(...foldNotes(sung, how.loopTicks));
          current.duration = Math.max(current.duration, how.loopTicks);
          current.source = undefined; // several passes: not one take to re-quantize from
          message = `Layered ${clip.notes.length} notes onto the loop`;
        } else if (how.mode === 'loop' && clip.duration > how.loopTicks) {
          // Replace, several passes: the last full one.
          current.notes = lastPassNotes(sung, how.loopTicks, takeTicks);
          current.duration = Math.max(current.duration, how.loopTicks);
          current.source = undefined;
          message = `Kept the last pass: ${current.notes.length} notes`;
        } else if (how.mode === 'song' && over && playing && clip.notes.length) {
          // Over, in the song: into the current clip where recording started.
          const at = how.from - playing.start;
          current.notes.push(...sung.map((n) => ({ ...n, start: n.start + at })));
          current.duration = Math.max(current.duration, ...current.notes.map((n) => n.start + n.duration));
          current.source = undefined;
          message = `Added ${clip.notes.length} notes`;
        } else if (how.mode === 'loop' || isEmptyAt(track, current.id, how.from)) {
          recordIntoClip(track.id, clip); // the clip being edited (empty, or one pass)
          message = clip.notes.length ? `${clip.notes.length} notes` : noNotes;
        } else if (!clip.notes.length) {
          message = noNotes; // no empty clip left behind
        } else {
          // Song mode: a new clip, placed where recording started.
          const take = newContent(track);
          addPlacement(track, take.id, how.from);
          recordIntoClip(track.id, clip);
          message = clip.notes.length ? `${clip.notes.length} notes, at bar ${Math.floor(how.from / barTicks(project.timeSignature)) + 1}` : noNotes;
        }
      } else if (result.take) {
        const voice = { audio: result.take.audio, sampleRate: result.take.sampleRate, recordedBpm: result.bpm };
        if (how.mode === 'loop') {
          // Layers: one recording per pass, all at the loop's start.
          const passes = slicePasses(result.take.audio, result.take.sampleRate, ticksToSeconds(how.loopTicks, result.bpm));
          for (const audio of passes) addVoiceClip(track.id, { ...voice, id: crypto.randomUUID(), start: how.origin, audio });
          message = `${passes.length} layer${passes.length > 1 ? 's' : ''} recorded`;
        } else {
          if (how.punch) {
            // Punch in/out: the recording plays only inside the loop region.
            const sec = (ticks: number) => ticksToSeconds(ticks, result.bpm);
            addVoiceClip(track.id, { ...voice, id: crypto.randomUUID(), start: how.punch.start, edit: { trimStart: sec(how.punch.start - how.from), trimEnd: Math.min(voice.audio.length / voice.sampleRate, sec(how.punch.end - how.from)) } });
            message = 'Punched in.';
          } else {
            addVoiceClip(track.id, { ...voice, id: crypto.randomUUID(), start: how.from });
            message = 'Voice recorded.';
          }
        }
      }
      return;
    }

    stop();
    message = 'Loading instruments…';
    await loadProjectSamples(project); // sampled instruments playing along must be ready
    message = '';
    const bar = barTicks(project.timeSignature);
    let playAlong: ((offset: number) => void) | undefined;
    let loopTicks: number | undefined;
    if (view.play === 'pattern') {
      // Looper: the track's clip (or loop) repeats; you hear the layers so far.
      const pat = patternProject(project, track.id, playhead.cursor, recordingSettings.loopBars);
      if (!pat) return;
      loopTicks = pat.length;
      recording = { mode: 'loop', loopTicks, origin: pat.origin };
      playAlong = (offset) => scheduleProject(pat.project, offset);
    } else {
      // From the playhead's bar; punching in: from a bar before the loop region (a run-up).
      const punch = recordingSettings.punch && project.loop && project.loop.end > project.loop.start ? { start: project.loop.start, end: project.loop.end } : undefined;
      const from = punch ? Math.max(0, Math.floor((punch.start - bar) / bar) * bar) : Math.floor(playhead.cursor / bar) * bar;
      recording = { mode: 'song', from, punch };
      // Every track except the one being recorded (you'd hear the old take otherwise).
      const others = { ...project, tracks: project.tracks.filter((t) => t.id !== track.id) };
      if (recordingSettings.playAlong) playAlong = (offset) => scheduleProject(shiftProject(others, from), offset);
    }
    // Input: Keys records what's played on a melody track (the mic isn't used).
    const keys = track.kind === 'midi' && recordingSettings.input === 'keys';
    recording!.keys = keys;
    if (keys && !liveKeys.computer && !liveKeys.midi) setComputerKeys(true);
    const started = await recorder.start({
      bpm: project.bpm,
      timeSignature: project.timeSignature,
      countInBars: recordingSettings.countInBars,
      metronome: recordingSettings.metronome,
      playAlong,
      loopTicks,
      mic: !keys,
      songTick: recording!.mode === 'loop' ? recording!.origin : recording!.from
    });
    if (!started) {
      recording = null;
      message = 'The microphone is blocked: allow it in the browser.';
      return;
    }
    if (keys) message = liveKeys.layout === 'compact' ? 'Recording what you play: A S D F G H, Q W E R T Y (or a MIDI keyboard).' : 'Recording what you play: A S D F… and W E T… (or a MIDI keyboard).';
    const countIn = recorder.countInBeats * beatTicks(project.timeSignature);
    const how = recording!;
    if (how.mode === 'loop') startPlayhead(countIn, { trackId: track.id, clipId: track.kind === 'voice' ? undefined : track.current, origin: how.origin });
    else startPlayhead(countIn - how.from); // ticks read in the song, from the recording's bar
    if (keys) startKeyCapture(recorder.takeStart, project.bpm);
    else if (track.kind === 'midi') startShiftKeys(recorder.takeStart);
  }

  // Whether a clip is empty and placed exactly where recording starts (e.g. a new track):
  // then the take goes into it rather than into a new clip.
  function isEmptyAt(track: MidiTrack, clipId: string, at: number) {
    const clip = track.clips.find((c) => c.id === clipId);
    return !!clip && !clip.notes.length && track.placements.some((p) => p.clipId === clipId && p.start === at);
  }

  // The loop: Song mode repeats the loop region (moved on the playlist's ruler). Heard
  // straight away while the song plays.
  function toggleLoop() {
    project.loop ??= { start: 0, end: 4 * barTicks(project.timeSignature), enabled: false };
    project.loop.enabled = !project.loop.enabled;
    if (playing && !playhead.pattern) setPlaybackLoop(project.loop.enabled ? project.loop : null);
  }
  $effect(() => {
    // The region moved while looping: follow it.
    const l = project.loop;
    if (l?.enabled && playing && !playhead.pattern) setPlaybackLoop({ start: l.start, end: l.end });
  });

  // The metronome button: clicks while recording and playing, switched live.
  function toggleMetronome() {
    recordingSettings.metronome = !recordingSettings.metronome;
    setPlaybackMetronome(recordingSettings.metronome);
    recorder.setMetronome(recordingSettings.metronome);
  }

  // The menu bar's Transport menu presses these.
  $effect(() => {
    ui.playing = playing;
  });
  Object.assign(transportActions, {
    play: () => play(),
    stop: () => stop(),
    togglePlay: () => (playing ? stop() : play()),
    toggleRecord: () => toggleRecord(),
    toggleLoop: () => toggleLoop(),
    toggleMetronome: () => toggleMetronome(),
    exportMidi: () => exportMidi()
  });

  // Master volume: heard straight away, whether playing or not.
  $effect(() => setMasterVolume(project.masterVolume));
  const masterLane = $derived(automationFor('master', 'volume'));
  const formatSemis = (v: number) => (v === 0 ? '0 st' : `${v > 0 ? '+' : '−'}${Math.abs(v)} st`);

  const formatCents = (v: number) => (v === 0 ? 'A440' : `${v > 0 ? '+' : '−'}${Math.abs(v)}¢`);

  // Every melody track as a MIDI file (one MIDI track each).
  function exportMidi() {
    const bar = barTicks(project.timeSignature);
    const tracks = project.tracks.flatMap((t) =>
      t.kind === 'midi' ? [{ name: t.name, clips: expandPlacements($state.snapshot(t.clips), $state.snapshot(t.placements), bar) }] : []
    );
    downloadBlob(tracksToMidi(tracks, project.bpm, project.timeSignature), `${project.name || 'song'}.mid`);
  }

  async function save() {
    message = (await saveNow()) ? `Saved to ${library.where}.` : library.folder.state === 'needs-permission' ? 'Allow access to your projects folder first (File menu).' : 'Could not save.';
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

<!-- The top bar: groups of controls, each two rows high (what goes together, stacked), with
     thin dividers between groups. Scrolls sideways on narrow screens rather than wrapping.
     data-guide="…": parts the guide reveals one at a time (guide/steps.ts). -->
<div class="flex items-stretch gap-2.5 overflow-x-auto border-b px-3 py-2 whitespace-nowrap [&>*]:shrink-0">
  <!-- Transport: Play and the loop; Record and what it records from. -->
  <div class="flex w-44 flex-col gap-1.5">
    <div class="flex h-10 gap-1.5">
      <span id="tour-play" data-guide="top.play" class="flex min-w-0 flex-1">
        <Button class="h-10 w-full" onclick={playing ? stop : play} disabled={recorder.recording}>
          {playing ? '■ Stop' : '▶ Play'}
        </Button>
      </span>
      <button
        id="tour-loop"
        data-guide="top.loop"
        class="h-10 w-11 rounded-md border text-base {project.loop?.enabled ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={toggleLoop}
        aria-pressed={!!project.loop?.enabled}
        title="Loop (Song mode): repeat the loop region, drawn on the playlist's ruler">⟳</button
      >
    </div>
    <div class="flex h-10 gap-1.5">
      <span id="tour-record" data-guide="top.record" class="flex min-w-0 flex-1">
        <Button
          class="h-10 w-full"
          variant={recorder.recording ? 'destructive' : 'outline'}
          onclick={toggleRecord}
          disabled={!selectedTrack() || selectedTrack()?.kind === 'drums'}
        >
          <span class={recorder.recording ? 'text-white' : 'text-red-500'}>●</span>
          {recorder.countingIn ? 'Cancel' : recorder.recording ? 'Stop' : view.play === 'pattern' ? 'Loop rec' : 'Record'}
        </Button>
      </span>
      <button
        id="tour-input"
        data-guide="top.input"
        class="h-10 w-11 rounded-md border text-base {recordingSettings.input === 'keys' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => {
          recordingSettings.input = recordingSettings.input === 'keys' ? 'voice' : 'keys';
          saveRecordingSettings();
          if (recordingSettings.input === 'keys' && !liveKeys.computer && !liveKeys.midi) setComputerKeys(true);
        }}
        disabled={recorder.recording}
        title={recordingSettings.input === 'keys'
          ? 'Melody tracks record what you play (computer keyboard or MIDI). Click: record your voice instead'
          : 'Melody tracks record your voice. Click: record what you play on a keyboard instead'}>{recordingSettings.input === 'keys' ? '⌨' : '🎤'}</button
      >
    </div>
  </div>

  <div class="bg-border w-px" data-guide="top.mode"></div>

  <!-- What plays and how recording writes: Pattern / Song, Over / Replace. -->
  <div id="tour-mode" data-guide="top.mode" class="flex flex-col gap-1.5">
    <div class="flex h-10 items-center">
      <ToggleGroup.Root
        type="single"
        variant="outline"
        class="w-full"
        disabled={recorder.recording || playing}
        bind:value={() => view.play, (v) => v && (view.play = v as 'song' | 'pattern')}
      >
        <ToggleGroup.Item class="flex-1" value="pattern" title="Loop the selected track's clip or pattern (Record layers each pass)">Pattern</ToggleGroup.Item>
        <ToggleGroup.Item class="flex-1" value="song" title="Play the whole song (Record from the playhead)">Song</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
    <!-- Recording into a track that allows polyphony: add to its notes, or replace them. -->
    <div
      class="flex h-10 items-center"
      title={selectedTrack()?.kind === 'midi' && (selectedTrack() as MidiTrack).poly
        ? 'Over: recording adds notes (loop: every pass layered). Replace: recording replaces them (loop: the last full pass).'
        : 'Turn on "Allow Polyphony" on the track to record over its notes'}
    >
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="outline"
        class="w-full"
        disabled={recorder.recording || !(selectedTrack()?.kind === 'midi' && (selectedTrack() as MidiTrack).poly)}
        bind:value={() => (recordingSettings.overdub ? 'over' : 'replace'), (v) => v && (recordingSettings.overdub = v === 'over')}
      >
        <ToggleGroup.Item class="flex-1" value="over">Over</ToggleGroup.Item>
        <ToggleGroup.Item class="flex-1" value="replace">Replace</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
  </div>

  <div class="bg-border w-px" data-guide="top.count"></div>

  <!-- Count-in; the project: Save, Settings. -->
  <div class="flex flex-col gap-1.5" data-guide="top.count">
    <!-- Count-in: bars of clicks before recording starts (also in Settings → Recording). -->
    <div class="flex h-10 items-center gap-2" title="Bars of clicks before recording starts">
      <span class="text-muted-foreground w-14 text-xs">Count-in</span>
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="outline"
        class="flex-1"
        disabled={recorder.recording}
        bind:value={() => String(recordingSettings.countInBars), (v) => v && (recordingSettings.countInBars = Number(v))}
      >
        <ToggleGroup.Item class="flex-1" value="0" aria-label="No count-in">Off</ToggleGroup.Item>
        <ToggleGroup.Item class="flex-1" value="1" aria-label="One bar">1</ToggleGroup.Item>
        <ToggleGroup.Item class="flex-1" value="2" aria-label="Two bars">2</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
    <div class="grid h-10 grid-cols-2 gap-1.5">
      <span id="tour-save" class="flex">
        <Button class="h-10 w-full" variant="outline" onclick={save} disabled={recorder.recording}>Save</Button>
      </span>
      <span id="tour-settings" class="flex">
        <Button class="h-10 w-full" variant="outline" onclick={() => (ui.settingsOpen = true)} disabled={recorder.recording}>Settings</Button>
      </span>
    </div>
  </div>

  <div class="bg-border w-px" data-guide="top.song"></div>

  <!-- Time: tempo; time signature and metronome. -->
  <div id="tour-song" data-guide="top.song" class="flex flex-col gap-1.5">
    <div class="flex h-10 items-center">
      <!-- Tempo, as wide as the two below it. Changing it while playing applies on the next Play. -->
      <div id="tour-bpm" class="w-full"><BpmInput disabled={recorder.recording} /></div>
    </div>
    <div class="flex h-10 items-center gap-2">
      <TimeSignatureInput disabled={recorder.recording} />
      <button
        class="flex h-10 w-11 items-center justify-center rounded-md border text-xs {recordingSettings.metronome ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={toggleMetronome}
        aria-pressed={recordingSettings.metronome}
        title="Metronome {recordingSettings.metronome ? 'on' : 'off'}"
      >
        <!-- A metronome: the case, and its pendulum. -->
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 3h6l4 18H5L9 3z" />
          <path d="M12 17l5-11" />
          <path d="M8 17h8" />
        </svg>
      </button>
    </div>
  </div>

  <div class="bg-border w-px" data-guide="top.sound"></div>

  <!-- Sound: master volume, key shift (semitones), tuning (cents). Full knobs. -->
  <div id="tour-sound" data-guide="top.sound" class="flex items-center gap-3">
    <div title="Master volume: everything you hear">
      <Knob
        label="Master"
        size={40}
        bind:value={() => shown(masterLane, project.masterVolume), (v) => (project.masterVolume = v)}
        min={-40}
        max={6}
        step={0.5}
        defaultValue={0}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 2) / 2} dB`}
        color={masterLane?.enabled ? 'rgb(245 158 11)' : undefined}
        automate={{ kind: 'mix', ownerId: 'master', param: 'volume' }}
      />
    </div>
    <div title="Key shift: moves every melody and voice recording up or down (drums stay)">
      <Knob label="Key" size={40} bind:value={() => shown(automationFor('song', 'transpose'), project.transpose), (v) => (project.transpose = v)} min={-12} max={12} step={1} defaultValue={0} format={formatSemis} automate={KEY_SHIFT} />
    </div>
    <div title="Tuning: fine shift of every instrument and voice (double-click: back to A440)">
      <Knob label="Tune" size={40} bind:value={() => shown(automationFor('song', 'detune'), project.detune), (v) => (project.detune = v)} min={-100} max={100} step={1} defaultValue={0} format={formatCents} automate={TUNING} />
    </div>
  </div>

  <div class="bg-border w-px" data-guide="top.extra"></div>

  <!-- Out: MIDI; help: Tour. Side by side, centred in the bar's height. -->
  <div class="flex items-center gap-1.5 self-center" data-guide="top.extra">
    <Button
      class="h-10"
      variant="outline"
      onclick={exportMidi}
      disabled={recorder.recording || !project.tracks.some((t) => t.kind === 'midi' && t.clips.some((c) => c.notes.length))}
      title="Export MIDI: download every melody track's notes as a MIDI file">MIDI ↓</Button
    >
    <Button class="h-10 px-3" variant="outline" onclick={openIntro} disabled={recorder.recording} title="The guide: build a first song, one feature at a time">Guide</Button>
  </div>

  <!-- On the right: the mic (a tuner); where the playhead is, the shift keys, the key. -->
  <div class="ml-auto flex flex-col items-end gap-1.5" data-guide="top.right">
    <div class="flex h-10 items-center"><MicMeter /></div>
    <div class="text-muted-foreground flex h-10 items-center gap-2 text-xs">
      <!-- While recording a melody: the shift held now (shift keys, music/shift-keys.ts). -->
      {#if shiftKeys.active}
        <span
          class="rounded px-2 py-1 font-mono {shiftKeys.shift ? 'bg-amber-500 text-white' : 'bg-muted'}"
          title="Hold 1–9 / 0 (+ semitones), with − to go down; Z X C V: −2 −1 +1 +2 octaves; ` held: slide to the new note"
        >
          shift {formatShift(shiftKeys.shift)}{shiftKeys.slide ? ' · slide' : ''}
        </span>
      {/if}
      <span class="font-mono">
        {#if recorder.countingIn && recorder.beat !== null}
          count-in {recorder.beat + 1}
        {:else if playhead.running}
          {position}
        {:else}
          stopped
        {/if}
      </span>
      <span title="Key (Settings → Song)">{project.key} {project.scale}</span>
    </div>
  </div>

  <!-- Messages (saved, mic blocked…) as a toast: they don't push the bar around. -->
  {#if message}
    <div class="bg-popover text-popover-foreground pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3 py-1.5 text-sm shadow-md" role="status">
      {message}
    </div>
  {/if}
</div>

<SettingsDialog bind:open={ui.settingsOpen} />
