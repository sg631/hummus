<!--
  Working offline (File → Work offline…, or the home page): what works with no internet,
  and a button that saves every instrument and drum sound so all of them do.
  The app itself is saved automatically (src/service-worker.ts); so is any sound you've
  played once. Projects, recordings and your own sounds never needed the internet.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { checkOffline, clearOfflineSamples, makeAvailableOffline, offline } from '$lib/state/offline.svelte';
  import { ui } from '$lib/state/ui.svelte';

  $effect(() => {
    if (ui.offlineOpen) void checkOffline();
  });

  const complete = $derived(offline.total > 0 && offline.saved >= offline.total);
  const progress = $derived(offline.downloading && offline.total ? Math.round(((offline.saved + 0) / offline.total) * 100) : 0);
</script>

<Dialog.Root bind:open={ui.offlineOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Work offline</Dialog.Title>
      <Dialog.Description>
        {offline.online ? 'You are online.' : 'You are offline right now.'}
        {complete ? 'Everything is saved: the whole app works with no internet.' : 'Save the sounds below and the whole app works with no internet.'}
      </Dialog.Description>
    </Dialog.Header>

    {#if !offline.supported}
      <p class="text-sm">This browser can't save the app for offline use. Chrome, Edge and Firefox can.</p>
    {:else}
      <ul class="space-y-1.5 text-sm">
        <li>✓ <b>The app</b> is saved on this computer once you've opened it.</li>
        <li>✓ <b>Your projects, recordings and your own sounds</b> are kept here (or in your projects folder).</li>
        <li>
          {complete ? '✓' : '○'} <b>Instrument and drum sounds:</b>
          {offline.saved} of {offline.total} saved
          <span class="text-muted-foreground">(any sound you've played is saved automatically)</span>
        </li>
      </ul>

      {#if offline.downloading}
        <div class="bg-muted h-2 overflow-hidden rounded">
          <div class="bg-primary h-full transition-all" style="width: {progress}%"></div>
        </div>
        <p class="text-muted-foreground text-xs">Saving… {offline.done} files fetched{offline.failed ? `, ${offline.failed} failed (try again when online)` : ''}</p>
      {/if}

      <p class="text-muted-foreground text-xs">
        This site uses {offline.usedMB} MB of {offline.quotaMB ? `${offline.quotaMB} MB available` : 'its storage'}.
        {offline.persisted ? 'The browser will keep it even when the disk runs low.' : 'Saving everything also asks the browser to keep it when the disk runs low.'}
      </p>

      <Dialog.Footer class="gap-2 sm:justify-between">
        <Button variant="ghost" size="sm" disabled={offline.downloading || !offline.saved} onclick={clearOfflineSamples}>Remove saved sounds</Button>
        <Button disabled={offline.downloading || complete || !offline.online} onclick={makeAvailableOffline}>
          {offline.downloading ? 'Saving…' : complete ? 'All saved' : offline.online ? 'Save every sound for offline use' : 'Connect to save the rest'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
