<!--
  The app: transport bar on top, tracks on the left, the selected track's editor on the
  right. This page only arranges components; the logic lives in $lib (see ARCHITECTURE.md).
  The transcription test bench is at /bench.
-->
<script lang="ts">
  import TransportBar from '$lib/components/app/TransportBar.svelte';
  import TrackList from '$lib/components/app/TrackList.svelte';
  import PianoRoll from '$lib/components/app/PianoRoll.svelte';
  import DrumGrid from '$lib/components/app/DrumGrid.svelte';
  import ChordPicker from '$lib/components/app/ChordPicker.svelte';
  import { selectedTrack } from '$lib/state/project.svelte';

  const track = $derived(selectedTrack());

  // TODO(you): load the saved project when the page opens, e.g.
  //   $effect(() => { loadProject(); });
  // and a Save button somewhere (saveProject).
</script>

<div class="flex h-screen flex-col">
  <TransportBar />
  <div class="flex min-h-0 flex-1">
    <TrackList />
    <main class="flex-1 overflow-auto">
      <ChordPicker />
      {#if !track}
        <p class="text-muted-foreground p-6 text-sm">Add a track, or select one, to edit it here.</p>
      {:else if track.kind === 'midi'}
        <PianoRoll {track} />
      {:else if track.kind === 'drums'}
        <DrumGrid {track} />
      {:else}
        <!-- TODO(you, optional): show the voice track's clips (e.g. one box per clip). -->
        <p class="text-muted-foreground p-6 text-sm">{track.clips.length} voice recording(s).</p>
      {/if}
    </main>
  </div>
  <a href="/bench" class="text-muted-foreground absolute right-3 bottom-2 text-xs">transcription test bench</a>
</div>
