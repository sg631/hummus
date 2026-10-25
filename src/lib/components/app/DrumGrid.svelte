<!--
  A drum track's loop: one row per sound (kick, snare, hi-hat), 16 steps across.
  Clicking a step turns it on or off; the mixer plays the rows that are on.

  TODO(you):
  - a {#each DRUM_SOUNDS as sound, row} for the rows, with the sound's name first
  - inside, {#each track.steps[row] as on, step} a button per step:
      onclick={() => (track.steps[row][step] = !on)}, filled when `on`
  - make every 4th step look different (the beats), so it's easy to read
  - (nice) preset buttons ("Rock", "Hip-hop") that fill track.steps with a pattern
-->
<script lang="ts">
  import { DRUM_SOUNDS, type DrumTrack } from '$lib/music/types';

  let { track }: { track: DrumTrack } = $props();
</script>

<div class="p-3">
  <p class="text-muted-foreground text-sm">Drum grid for {track.name}: {DRUM_SOUNDS.join(', ')} (TODO)</p>
</div>
