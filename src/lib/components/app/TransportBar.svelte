<!--
  The top bar: play / stop, tempo, and record into the selected track.

  Svelte reminders:
  - onclick={fn} runs fn on click; `async` functions are fine.
  - bind:value={project.bpm} keeps an input (or Slider) and the value in sync.
  - {#if …}…{:else}…{/if} shows one thing or another.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { project, selectedTrack } from '$lib/state/project.svelte';
  import { recorder } from '$lib/state/recorder.svelte';

  let playing = $state(false);

  // TODO(you): playProject(project) from audio/mixer.ts, then playing = true.
  async function play() {}

  // TODO(you): stopProject(), then playing = false.
  function stop() {}

  // TODO(you): record into the selected track.
  // - If recorder.recording: if recorder.countingIn, recorder.cancel(); otherwise
  //   const result = recorder.stop(), then
  //     midi track  → addNoteClip(track.id, takeToClip(result.take, result.bpm, result.timeSignature))
  //     voice track → addVoiceClip(track.id, { id: crypto.randomUUID(), start: 0,
  //                     audio: result.take.audio, sampleRate: result.take.sampleRate,
  //                     recordedBpm: result.bpm })
  //   (takeToClip is exported from $lib/transcription.)
  // - Otherwise: await recorder.start({ bpm: project.bpm, timeSignature: project.timeSignature,
  //   countInBars: 1, metronome: true, playAlong: (offset) => scheduleProject(project, offset) })
  //   (leave playAlong out at first; add it once the mixer works).
  async function toggleRecord() {}
</script>

<div class="flex flex-wrap items-center gap-3 border-b p-3">
  <Button onclick={playing ? stop : play} disabled={recorder.recording}>
    {playing ? 'Stop' : 'Play'}
  </Button>

  <Button
    variant={recorder.recording ? 'destructive' : 'outline'}
    onclick={toggleRecord}
    disabled={!selectedTrack() || selectedTrack()?.kind === 'drums'}
  >
    {recorder.countingIn ? 'Cancel' : recorder.recording ? 'Stop recording' : 'Record'}
  </Button>

  {#if recorder.beat !== null}
    <span class="font-mono text-sm">beat {recorder.beat + 1}</span>
  {/if}

  <!-- TODO(you): a BPM control. A Slider from $lib/components/ui/slider (see the test
       bench, routes/bench/+page.svelte, for how it's used) with bind:value={project.bpm}. -->
  <span class="text-sm">{project.bpm} BPM</span>
</div>
