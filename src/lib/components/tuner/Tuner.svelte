<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { LiveInput } from '$lib/state/live-input.svelte';
  import NoteDisplay from './NoteDisplay.svelte';
  import CentsMeter from './CentsMeter.svelte';
  import LevelMeter from './LevelMeter.svelte';

  type Layout = 'stacked' | 'inline' | 'compact';

  let {
    input,
    layout = 'stacked',
    showLevel = true,
    class: className = ''
  }: {
    input: LiveInput;
    layout?: Layout;
    showLevel?: boolean;
    class?: string;
  } = $props();

  const name = $derived(input.reading?.name ?? null);
  // only show the cents marker while a note is actually sounding
  const cents = $derived(input.active ? (input.reading?.cents ?? null) : null);
</script>

{#if layout === 'stacked'}
  <div class={cn('flex w-full flex-col items-center gap-6', className)}>
    <NoteDisplay
      {name}
      cents={input.reading?.cents ?? null}
      hz={input.reading?.hz ?? null}
      active={input.active}
      size="lg"
    />
    <CentsMeter {cents} />
    {#if showLevel}<LevelMeter db={input.db} />{/if}
  </div>
{:else if layout === 'inline'}
  <div class={cn('flex w-full items-center gap-4', className)}>
    <NoteDisplay {name} active={input.active} size="md" showDetails={false} class="w-24" />
    <div class="flex flex-1 flex-col gap-2">
      <CentsMeter {cents} />
      {#if showLevel}<LevelMeter db={input.db} class="h-1.5" />{/if}
    </div>
  </div>
{:else}
  <div class={cn('flex items-center gap-2', className)}>
    <NoteDisplay {name} active={input.active} size="sm" showDetails={false} />
    <CentsMeter {cents} class="h-2 w-16" />
  </div>
{/if}