<!--
  The first thing the app shows: black, the logo, "Click to enable sound". The click
  plays a tick and the guide's backing track fades in (muffled: a low-pass). Then:
  - Begin guide: the microphone prompt, a new "First song", and the studio as the guide
    shows it (GuideStage.svelte), fading in on the beat
  - Skip: everything fades out with the music, on the beat, then the home page
  Opens by itself until the guide is finished or skipped once; Help → Guide opens it again.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as Tone from 'tone';
  import Logo from '$lib/components/app/Logo.svelte';
  import { atNextBar, barSeconds, BACKING_BPM, clickSound, fadeOutBacking, startBacking } from '$lib/guide/backing';
  import { beginGuide, guide, skipGuide } from '$lib/guide/guide.svelte';
  import { liveInput } from '$lib/state/live-input.svelte';

  // black → (click) → choose → begin / skip → out (fading away)
  const soundOn = Tone.getContext().state === 'running'; // already clicked once: straight to the choice
  let phase = $state<'black' | 'choose' | 'starting' | 'leaving' | 'out'>(soundOn ? 'choose' : 'black');
  let error = $state('');
  let fade = $state(barSeconds()); // seconds: the fades last a bar of the music

  // The intro's music: drums, bass and pad, muffled.
  const INTRO = { kick: 2, snare: false, hats: 1, bass: true, pad: true, arp: false } as const;
  if (soundOn) void startBacking({ cutoff: 300, bpm: () => BACKING_BPM, layers: { ...INTRO } });

  let enabling = false;
  async function enable() {
    if (phase !== 'black' || enabling) return;
    enabling = true;
    await clickSound();
    await startBacking({ cutoff: 300, bpm: () => BACKING_BPM, layers: { ...INTRO } });
    fade = barSeconds();
    atNextBar(() => (phase = 'choose')); // the choice comes in on the beat
  }

  async function begin() {
    if (phase !== 'choose') return;
    phase = 'starting';
    error = '';
    if (!(await beginGuide())) {
      phase = 'choose';
      error = liveInput.error || 'The microphone is blocked. Allow it from the address bar, then press Begin guide again.';
      return;
    }
    // In the studio now: lift the black on the next bar.
    atNextBar(() => {
      phase = 'out';
      setTimeout(() => (guide.intro = false), fade * 1000);
    });
  }

  function skip() {
    if (phase !== 'choose') return;
    skipGuide();
    // The music and the screen fade out together, from the next bar.
    atNextBar(() => (phase = 'leaving'));
    void fadeOutBacking(1).then(async () => {
      if (page.url.pathname !== `${base}/`) await goto(`${base}/`);
      fade = 0.35; // then the home page, quickly
      phase = 'out';
      setTimeout(() => (guide.intro = false), 400);
    });
  }
</script>

<div
  class="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black text-white transition-opacity ease-in-out {phase === 'out' ? 'pointer-events-none opacity-0' : 'opacity-100'}"
  style="transition-duration: {fade}s"
  role="presentation"
  onclick={enable}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && enable()}
>
  <div class="flex flex-col items-center gap-10 transition-opacity ease-in" style="transition-duration: {fade}s; opacity: {phase === 'leaving' ? 0 : 1}">
    <img src="{base}/humdaw.png" alt="" class="h-28 w-28 rounded-full ring-1 ring-white/20" />
    <Logo class="text-7xl sm:text-8xl" />
    {#if phase === 'black'}
      <button class="intro-pulse text-sm tracking-[0.3em] text-white/70 uppercase" onclick={enable}>Click to enable sound</button>
    {:else}
      <div class="intro-in flex flex-col items-center gap-4" style="animation-duration: {fade / 2}s">
        <div class="flex gap-3">
          <button
            class="rounded-full bg-white px-7 py-2.5 text-sm font-semibold text-black transition hover:scale-105 disabled:opacity-60"
            onclick={begin}
            disabled={phase !== 'choose'}>{phase === 'starting' ? 'Starting…' : 'Begin guide'}</button
          >
          <button class="rounded-full border border-white/40 px-7 py-2.5 text-sm text-white/80 transition hover:border-white hover:text-white" onclick={skip} disabled={phase !== 'choose'}
            >Skip</button
          >
        </div>
        <p class="text-xs text-white/45">Headphones recommended: the microphone shouldn’t hear the music.</p>
        {#if error}<p class="max-w-sm text-center text-xs text-red-300">{error}</p>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .intro-pulse {
    animation: intro-pulse 1.9s ease-in-out infinite;
  }
  @keyframes intro-pulse {
    50% {
      opacity: 0.35;
    }
  }
  .intro-in {
    animation-name: intro-in;
    animation-timing-function: ease-out;
    animation-fill-mode: both;
  }
  @keyframes intro-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
