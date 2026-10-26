<!--
  One panel's content: the track list, the selected track's editor (piano roll or sheet
  music, drum grid, voice editor), the playlist or the mixer. Docked stacks and floating windows (DockLayout.svelte) both use it.
-->
<script lang="ts">
  import PianoRoll from './PianoRoll.svelte';
  import DrumGrid from './DrumGrid.svelte';
  import VoiceEditor from './VoiceEditor.svelte';
  import Playlist from './Playlist.svelte';
  import Mixer from './Mixer.svelte';
  import TrackList from './TrackList.svelte';
  import SheetView from './SheetView.svelte';
  import { view } from '$lib/state/view.svelte';
  import { selectedTrack } from '$lib/state/project.svelte';
  import type { Panel } from '$lib/state/layout.svelte';

  let { panel }: { panel: Panel } = $props();
  const track = $derived(selectedTrack());
</script>

{#if panel === 'tracks'}
  <TrackList />
{:else if panel === 'playlist'}
  <Playlist />
{:else if panel === 'mixer'}
  <Mixer />
{:else if !track}
  <p class="text-muted-foreground p-6 text-sm">Add a track, or select one, to edit it here.</p>
{:else if track.kind === 'midi' && view.sheet}
  <SheetView {track} />
{:else if track.kind === 'midi'}
  <PianoRoll {track} />
{:else if track.kind === 'drums'}
  <DrumGrid {track} />
{:else}
  <VoiceEditor {track} />
{/if}
