<!--
  The drum sound browser: every drum sound in one searchable window.
  - synthesized sounds, two recorded acoustic kits, the TR-808, percussion, and your own
    sounds (uploaded, or sliced from a recording)
  - ▶ plays a sound; click its name (or Enter for the first match) to use it
  - "Upload sounds…" adds audio files to Your sounds; "Slice a recording…" opens the
    slicer (cut a loop or recording into hits, each a sound)
  Recorded kits download when first used; their credit is at the bottom.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { previewDrum } from '$lib/audio/instruments';
  import { DRUM_SAMPLES, DRUM_SAMPLES_CREDIT } from '$lib/music/drum-samples';
  import { DRUM_SOUNDS, type DrumSound } from '$lib/music/drums';
  import type { DrumTrack } from '$lib/music/types';
  import { addUserFile, deleteUserSample, userSamples } from '$lib/state/user-samples.svelte';
  import Slicer from './Slicer.svelte';

  let {
    open = $bindable(false),
    title = 'Choose a sound',
    track,
    onpick
  }: { open?: boolean; title?: string; track: DrumTrack; onpick: (sound: DrumSound) => void } = $props();

  let query = $state('');
  let slicerOpen = $state(false);
  let uploading = $state(false);
  let fileInput = $state<HTMLInputElement>();

  interface Item {
    id: DrumSound;
    name: string;
    group: string;
  }
  const all = $derived<Item[]>([
    // Recorded kits first: they sound best (and come first when searching "808 kick").
    ...DRUM_SAMPLES.map((s) => ({ id: s.id as DrumSound, name: s.name, group: s.kit })),
    ...DRUM_SOUNDS.map((d) => ({ id: d.type as DrumSound, name: d.name, group: 'Synthesized' })),
    ...userSamples.list.map((u) => ({ id: u.id as DrumSound, name: u.name, group: 'Your sounds' }))
  ]);
  // Every word of the search in the name or group ("808 kick", "pearl hat").
  const results = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((i) => words.every((w) => `${i.name} ${i.group}`.toLowerCase().includes(w)));
  });
  const groups = $derived([...new Set(results.map((i) => i.group))]);

  function pick(id: DrumSound) {
    open = false;
    query = '';
    onpick(id);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    uploading = true;
    try {
      for (const f of Array.from(files)) await addUserFile(f);
      query = '';
    } catch (e) {
      window.alert(`That file couldn't be read as audio: ${e instanceof Error ? e.message : e}`);
    } finally {
      uploading = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>Search, ▶ to listen, click a name to use it.</Dialog.Description>
    </Dialog.Header>

    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="search"
      placeholder="Search: kick, snare, 808, pearl, hat, conga…"
      bind:value={query}
      autofocus
      onkeydown={(e) => {
        if (e.key === 'Enter' && results.length) {
          e.preventDefault();
          const id = results[0].id;
          setTimeout(() => pick(id), 0);
        }
      }}
      class="bg-background rounded-md border px-3 py-2 text-sm"
    />

    <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
      {#each groups as group (group)}
        <h3 class="text-muted-foreground mt-3 mb-1 text-xs font-semibold tracking-wide uppercase">{group}</h3>
        <div class="grid grid-cols-2 gap-x-2">
          {#each results.filter((i) => i.group === group) as item (item.id)}
            <div class="hover:bg-muted flex items-center gap-1 rounded-md px-1">
              <button class="text-muted-foreground hover:text-foreground px-1 text-xs" onclick={() => previewDrum(item.id)} aria-label="Listen to {item.name}">▶</button>
              <button class="min-w-0 flex-1 truncate py-1 text-left text-sm" onclick={() => pick(item.id)}>{item.name}</button>
              {#if item.group === 'Your sounds'}
                <button
                  class="text-muted-foreground hover:text-destructive px-1 text-xs"
                  title="Delete this sound from this browser"
                  onclick={() => window.confirm(`Delete “${item.name}”? Drum rows using it go quiet.`) && deleteUserSample(item.id)}>✕</button
                >
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted-foreground py-6 text-center text-sm">No sound matches "{query}".</p>
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} type="file" accept="audio/*" multiple class="hidden" onchange={(e) => upload(e.currentTarget.files)} />
      <Button size="sm" variant="outline" disabled={uploading} onclick={() => fileInput?.click()}>{uploading ? 'Adding…' : 'Upload sounds…'}</Button>
      <Button size="sm" variant="outline" onclick={() => (slicerOpen = true)}>Slice a recording…</Button>
      <span class="text-muted-foreground text-xs">Your sounds stay in this browser.</span>
    </div>
    <p class="text-muted-foreground text-[10px] leading-tight">{DRUM_SAMPLES_CREDIT}</p>
  </Dialog.Content>
</Dialog.Root>

<Slicer bind:open={slicerOpen} {track} ondone={() => (open = false)} />
