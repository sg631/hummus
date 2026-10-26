<!--
  Around the home page (/) and the studio (/studio/<project id>): what both need, started
  once when the app opens and kept while you go between them.
  - undo history and autosave watching the project; where projects are kept and their list
  - your sounds, the computer keyboard / MIDI if they were on, offline status
    (src/service-worker.ts saves the app and its sounds for offline use)
  - shared windows (projects, folder access), the right-click menu and the toast
  - the intro (black screen, then the guide or the home page): the studio opens it the
    first time; never by itself on the home page
  The transcription test bench (/bench) is outside this group.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import ContextMenu from '$lib/components/app/ContextMenu.svelte';
  import ProjectsDialog from '$lib/components/app/ProjectsDialog.svelte';
  import FolderAccessDialog from '$lib/components/app/FolderAccessDialog.svelte';
  import OfflineDialog from '$lib/components/app/OfflineDialog.svelte';
  import Intro from '$lib/components/guide/Intro.svelte';
  import { guide } from '$lib/guide/guide.svelte';
  import { watchOnline } from '$lib/state/offline.svelte';
  import { watchHistory } from '$lib/state/history.svelte';
  import { layout } from '$lib/state/layout.svelte';
  import { initLiveKeys } from '$lib/state/live-keys.svelte';
  import { addNoteClip, addVoiceClip, project } from '$lib/state/project.svelte';
  import { initProjects, library } from '$lib/state/projects.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { loadUserSamples } from '$lib/state/user-samples.svelte';

  let { children } = $props();

  onMount(() => {
    const stopWatching = watchHistory(); // undo steps (and autosave) from every change
    initProjects(); // where projects are kept, and their list
    loadUserSamples(); // your uploaded sounds (this browser's database)
    initLiveKeys(); // computer keyboard / MIDI, if they were on last time
    watchOnline(); // online / offline, and how many sounds are saved for offline use
    return stopWatching;
  });

  // Development only: lets automated browser tests reach the app's state (window.__hum).
  if (import.meta.env.DEV) (window as unknown as { __hum: object }).__hum = { project, addNoteClip, addVoiceClip, layout, ui, library };
</script>

{@render children()}

<ContextMenu />
<ProjectsDialog />
<FolderAccessDialog />
<OfflineDialog />
{#if guide.intro}<Intro />{/if}

{#if ui.message}
  <div class="bg-foreground text-background pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md px-3 py-1.5 text-xs shadow-lg" role="status">{ui.message}</div>
{/if}
