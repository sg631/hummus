<!--
  Edit → History: every undo step, oldest first, then the ones you can redo (faded). Click a
  step to go back (or forward) to just after it; "Start" goes back to before the first.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { history, jumpTo } from '$lib/state/history.svelte';
  import { ui } from '$lib/state/ui.svelte';

  const now = $derived(history.past.length);
</script>

<Dialog.Root bind:open={ui.historyOpen}>
  <Dialog.Content class="flex max-h-[80vh] flex-col sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>History</Dialog.Title>
      <Dialog.Description>Click a step to go back (or forward) to it. Ctrl+Z / Ctrl+Y step one at a time.</Dialog.Description>
    </Dialog.Header>
    <ol class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 text-sm">
      <li>
        <button class="hover:bg-muted w-full rounded px-2 py-1 text-left {now === 0 ? 'bg-muted font-semibold' : ''}" onclick={() => jumpTo(0)}>Start</button>
      </li>
      {#each history.past as label, i (i)}
        <li>
          <button class="hover:bg-muted w-full rounded px-2 py-1 text-left {now === i + 1 ? 'bg-muted font-semibold' : ''}" onclick={() => jumpTo(i + 1)}>
            {label}{now === i + 1 ? ' ← now' : ''}
          </button>
        </li>
      {/each}
      {#each history.future as label, i (i)}
        <li>
          <button class="hover:bg-muted text-muted-foreground w-full rounded px-2 py-1 text-left italic" onclick={() => jumpTo(now + i + 1)}>{label}</button>
        </li>
      {/each}
    </ol>
  </Dialog.Content>
</Dialog.Root>
