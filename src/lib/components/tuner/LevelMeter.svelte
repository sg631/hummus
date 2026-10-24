<script lang="ts">
  import { cn } from '$lib/utils.js';

  let {
    db,
    minDb = -60,
    orientation = 'horizontal',
    class: className = ''
  }: {
    db: number;
    minDb?: number; // level shown as empty
    orientation?: 'horizontal' | 'vertical';
    class?: string;
  } = $props();

  const vertical = $derived(orientation === 'vertical');
  const percent = $derived(Math.max(0, Math.min(100, ((db - minDb) / -minDb) * 100)));
  // amber when loud, red when close to clipping
  const color = $derived(db > -3 ? 'bg-red-500' : db > -12 ? 'bg-amber-500' : 'bg-green-500');
</script>

<div
  class={cn('bg-muted relative overflow-hidden rounded-full', vertical ? 'h-full w-2' : 'h-2 w-full', className)}
>
  <div
    class={cn('absolute transition-all duration-75', color, vertical ? 'bottom-0 left-0 w-full' : 'left-0 top-0 h-full')}
    style={vertical ? `height: ${percent}%` : `width: ${percent}%`}
  ></div>
</div>