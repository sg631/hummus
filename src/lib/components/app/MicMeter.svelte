<!--
  The microphone at a glance, always on the right of the top bar: the note you're singing,
  how in tune it is (a cents meter: centred = in tune; green / amber / red), and the input
  level (green, amber when loud, red when about to clip).

  Notes and cents are measured against the song's tuning (the tuning knob), not A440.
  The mic button turns it on or off; that's remembered, and an "on" mic starts on your
  first click in the app (browsers only allow the mic after a click). While recording it's
  on anyway. Built from the test bench's tuner pieces (components/tuner/).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CentsMeter from '$lib/components/tuner/CentsMeter.svelte';
  import LevelMeter from '$lib/components/tuner/LevelMeter.svelte';
  import { readNote } from '$lib/music/tuning';
  import { liveInput } from '$lib/state/live-input.svelte';
  import { project } from '$lib/state/project.svelte';
  import { recorder } from '$lib/state/recorder.svelte';

  const STORAGE_KEY = 'hum-daw:mic-meter';

  // The reading against the song's tuning: shifting A4 by `detune` cents shifts every note.
  const reading = $derived(liveInput.reading ? readNote(liveInput.reading.hz / 2 ** (project.detune / 1200)) : null);
  const cents = $derived(liveInput.listening && liveInput.active ? (reading?.cents ?? null) : null);

  function remember(on: boolean) {
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // blocked storage: it just won't be remembered
    }
  }

  function toggle() {
    if (liveInput.listening) {
      if (recorder.recording) return;
      liveInput.stop();
      remember(false);
    } else {
      liveInput.start();
      remember(true);
    }
  }

  // On last time: start on the first click anywhere.
  onMount(() => {
    let on = false;
    try {
      on = localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      on = false;
    }
    if (!on) return;
    const start = () => liveInput.start();
    window.addEventListener('pointerdown', start, { once: true });
    return () => window.removeEventListener('pointerdown', start);
  });
</script>

<div class="flex items-center gap-2">
  <button
    class="flex h-8 w-8 items-center justify-center rounded-md border {liveInput.listening ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
    onclick={toggle}
    aria-pressed={liveInput.listening}
    title={liveInput.listening ? 'Mic on (click to turn off)' : 'Mic off: click to see your pitch and level'}
  >
    <!-- A microphone (crossed out when off). -->
    <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {#if !liveInput.listening}<path d="M4 4l16 16" />{/if}
    </svg>
  </button>
  <div class="flex w-28 flex-col gap-1 {liveInput.listening ? '' : 'opacity-40'}" title="Your pitch against the song's tuning (centre: in tune), and the mic level">
    <CentsMeter {cents} class="h-2 w-full" />
    <LevelMeter db={liveInput.listening ? liveInput.db : -Infinity} class="h-1.5 w-full" />
  </div>
  <span class="w-10 font-mono text-lg leading-none {liveInput.listening && liveInput.active ? '' : 'opacity-30'}">
    {liveInput.listening ? (reading?.name ?? '--') : '--'}
  </span>
  <span class="text-muted-foreground w-10 font-mono text-xs">{cents !== null ? `${cents > 0 ? '+' : ''}${cents}¢` : ''}</span>
  {#if liveInput.error}
    <span class="text-destructive max-w-40 truncate text-xs" title={liveInput.error}>{liveInput.error}</span>
  {/if}
</div>
