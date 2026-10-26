<!--
  The guide's first screen: the mic as a tuner (the note you're singing, how in tune, how
  loud), and the loop as sixteen beats lighting up in turn, with which time round it is.
  `compact`: one row, for when the piano roll is open below it.
-->
<script lang="ts">
  import * as Tone from 'tone';
  import { onMount } from 'svelte';
  import NoteDisplay from '$lib/components/tuner/NoteDisplay.svelte';
  import CentsMeter from '$lib/components/tuner/CentsMeter.svelte';
  import LevelMeter from '$lib/components/tuner/LevelMeter.svelte';
  import { readNote } from '$lib/music/tuning';
  import { liveInput } from '$lib/state/live-input.svelte';
  import { project } from '$lib/state/project.svelte';
  import { recorder } from '$lib/state/recorder.svelte';

  let { compact = false, passes = 2 }: { compact?: boolean; passes?: number } = $props();

  const BARS = 4;
  const reading = $derived(liveInput.reading ? readNote(liveInput.reading.hz / 2 ** (project.detune / 1200)) : null);
  const cents = $derived(liveInput.listening && liveInput.active ? (reading?.cents ?? null) : null);

  // Where the loop is: beat 0–15 (-1: not recording), and which time round, from the clock.
  let beat = $state(-1);
  let pass = $state(0);
  let countIn = $state(0);
  onMount(() => {
    let frame = 0;
    const update = () => {
      frame = requestAnimationFrame(update);
      if (!recorder.recording) {
        beat = -1;
        countIn = 0;
        return;
      }
      const beatSec = 60 / project.bpm;
      const t = Tone.getContext().currentTime - recorder.takeStart;
      if (t < 0) {
        beat = -1;
        countIn = Math.ceil(-t / beatSec);
        return;
      }
      countIn = 0;
      const b = Math.floor(t / beatSec);
      beat = b % (BARS * 4);
      pass = Math.floor(b / (BARS * 4)) + 1;
    };
    update();
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="flex shrink-0 items-center justify-center border-b {compact ? 'gap-8 px-6 py-3' : 'min-h-0 flex-1 flex-col gap-10 p-8'}">
  <div class="flex items-center {compact ? 'gap-5' : 'flex-col gap-6'}">
    <NoteDisplay name={liveInput.listening ? (reading?.name ?? null) : null} cents={reading?.cents ?? null} hz={liveInput.reading?.hz ?? null} active={liveInput.active} size={compact ? 'md' : 'lg'} showDetails={!compact} />
    <div class="flex flex-col gap-2 {compact ? 'w-48' : 'w-72'}">
      <CentsMeter {cents} />
      <LevelMeter db={liveInput.listening ? liveInput.db : -Infinity} class="h-1.5" />
    </div>
  </div>

  <!-- The loop: four bars of four beats. -->
  <div class="flex flex-col items-center gap-2">
    <div class="flex gap-3">
      {#each Array(BARS) as _, bar (bar)}
        <div class="flex gap-1">
          {#each Array(4) as _, b (b)}
            {@const i = bar * 4 + b}
            <span
              class="rounded-sm transition-colors duration-75 {compact ? 'h-3 w-3' : 'h-5 w-5'} {i === beat ? 'bg-red-500' : i < beat ? 'bg-foreground/50' : 'bg-muted'}"
            ></span>
          {/each}
        </div>
      {/each}
    </div>
    <span class="text-muted-foreground font-mono text-xs">
      {#if countIn}
        count-in {countIn}
      {:else if recorder.recording}
        recording · {Math.min(pass, passes)} of {passes}
      {:else}
        listening
      {/if}
    </span>
  </div>
</div>
