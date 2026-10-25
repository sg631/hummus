<!--
  The tempo as a wheel: scroll it, drag it, or click a number. Collapsed it shows just the
  tempo; hovering opens it over whatever is below (it's absolutely positioned, so it
  doesn't push the layout around).

  The wheel only scrolls to its value when it first appears, so if the tempo changes
  somewhere else (Settings, loading a project) it's re-created ({#key}) at the new value.
-->
<script lang="ts">
  import * as WheelPicker from '$lib/components/ui/wheel-picker/index.js';
  import { project } from '$lib/state/project.svelte';

  let { disabled = false }: { disabled?: boolean } = $props();

  const TEMPOS = Array.from({ length: 201 }, (_, i) => String(40 + i)); // 40–240 BPM

  let value = $state(String(project.bpm));
  let key = $state(0);

  // Changed elsewhere: jump the wheel there.
  $effect(() => {
    if (String(project.bpm) !== value) {
      value = String(project.bpm);
      key++;
    }
  });
</script>

<div class="relative h-10 w-24 shrink-0 {disabled ? 'pointer-events-none opacity-50' : ''}" title="Tempo: scroll or drag">
  <span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 z-[60] -translate-y-1/2 text-[10px]">BPM</span>
  {#key key}
    <WheelPicker.Root collapsed class="absolute top-0 left-0 z-50 rounded-md border shadow-sm">
      <WheelPicker.Group bind:value onValueChange={(v) => (project.bpm = Number(v))}>
        {#each TEMPOS as bpm (bpm)}
          <WheelPicker.Item value={bpm}>{bpm}</WheelPicker.Item>
        {/each}
      </WheelPicker.Group>
    </WheelPicker.Root>
  {/key}
</div>
