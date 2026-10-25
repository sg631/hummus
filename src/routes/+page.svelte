<!--
  The app: transport bar on top, tracks on the left, the selected track's editor on the
  right. This page only arranges components; the logic lives in $lib (see ARCHITECTURE.md).
  The transcription test bench is at /bench.
-->
<script lang="ts">
  import TransportBar from '$lib/components/app/TransportBar.svelte';
  import TrackList from '$lib/components/app/TrackList.svelte';
  import PianoRoll from '$lib/components/app/PianoRoll.svelte';
  import AppTour from '$lib/components/app/AppTour.svelte';
  import ContextMenu from '$lib/components/app/ContextMenu.svelte';
  import DrumGrid from '$lib/components/app/DrumGrid.svelte';
  import VoiceEditor from '$lib/components/app/VoiceEditor.svelte';
  import Playlist from '$lib/components/app/Playlist.svelte';
  import { view } from '$lib/state/view.svelte';
  import { onMount } from 'svelte';
  import { addNoteClip, addVoiceClip, loadProject, project, selectedTrack } from '$lib/state/project.svelte';

  const track = $derived(selectedTrack());

  // When the page opens: bring back the last saved project (Save is in the TransportBar).
  onMount(loadProject);

  // Development only: lets automated browser tests reach the app's state (window.__hum).
  if (import.meta.env.DEV) (window as unknown as { __hum: object }).__hum = { project, addNoteClip, addVoiceClip };
</script>

<div class="flex h-screen flex-col">
  <TransportBar />
  <div class="flex min-h-0 flex-1">
    <TrackList />
    <main id="tour-editor" class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Editor (the selected track) or Playlist (the whole song). -->
      <div class="flex shrink-0 gap-1 border-b px-2 pt-1 text-sm" role="tablist">
        <button
          role="tab"
          aria-selected={view.main === 'editor'}
          class="rounded-t px-3 py-1 {view.main === 'editor' ? 'bg-muted font-semibold' : 'text-muted-foreground'}"
          onclick={() => (view.main = 'editor')}>Editor{track ? `: ${track.name}` : ''}</button
        >
        <button
          id="tour-playlist"
          role="tab"
          aria-selected={view.main === 'playlist'}
          class="rounded-t px-3 py-1 {view.main === 'playlist' ? 'bg-muted font-semibold' : 'text-muted-foreground'}"
          onclick={() => (view.main = 'playlist')}>Playlist</button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
      {#if view.main === 'playlist'}
        <Playlist />
      {:else if !track}
        <p class="text-muted-foreground p-6 text-sm">Add a track, or select one, to edit it here.</p>
      {:else if track.kind === 'midi'}
        <PianoRoll {track} />
      {:else if track.kind === 'drums'}
        <DrumGrid {track} />
      {:else}
        <VoiceEditor {track} />
      {/if}
      </div>
    </main>
  </div>
  <AppTour />
  <ContextMenu />
  <a href="/bench" class="text-muted-foreground absolute right-3 bottom-2 text-xs">transcription test bench</a>
</div>
