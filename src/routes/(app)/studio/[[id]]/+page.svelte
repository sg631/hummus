<!--
  The studio: the menu bar and transport bar on top, and the panels below (DockLayout.svelte:
  dock, float, resize, hide; state/layout.svelte.ts).
  While the guide is on (guide/), its song shows as GuideStage instead: a part at a time.
  The address says which project is open: /studio/<project id>. Opening the app there opens
  that project; opening, starting or copying a project from the menus changes the address
  (so Back goes to the one before). /studio alone opens the last project you had open.
  This page only arranges components; the logic lives in $lib (see ARCHITECTURE.md).
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import TransportBar from '$lib/components/app/TransportBar.svelte';
  import Menubar from '$lib/components/app/Menubar.svelte';
  import HistoryDialog from '$lib/components/app/HistoryDialog.svelte';
  import ExportDialog from '$lib/components/app/ExportDialog.svelte';
  import ShortcutsDialog from '$lib/components/app/ShortcutsDialog.svelte';
  import AutomationDrop from '$lib/components/app/AutomationDrop.svelte';
  import GuideStage from '$lib/components/guide/GuideStage.svelte';
  import { guide, guideSeen } from '$lib/guide/guide.svelte';
  import { onMount } from 'svelte';
  import DockLayout from '$lib/components/app/DockLayout.svelte';
  import { stopProject } from '$lib/audio/mixer';
  import { stopPlayhead } from '$lib/state/playhead.svelte';
  import { library, openLastOrNew, openProject } from '$lib/state/projects.svelte';
  import { ui } from '$lib/state/ui.svelte';

  const urlId = $derived(page.params.id);
  let opening = $state(false);

  // The address → the open project (once projects can be opened: a folder may be waiting
  // for access). Only the address changing runs this: when a menu opens another project,
  // the next effect changes the address to match instead.
  $effect(() => {
    if (!library.ready || !library.canOpen) return;
    const id = urlId;
    if (untrack(() => opening || (id && id === library.currentId))) return;
    opening = true;
    (async () => {
      if (!id) {
        const opened = await openLastOrNew();
        await goto(`${base}/studio/${opened}`, { replaceState: true });
      } else if (!(await openProject(id))) {
        ui.message = "That project wasn't found (deleted, or kept somewhere else)";
        setTimeout(() => (ui.message = ''), 4000);
        await goto(`${base}/`, { replaceState: true });
      }
      opening = false;
    })();
  });

  // The open project → the address (File → New, Open, Save a copy as…).
  $effect(() => {
    const current = library.currentId;
    if (!current || opening || current === urlId) return;
    void goto(`${base}/studio/${current}`, { keepFocus: true, noScroll: true });
  });

  // The first time in the studio: the intro (and the guide), unless it was seen or is on.
  onMount(() => {
    if (!guideSeen() && !guide.active) guide.intro = true;
  });

  // Going home (or anywhere): the song stops.
  onDestroy(() => {
    stopProject();
    stopPlayhead();
  });
</script>

{#if guide.active && library.currentId === guide.projectId}
  <!-- The guide's song: the studio a part at a time (components/guide). -->
  <GuideStage />
  <HistoryDialog />
  <ShortcutsDialog />
  <AutomationDrop />
{:else}
<div class="flex h-screen flex-col">
  <Menubar />
  <TransportBar />
  <DockLayout />
  <HistoryDialog />
  <ExportDialog />
  <ShortcutsDialog />
  <AutomationDrop />
  <a href="{base}/bench" class="text-muted-foreground absolute right-3 bottom-2 text-xs">transcription test bench</a>
</div>
{/if}
