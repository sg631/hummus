<!--
  Sheet music: the selected melody track's clip as notation (music/notation.ts → abcjs).
  Read-only: edit the notes in the piano roll ("Piano roll" switches back), the sheet
  follows. Timing shows to the sixteenth; the key signature is the song's key (Settings →
  Song); the clef is picked from where the notes sit. The bar playing is highlighted.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import Dropdown from './Dropdown.svelte';
  import { toAbc } from '$lib/music/notation';
  import { barTicks } from '$lib/music/time';
  import type { MidiTrack } from '$lib/music/types';
  import { currentClip, project } from '$lib/state/project.svelte';
  import { playhead } from '$lib/state/playhead.svelte';
  import { view } from '$lib/state/view.svelte';

  let { track }: { track: MidiTrack } = $props();

  const clip = $derived(currentClip(track));
  const abc = $derived(
    toAbc($state.snapshot(clip.notes), {
      lengthTicks: clip.duration,
      timeSignature: project.timeSignature,
      key: project.key,
      scale: project.scale,
      title: clip.name ?? track.name
    })
  );

  let paper = $state<HTMLDivElement>();
  let abcjs: typeof import('abcjs') | null = $state(null);
  onMount(async () => {
    abcjs = await import('abcjs');
  });
  $effect(() => {
    if (!abcjs || !paper) return;
    abcjs.renderAbc(paper, abc, { responsive: 'resize', add_classes: true, foregroundColor: 'currentColor', paddingtop: 8, paddingbottom: 8 });
  });

  // The bar playing now (this clip on a loop, or where it's placed in the song).
  const playingBar = $derived.by(() => {
    if (!playhead.running || playhead.ticks < 0) return -1;
    const bar = barTicks(project.timeSignature);
    const bars = Math.max(1, Math.ceil(clip.duration / bar));
    if (playhead.pattern) return playhead.pattern.trackId === track.id ? Math.floor(playhead.ticks / bar) % bars : -1;
    const p = track.placements.find((x) => x.clipId === clip.id && playhead.ticks >= x.start && playhead.ticks < x.start + (x.length ?? bars * bar));
    return p ? Math.floor((playhead.ticks - p.start) / bar) % bars : -1;
  });
  $effect(() => {
    const b = playingBar;
    void abc;
    if (!paper) return;
    for (const el of paper.querySelectorAll('.sheet-now')) el.classList.remove('sheet-now');
    if (b >= 0) for (const el of paper.querySelectorAll(`.abcjs-mm${b}`)) el.classList.add('sheet-now');
  });
</script>

<div class="flex h-full flex-col">
  <div class="flex h-11 shrink-0 items-center gap-x-4 border-b px-3 text-xs whitespace-nowrap">
    <span class="flex items-center gap-1">
      <span class="font-semibold">Clip</span>
      <Dropdown
        class="max-w-40"
        bind:value={() => track.current ?? '', (v) => (track.current = v)}
        ariaLabel="Clip"
        options={track.clips.map((c) => ({ value: c.id, label: c.name ?? 'Clip' }))}
      />
    </span>
    <span class="text-muted-foreground">{project.key} {project.scale} · {project.timeSignature[0]}/{project.timeSignature[1]} · read-only: edit in the piano roll</span>
    <Button size="sm" variant="outline" class="ml-auto h-7" onclick={() => (view.sheet = false)} title="Back to the piano roll">Piano roll</Button>
  </div>
  <div class="min-h-0 flex-1 overflow-auto px-4 py-2">
    {#if clip.notes.length}
      <div bind:this={paper} class="sheet text-foreground mx-auto max-w-5xl"></div>
    {:else}
      <p class="text-muted-foreground p-6 text-sm">No notes in this clip yet.</p>
    {/if}
  </div>
</div>

<style>
  .sheet :global(.sheet-now) {
    fill: rgb(239 68 68);
    color: rgb(239 68 68);
  }
</style>
