<!--
  The Quantize bar above the piano roll: snap the track's notes to the beat, and set swing.

  - Recorded clips keep their notes as sung (`clip.source`), so every change here
    re-quantizes them from that, live: try a setting, hear it, change your mind.
  - Clips without a source (drawn by hand, or edited after recording) can't be redone
    from the singing; "Quantize now" applies the settings to their notes as they are.

  Auto grid picks straight, triplet or swung rhythm beat by beat, and measures the swing
  you sang (shown here). Turn "Swing: auto" off to set it yourself.
-->
<script lang="ts">
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import {
    AUTO_GRID,
    GRID_OPTIONS,
    analyzeRhythm,
    measuredSwing,
    quantizeNotes,
    requantize,
    type QuantizeSettings
  } from '$lib/music/quantize';
  import type { MidiTrack } from '$lib/music/types';
  import { isCompound, rhythmBeat } from '$lib/music/rhythm';
  import { ticksToSeconds } from '$lib/music/time';
  import { checkpoint } from '$lib/state/history.svelte';
  import { project } from '$lib/state/project.svelte';
  import { recordingSettings } from '$lib/state/settings.svelte';

  let { track }: { track: MidiTrack } = $props();

  const recorded = $derived(track.clips.filter((c) => c.source));
  const edited = $derived(track.clips.filter((c) => !c.source && c.notes.length));
  // Settings for clips without a source: start from the recording defaults.
  let manual = $state<QuantizeSettings>({ ...recordingSettings.take.quantize });
  // What the bar shows: the first recorded clip's settings, or the manual ones.
  const settings = $derived(recorded[0]?.source?.quantize ?? manual);
  const sung = $derived(recorded[0]?.source ? measuredSwing($state.snapshot(recorded[0].source)) : null);

  // The time signature changed: the Auto grid follows the meter (beats, triplet feel), so
  // re-quantize recorded clips in the new one. Their notes stay at the same ticks.
  $effect(() => {
    const ts = project.timeSignature;
    for (const clip of recorded) {
      const source = clip.source!;
      if (source.timeSignature[0] === ts[0] && source.timeSignature[1] === ts[1]) continue;
      source.timeSignature = [ts[0], ts[1]];
      clip.notes = requantize($state.snapshot(source));
    }
  });

  // Changes settings and re-quantizes every recorded clip from its singing.
  function update(change: Partial<QuantizeSettings>) {
    checkpoint(track, 'Quantize', 'quantize-bar');
    manual = { ...manual, ...change };
    for (const clip of recorded) {
      const source = clip.source!;
      source.quantize = { ...source.quantize, ...change };
      clip.notes = requantize($state.snapshot(source));
    }
  }

  function quantizeNow() {
    checkpoint(track, 'Quantize');
    for (const clip of edited) clip.notes = quantizeNotes($state.snapshot(clip.notes), manual, project.timeSignature, project.bpm);
  }

  // What the Auto grid read in the first recorded take: how far you sat behind or ahead of
  // the beat (allowed for), and beats that could be read another way.
  const reading = $derived.by(() => {
    const source = recorded[0]?.source;
    if (!source || source.quantize.grid !== AUTO_GRID) return null;
    const r = analyzeRhythm($state.snapshot(source.notes), $state.snapshot(source.quantize), source.timeSignature, source.bpm);
    const beat = rhythmBeat(source.timeSignature);
    const perBar = isCompound(source.timeSignature) ? source.timeSignature[0] / 3 : source.timeSignature[0];
    const where = (tick: number) => {
      const b = Math.round(tick / beat);
      return `bar ${Math.floor(b / perBar) + 1} beat ${(b % perBar) + 1}`;
    };
    return { lateMs: Math.round(ticksToSeconds(r.offset, source.bpm) * 1000), ambiguous: r.ambiguous.map((c) => where(c.start)) };
  });
  const tuning = $derived(recorded[0]?.source?.tuningCents);

  const swingValue = $derived(typeof settings.swing === 'number' ? settings.swing : (sung ?? 0.5));
</script>

<!-- Always shown, one row, so the piano roll below never jumps when notes come and go. -->
<div class="bg-background flex items-center gap-x-5 overflow-x-auto border-b px-3 py-2 text-xs whitespace-nowrap">
  <span class="font-semibold">Quantize</span>

  <ToggleGroup.Root
    type="single"
    size="sm"
    bind:value={() => String(settings.grid), (v) => v && update({ grid: Number(v) })}
  >
    {#each GRID_OPTIONS as option (option.ticks)}
      <ToggleGroup.Item value={String(option.ticks)} class="text-xs">{option.label}</ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>

  <div class="flex w-40 items-center gap-2">
    <span class="shrink-0">Strength {Math.round(settings.strength * 100)}%</span>
    <Slider type="single" bind:value={() => settings.strength, (v) => update({ strength: v })} min={0} max={1} step={0.05} />
  </div>

  <label class="flex items-center gap-1.5">
    <Switch size="sm" bind:checked={() => settings.durations, (v) => update({ durations: v })} />
    Lengths
  </label>

  {#if settings.grid === AUTO_GRID}
    <label class="flex items-center gap-1.5">
      <Switch
        size="sm"
        bind:checked={() => settings.swing === 'auto', (on) => update({ swing: on ? 'auto' : swingValue })}
      />
      Swing: auto{settings.swing === 'auto' && sung !== null ? ` (you sang ${Math.round(sung * 100)}%)` : ''}
    </label>
    {#if settings.swing !== 'auto'}
      <div class="flex w-44 items-center gap-2">
        <span class="shrink-0">Swing {Math.round(swingValue * 100)}%</span>
        <Slider type="single" bind:value={() => swingValue, (v) => update({ swing: v })} min={0.5} max={0.75} step={0.01} />
      </div>
    {/if}
  {/if}

  <Button
    size="sm"
    variant="outline"
    class="h-7 text-xs"
    disabled={!edited.length}
    onclick={quantizeNow}
    title="Notes drawn or edited by hand can't be redone from the singing: this snaps them as they are"
  >
    Quantize now
  </Button>

  <!-- What the take showed (from the test bench): timing, ambiguous beats, your tuning. -->
  {#if reading && Math.abs(reading.lateMs) >= 10}
    <span class="text-muted-foreground" title="Allowed for when quantizing">You sat {Math.abs(reading.lateMs)} ms {reading.lateMs > 0 ? 'behind' : 'ahead of'} the beat</span>
  {/if}
  {#if reading?.ambiguous.length}
    <span class="text-muted-foreground" title={reading.ambiguous.join('; ')}>{reading.ambiguous.length} beat{reading.ambiguous.length > 1 ? 's' : ''} could be read another way</span>
  {/if}
  {#if tuning !== undefined && Math.abs(tuning) >= 1}
    <span class="text-muted-foreground" title="Notes are named against your own tuning (Settings → Transcription)">Your tuning: {tuning > 0 ? '+' : ''}{Math.round(tuning)}¢ from A440</span>
  {/if}
</div>
