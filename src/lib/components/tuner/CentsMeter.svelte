<script lang="ts">
  import { cn } from '$lib/utils.js';
  import { tuneStatus } from '$lib/music/tuning';
  import { tuneColors } from './tune-colors';

  let {
    cents,
    range = 50,
    orientation = 'horizontal',
    class: className = ''
  }: {
    cents: number | null; // null = nothing to show
    range?: number;       // cents shown at each end
    orientation?: 'horizontal' | 'vertical';
    class?: string;
  } = $props();

  const vertical = $derived(orientation === 'vertical');
  const position = $derived(
    cents === null ? null : 50 + (Math.max(-range, Math.min(range, cents)) / range) * 50
  );
  const color = $derived(cents === null ? '' : tuneColors[tuneStatus(cents)]);
</script>

<div class={cn('bg-muted relative rounded-full', vertical ? 'h-full w-3' : 'h-3 w-full', className)}>
  <!-- center line = in tune -->
  <div
    class={cn(
      'bg-foreground/40 absolute',
      vertical ? 'left-0 top-1/2 h-px w-full' : 'left-1/2 top-0 h-full w-px'
    )}
  ></div>
  {#if position !== null}
    <div
      class={cn(
        'absolute rounded-full',
        color,
        vertical ? 'left-0 h-2 w-full translate-y-1/2' : 'top-0 h-full w-2 -translate-x-1/2'
      )}
      style={vertical ? `bottom: ${position}%` : `left: ${position}%`}
    ></div>
  {/if}
</div>