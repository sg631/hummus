<script lang="ts">
  import { cn } from '$lib/utils.js';

  type Size = 'sm' | 'md' | 'lg';

  let {
    name,
    cents = null,
    hz = null,
    active = true,
    size = 'md',
    showDetails = true,
    class: className = ''
  }: {
    name: string | null;
    cents?: number | null;
    hz?: number | null;
    active?: boolean;
    size?: Size;
    showDetails?: boolean;
    class?: string;
  } = $props();

  const nameSizes: Record<Size, string> = { sm: 'text-2xl', md: 'text-5xl', lg: 'text-8xl' };
  const detailSizes: Record<Size, string> = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };

  const details = $derived(
    [
      cents === null ? '' : `${cents > 0 ? '+' : ''}${cents} cents`,
      hz === null ? '' : `${hz.toFixed(1)} Hz`
    ]
      .filter(Boolean)
      .join(' · ')
  );
</script>

<div class={cn('text-center transition-opacity', !active && 'opacity-30', className)}>
  <div class={cn('font-mono leading-none', nameSizes[size])}>{name ?? '--'}</div>
  {#if showDetails}
    <div class={cn('text-muted-foreground mt-2 font-mono', detailSizes[size])}>
      {details || '\u00a0'}
    </div>
  {/if}
</div>