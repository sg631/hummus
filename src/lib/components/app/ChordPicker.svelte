<!--
  Add chords without knowing chords: choose a key and a progression, press Add, and a new
  MIDI track with the chords appears.

  TODO(you):
  - two dropdowns (plain <select bind:value={…}> is fine): KEYS and PROGRESSIONS from
    music/chords.ts
  - an Add button: const track = addMidiTrack('Chords'); then
    addNoteClip(track.id, chordClip(key, progression.numerals, project.timeSignature))
-->
<script lang="ts">
  import { KEYS, PROGRESSIONS } from '$lib/music/chords';

  let key = $state<string>(KEYS[0]);
  let progression = $state(PROGRESSIONS[0]);
</script>

<div class="flex items-center gap-2 p-3">
  <span class="text-sm">Chords: {key}, {progression.name} (TODO)</span>
</div>
