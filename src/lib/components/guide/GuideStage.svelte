<!--
  The studio while the guide is on: only what's been introduced so far (guide/steps.ts),
  laid out simply (tracks on the left; the tuner, editor, playlist, mixer stacked), with
  the step's headline and hint along the bottom. New parts fade in as they're revealed;
  the part a step is about has a pulsing outline.

  Smaller parts are hidden by data-guide ids (a style written here). The menu bar and top
  bar stay mounted while hidden: their shortcuts (Ctrl+Z, Space) and actions still work.
  A reload (audio needs a click to start again) shows "Click to continue".
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import * as Tone from 'tone';
  import Menubar from '$lib/components/app/Menubar.svelte';
  import TransportBar from '$lib/components/app/TransportBar.svelte';
  import TrackList from '$lib/components/app/TrackList.svelte';
  import PanelView from '$lib/components/app/PanelView.svelte';
  import Playlist from '$lib/components/app/Playlist.svelte';
  import Mixer from '$lib/components/app/Mixer.svelte';
  import Logo from '$lib/components/app/Logo.svelte';
  import GuideMeter from './GuideMeter.svelte';
  import { choose, currentStep, guide, leaveGuide, nextStep, partsAt, pauseGuide, prevStep, resumeGuide } from '$lib/guide/guide.svelte';
  import { PARTS, STEPS, type Part } from '$lib/guide/steps';
  import { activePanel, guideScreen, type Panel } from '$lib/state/layout.svelte';

  const parts = $derived(partsAt(guide.step));
  const has = (p: Part) => parts.has(p);
  const step = $derived(currentStep());
  const hint = $derived(guide.hint || (typeof step.hint === 'function' ? step.hint() : step.hint));
  const last = $derived(guide.step >= STEPS.length - 1);

  // Hidden parts, and the outline on the one the step is about.
  const css = $derived(
    [
      `${PARTS.filter((p) => !parts.has(p)).map((p) => `.guide-on [data-guide="${p}"]`).join(',')}{display:none!important}`,
      step.focus ? `.guide-on [data-guide="${step.focus}"]{outline:2px solid rgb(245 158 11);outline-offset:3px;border-radius:6px;animation:guide-focus 1.9s ease-in-out infinite}` : ''
    ].join('\n')
  );

  // Which panels are on screen (keyboard shortcuts go to the one clicked last).
  $effect(() => {
    guideScreen.panels = (['editor', 'playlist', 'mixer', 'tracks'] as Panel[]).filter((p) => parts.has(p));
  });
  onDestroy(() => {
    guideScreen.panels = null;
    pauseGuide();
  });

  let needsClick = $state(false);
  onMount(() => {
    needsClick = Tone.getContext().state !== 'running';
    if (!needsClick) void resumeGuide();
  });
  async function carryOn() {
    await Tone.start();
    needsClick = false;
    void resumeGuide();
  }

  // The headline comes in again with each step.
  let shownStep = $state(-1);
  $effect(() => {
    shownStep = guide.step;
  });
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div class="guide-on bg-background flex h-screen flex-col">
  <div class={has('topbar') && last ? '' : 'hidden'}><Menubar /></div>
  <div class="guide-panel {has('topbar') ? '' : 'hidden'}"><TransportBar /></div>

  <div class="flex min-h-0 flex-1">
    {#if has('tracks')}
      <div class="guide-panel w-64 shrink-0 border-r" role="presentation" onpointerdowncapture={() => (activePanel.panel = null)}><TrackList /></div>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col">
      {#if has('meter')}
        <GuideMeter compact={has('editor')} passes={step.id === 'sing' ? 2 : 1} />
      {/if}
      {#if has('editor')}
        <div class="guide-panel min-h-0 flex-[3]" role="presentation" onpointerdowncapture={() => (activePanel.panel = 'editor')}><PanelView panel="editor" /></div>
      {/if}
      {#if has('playlist')}
        <div class="guide-panel min-h-0 flex-[2] border-t" role="presentation" onpointerdowncapture={() => (activePanel.panel = 'playlist')}><Playlist /></div>
      {/if}
      {#if has('mixer')}
        <div class="guide-panel min-h-0 flex-[2] border-t" role="presentation" onpointerdowncapture={() => (activePanel.panel = 'mixer')}><Mixer /></div>
      {/if}
    </div>
  </div>

  <!-- The step: headline, hint, where you are, back and on, and the way out. -->
  <div class="bg-muted/40 flex shrink-0 items-center gap-6 border-t px-6 py-3">
    {#key shownStep}
      <div class="guide-caption min-w-0 flex-1">
        <div class="text-lg leading-tight font-semibold">{step.title}</div>
        <div class="text-muted-foreground mt-0.5 text-sm">{hint}</div>
      </div>
    {/key}
    <div class="flex shrink-0 items-center gap-4">
      <div class="flex gap-1" aria-label="Step {guide.step + 1} of {STEPS.length}">
        {#each STEPS as s, i (s.id)}
          <span class="h-1.5 w-1.5 rounded-full {i < guide.step ? 'bg-foreground/60' : i === guide.step ? 'bg-amber-500' : 'bg-foreground/15'}"></span>
        {/each}
      </div>
      <button class="text-muted-foreground hover:text-foreground text-sm disabled:opacity-30" onclick={prevStep} disabled={guide.moving || guide.step === 0} title="The step before">‹ Previous</button>
      {#if step.choices}
        {#each step.choices as c, i (c.label)}
          <button
            class="rounded-full px-5 py-1.5 text-sm font-semibold disabled:opacity-50 {i === 0 ? 'bg-foreground text-background' : 'border'}"
            onclick={() => choose(c.to)}
            disabled={guide.moving}>{c.label}</button
          >
        {/each}
      {:else}
        <!-- Steps that wait for you to do something can be skipped with Next too. -->
        <button
          class="rounded-full px-5 py-1.5 text-sm font-semibold disabled:opacity-50 {step.next ? 'bg-foreground text-background' : 'border'}"
          onclick={nextStep}
          disabled={guide.moving}
          title={step.next ? '' : 'Skip this step'}>{last ? 'Finish' : 'Next ›'}</button
        >
      {/if}
      {#if !last}
        <button class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline" onclick={() => void leaveGuide()}>Leave guide</button>
      {/if}
    </div>
  </div>
</div>

{#if needsClick}
  <!-- After a reload: audio needs a click before the music can come back. -->
  <div class="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-8 bg-black text-white" role="presentation" onclick={carryOn}>
    <Logo class="text-7xl" />
    <button class="text-sm tracking-[0.3em] text-white/70 uppercase" onclick={carryOn}>Click to continue the guide</button>
    <button
      class="text-xs text-white/40 hover:text-white/80"
      onclick={(e) => {
        e.stopPropagation();
        needsClick = false;
        void leaveGuide();
      }}>Leave the guide</button
    >
  </div>
{/if}

<style>
  :global(.guide-on .guide-panel),
  :global(.guide-on [data-guide]) {
    animation: guide-in 0.6s ease-out;
  }
  .guide-caption {
    animation: guide-caption 0.45s ease-out;
  }
  @keyframes -global-guide-in {
    from {
      opacity: 0;
    }
  }
  @keyframes guide-caption {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @keyframes -global-guide-focus {
    50% {
      outline-color: rgb(245 158 11 / 0.25);
    }
  }
</style>
