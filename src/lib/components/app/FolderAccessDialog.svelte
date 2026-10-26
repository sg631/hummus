<!--
  Opens by itself when your projects are kept in a folder and the browser needs your OK to
  open it again (browsers ask once per visit). Shows which folder, and what to do.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { allowFolder, chooseProjectsFolder, library, stopUsingFolder } from '$lib/state/projects.svelte';

  let dismissed = $state(false);
  const open = $derived(!dismissed && (library.folder.state === 'needs-permission' || library.folder.state === 'denied'));
</script>

<Dialog.Root open={open} onOpenChange={(v) => !v && (dismissed = true)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Open your projects folder</Dialog.Title>
      <Dialog.Description>Your projects are kept in a folder on this computer.</Dialog.Description>
    </Dialog.Header>

    <div class="bg-muted/40 flex items-center gap-3 rounded-md border p-3">
      <span class="text-2xl" aria-hidden="true">📁</span>
      <div class="min-w-0">
        <div class="truncate font-semibold">{library.folder.name}</div>
        <div class="text-muted-foreground text-xs">Browsers don't show a page a folder's full location, only its name.</div>
      </div>
    </div>

    {#if library.folder.state === 'denied'}
      <div class="text-sm">
        <p class="font-medium">Access was blocked.</p>
        <ol class="text-muted-foreground mt-1 list-decimal space-y-1 pl-5 text-xs">
          <li>Click the icon at the left of the address bar (or the folder icon at its right).</li>
          <li>Under this site's permissions, allow editing files, or reset the permission.</li>
          <li>Click <b>Allow access</b> below again, or choose the folder again.</li>
        </ol>
      </div>
    {:else}
      <p class="text-sm">For your privacy, the browser asks once per visit before this page can open the folder. Click <b>Allow access</b>, then <b>Allow</b> (or <b>Edit files</b>) in the browser's box.</p>
    {/if}

    <div class="flex flex-col gap-2">
      <Button onclick={allowFolder}>Allow access to “{library.folder.name}”</Button>
      <Button variant="outline" onclick={chooseProjectsFolder}>Choose the folder again…</Button>
      <Button variant="ghost" size="sm" onclick={stopUsingFolder}>Keep projects in this browser instead</Button>
    </div>
    <p class="text-muted-foreground text-xs">Until then, changes aren't saved.</p>
  </Dialog.Content>
</Dialog.Root>
