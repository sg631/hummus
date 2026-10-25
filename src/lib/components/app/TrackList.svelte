<!--
  The tracks, one row each: select, name, instrument, volume, mute, effects, delete.
  Plus buttons to add each kind of track.

  Svelte reminders:
  - {#each list as item (item.id)} … {/each} repeats markup for each item; the (item.id)
    lets Svelte keep rows straight when the list changes.
  - Changing a track (track.mute = true) updates the screen: tracks live in $state.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { project, selection } from '$lib/state/project.svelte';
</script>

<aside class="flex w-72 flex-col gap-2 border-r p-3">
  <h2 class="text-sm font-semibold">Tracks</h2>

  {#each project.tracks as track (track.id)}
    <div class="rounded border p-2 {selection.trackId === track.id ? 'border-primary' : ''}">
      <!-- Clicking the name selects the track (the editor and Record use the selected track). -->
      <button class="w-full text-left" onclick={() => (selection.trackId = track.id)}>
        <div class="text-sm font-medium">{track.name}</div>
        <div class="text-muted-foreground text-xs">{track.kind}</div>
      </button>
      <!-- TODO(you): mute (Switch, bind:checked={track.mute}), volume (Slider, -40 to 6
           dB, bind:value={track.volume}), and for track.kind === 'midi' an instrument
           choice from INSTRUMENTS (music/types.ts). Then reverb and delay sliders (0–1,
           bind to track.effects.reverb / .delay), and a delete button (removeTrack). -->
    </div>
  {:else}
    <p class="text-muted-foreground text-sm">No tracks yet.</p>
  {/each}

  <!-- TODO(you): onclick for each: addMidiTrack(), addVoiceTrack(), addDrumTrack()
       from state/project.svelte.ts. -->
  <div class="flex flex-wrap gap-2">
    <Button size="sm" variant="outline">+ Melody</Button>
    <Button size="sm" variant="outline">+ Voice</Button>
    <Button size="sm" variant="outline">+ Drums</Button>
  </div>
</aside>
