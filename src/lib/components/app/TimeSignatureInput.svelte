<!--
  The time signature as two fields stacked like on sheet music: beats per bar over the note
  that gets the beat (4 over 4, 6 over 8…).
  Type a number, or use the arrow keys / scroll. The bottom number has to be 2, 4, 8 or 16:
  the arrow keys step between those, and anything else typed snaps to the nearest.
  Changes apply when you press Enter or leave the field.
-->
<script lang="ts">
  import { Input } from '$lib/components/ui/input/index.js';
  import { project } from '$lib/state/project.svelte';

  let { disabled = false }: { disabled?: boolean } = $props();

  const UNITS = [2, 4, 8, 16];
  // A small borderless number field, without the browser's up/down arrows (they don't fit).
  const FIELD =
    'h-[18px] rounded-sm border-0 bg-transparent px-0 py-0 text-center font-mono text-sm leading-none font-semibold shadow-none focus-visible:ring-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  const MAX_BEATS = 32;

  // What's in the boxes (text while typing), refreshed when the project changes elsewhere.
  let beats = $state(String(project.timeSignature[0]));
  let unit = $state(String(project.timeSignature[1]));
  $effect(() => {
    beats = String(project.timeSignature[0]);
    unit = String(project.timeSignature[1]);
  });

  const beatsValid = $derived(Number.isInteger(Number(beats)) && Number(beats) >= 1 && Number(beats) <= MAX_BEATS);

  function commitBeats() {
    const n = Math.round(Number(beats));
    if (n >= 1 && n <= MAX_BEATS) project.timeSignature = [n, project.timeSignature[1]];
    else beats = String(project.timeSignature[0]); // not a number of beats: put it back
  }

  // Snaps to the nearest of 2, 4, 8, 16 (by ratio: 6 → 8, 3 → 4).
  function commitUnit() {
    const n = Number(unit);
    if (!(n > 0)) {
      unit = String(project.timeSignature[1]);
      return;
    }
    const nearest = UNITS.reduce((best, u) => (Math.abs(Math.log2(u / n)) < Math.abs(Math.log2(best / n)) ? u : best));
    project.timeSignature = [project.timeSignature[0], nearest];
    unit = String(nearest);
  }

  function onUnitKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); // not ±1: step between 2, 4, 8, 16
    const i = UNITS.indexOf(project.timeSignature[1]);
    const next = UNITS[Math.max(0, Math.min(UNITS.length - 1, (i < 0 ? 1 : i) + (e.key === 'ArrowUp' ? 1 : -1)))];
    project.timeSignature = [project.timeSignature[0], next];
  }

  const onEnter = (commit: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      commit();
      (e.currentTarget as HTMLInputElement).blur();
    }
  };
</script>

<!-- Stacked like on sheet music: beats on top, the beat note below, a line between. -->
<div class="flex h-10 w-11 flex-col items-stretch justify-center rounded-md border" title="Time signature: beats per bar over the note that gets the beat (arrow keys or type)">
  <Input
    type="number"
    min={1}
    max={MAX_BEATS}
    bind:value={beats}
    onchange={commitBeats}
    onblur={commitBeats}
    onkeydown={onEnter(commitBeats)}
    aria-label="Beats per bar"
    aria-invalid={!beatsValid}
    {disabled}
    class={FIELD}
  />
  <div class="bg-foreground mx-2 h-px"></div>
  <Input
    type="number"
    min={2}
    max={16}
    bind:value={unit}
    onchange={commitUnit}
    onblur={commitUnit}
    onkeydown={(e) => {
      onUnitKey(e);
      onEnter(commitUnit)(e);
    }}
    aria-label="Beat note (2, 4, 8 or 16)"
    {disabled}
    class={FIELD}
  />
</div>
