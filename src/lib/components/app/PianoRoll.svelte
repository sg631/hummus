<!--
  The notes of a MIDI track, drawn as an SVG: time goes right, pitch goes up.
  An SVG is markup like HTML: <rect x=… y=… width=… height=…/> draws a box, and boxes
  can have onclick / onpointerdown like buttons.

  Build it in steps, checking each in the browser:
  1. draw a <rect> per note (below)                     ← started for you
  2. click a note to select it (selection.noteId = note.id), and draw it in another colour
  3. Delete key removes the selected note (<svelte:window onkeydown={…}/>)
  4. drag to move a note: onpointerdown remembers where; onpointermove changes note.start
     and note.pitch by how far the pointer moved (snap start to a grid, e.g. PPQ / 4)
  5. double-click empty space to add a note there
  6. (nice) notes with note.alternatives: click to switch pitch to note.alternatives[0]
-->
<script lang="ts">
  import type { MidiTrack } from '$lib/music/types';
  import { PPQ } from '$lib/music/time';
  import { selection } from '$lib/state/project.svelte';

  let { track }: { track: MidiTrack } = $props(); // the track to show, from the page

  const PX_PER_BEAT = 80;          // horizontal zoom
  const ROW = 12;                  // pixels per semitone
  const TOP = 84;                  // highest pitch shown (C6); notes above are off-screen
  const BOTTOM = 36;               // lowest (C2)

  // ticks → x, pitch → y, and back. Keep all position maths in these.
  const x = (ticks: number) => (ticks / PPQ) * PX_PER_BEAT;
  const y = (pitch: number) => (TOP - pitch) * ROW;

  const width = $derived(Math.max(800, ...track.clips.map((c) => x(c.start + c.duration) + 100)));
  const height = (TOP - BOTTOM + 1) * ROW;
</script>

<svg {width} {height} class="bg-muted/30 block">
  {#each track.clips as clip (clip.id)}
    {#each clip.notes as note (note.id)}
      <rect
        x={x(clip.start + note.start)}
        y={y(note.pitch)}
        width={x(note.duration)}
        height={ROW - 1}
        rx="2"
        class={selection.noteId === note.id ? 'fill-amber-500' : 'fill-sky-600'}
      />
    {/each}
  {/each}
</svg>
