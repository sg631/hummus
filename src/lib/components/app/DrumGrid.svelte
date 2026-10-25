<!--
  A drum track: its sounds (rows) and the steps of the pattern being edited.
  - Patterns: a drum track can have several (verse beat, chorus beat…). Pick one to edit;
    + New, Copy, Rename, Delete. The Playlist places them in the song; a track with nothing
    placed loops its current pattern for the whole song.
  - Bars: how long the pattern is (1–8 bars, − / +). Steps are sixteenths in the song's
    time signature (16 a bar in 4/4, 12 in 3/4 and 6/8), grouped by beat and bar.
  - click a step to turn it on or off; right-click a row for quick patterns
  - each row is an instrument of its own: sound, volume, pan, swing (follows the track's
    until you turn it), mute (M), effects (FX)
  - swing for the whole track: amount, on eighths or sixteenths, "Match melody"
  The mixer reads all of this while playing, so changes are heard straight away. The step
  playing now has a red ring.
-->
<script lang="ts">
  import Dropdown from './Dropdown.svelte';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import EffectList from './EffectList.svelte';
  import { contextMenu } from '$lib/state/context-menu.svelte';
  import { DRUM_SOUNDS, drumName, STEP_TICKS, stepsPerBar, stepsPerBeat, type DrumSound, type SwingUnit } from '$lib/music/drums';
  import { placementAt, placementLength } from '$lib/music/arrange';
  import { measuredSwing } from '$lib/music/quantize';
  import { barTicks } from '$lib/music/time';
  import type { DrumRow, DrumTrack } from '$lib/music/types';
  import { playhead } from '$lib/state/playhead.svelte';
  import { addDrumRow, cloneContent, deleteContent, newContent, project, removeDrumRow } from '$lib/state/project.svelte';

  let { track }: { track: DrumTrack } = $props();

  const MAX_BARS = 8;
  let fxOpen = $state<string | null>(null); // the row whose effects are showing

  // The pattern being edited (always one: tracks are made with one, older saves upgraded).
  const pattern = $derived(track.patterns.find((p) => p.id === track.current) ?? track.patterns[0]);
  const perBar = $derived(stepsPerBar(project.timeSignature));
  const steps = $derived(perBar * (pattern?.bars ?? 1)); // in the whole pattern
  const beat = $derived(stepsPerBeat(project.timeSignature)); // steps per beat, for grouping

  // The step playing now in this pattern, or -1 (stopped, or another pattern is playing).
  const current = $derived.by(() => {
    if (!playhead.running || playhead.ticks < 0 || !pattern) return -1;
    let local = playhead.ticks;
    if (track.placements.length) {
      const bar = barTicks(project.timeSignature);
      const pl = placementAt(track.placements, playhead.ticks, (p) =>
        placementLength(p, (track.patterns.find((x) => x.id === p.clipId)?.bars ?? 1) * bar)
      );
      if (!pl || pl.clipId !== pattern.id) return -1;
      local = playhead.ticks - pl.start;
    }
    return Math.floor(local / STEP_TICKS) % steps;
  });

  // A row's steps in this pattern (made when first needed).
  function stepsOf(row: DrumRow): boolean[] {
    return (pattern.steps[row.id] ??= []);
  }
  function fill(row: DrumRow, on: (i: number) => boolean) {
    pattern.steps[row.id] = Array.from({ length: steps }, (_, i) => on(i));
  }

  function setBars(bars: number) {
    if (pattern) pattern.bars = Math.max(1, Math.min(MAX_BARS, bars));
  }

  // Longer by a copy of the bars it has (e.g. 1 → 2 bars, the beat repeated).
  function doubleWithCopy() {
    if (!pattern || pattern.bars * 2 > MAX_BARS) return;
    const len = perBar * pattern.bars;
    for (const row of track.rows) {
      const s = stepsOf(row);
      for (let i = 0; i < len; i++) s[len + i] = !!s[i];
    }
    pattern.bars *= 2;
  }

  function rename() {
    const name = window.prompt('Pattern name', pattern.name);
    if (name?.trim()) pattern.name = name.trim();
  }

  // The swing sung on the first recorded melody clip, if it could be measured.
  const melodySwing = $derived.by(() => {
    for (const t of project.tracks) {
      if (t.kind !== 'midi') continue;
      for (const clip of t.clips) {
        if (clip.source) {
          const swing = measuredSwing($state.snapshot(clip.source));
          if (swing !== null) return swing;
        }
      }
    }
    return null;
  });

  function matchMelody() {
    if (melodySwing === null) return;
    track.swing = melodySwing;
    track.swingUnit = 8; // sung swing is measured on eighths
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="flex flex-col gap-3 p-3">
  <!-- Pattern: which one, its length. -->
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
    <span class="font-semibold">Pattern</span>
    <Dropdown
      bind:value={() => track.current ?? '', (v) => (track.current = v)}
      ariaLabel="Pattern"
      options={track.patterns.map((p) => ({ value: p.id, label: p.name }))}
    />
    <Button size="sm" variant="outline" class="h-7" onclick={() => newContent(track)} title="A new empty pattern">+ New</Button>
    <Button size="sm" variant="outline" class="h-7" onclick={() => cloneContent(track, pattern.id)} title="A copy of this pattern to change">Copy</Button>
    <Button size="sm" variant="outline" class="h-7" onclick={rename}>Rename</Button>
    <Button size="sm" variant="outline" class="h-7" disabled={track.patterns.length <= 1} onclick={() => deleteContent(track, pattern.id)} title="Delete this pattern (and its places in the playlist)">Delete</Button>
    <span class="ml-3">Bars</span>
    <div class="flex items-center gap-1">
      <Button size="sm" variant="outline" class="h-7 w-7 px-0" disabled={pattern.bars <= 1} onclick={() => setBars(pattern.bars - 1)} title="Shorter">−</Button>
      <span class="w-6 text-center font-mono">{pattern.bars}</span>
      <Button size="sm" variant="outline" class="h-7 w-7 px-0" disabled={pattern.bars >= MAX_BARS} onclick={() => setBars(pattern.bars + 1)} title="Longer (empty bar)">+</Button>
      <Button size="sm" variant="outline" class="h-7" disabled={pattern.bars * 2 > MAX_BARS} onclick={doubleWithCopy} title="Twice as long, the bars repeated">×2 (copy)</Button>
    </div>
    <span class="text-muted-foreground text-xs">
      {track.placements.length ? 'Plays where the Playlist places it.' : 'Loops for the whole song (place patterns in the Playlist to arrange).'}
    </span>
  </div>

  <!-- Swing for the whole track. -->
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
    <Knob label="Swing" size={44} bind:value={track.swing} min={0.5} max={0.75} step={0.01} defaultValue={0.5} format={pct} />
    <div class="flex items-center gap-2">
      <span>on</span>
      <ToggleGroup.Root
        type="single"
        size="sm"
        bind:value={() => String(track.swingUnit), (v) => v && (track.swingUnit = Number(v) as SwingUnit)}
      >
        <ToggleGroup.Item value="8">8ths</ToggleGroup.Item>
        <ToggleGroup.Item value="16">16ths</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
    <Button size="sm" variant="outline" disabled={melodySwing === null} onclick={matchMelody}>
      Match melody{melodySwing !== null ? ` (${pct(melodySwing)})` : ''}
    </Button>
    <span class="text-muted-foreground text-xs">50% straight · 67% triplet swing · 75% hard swing. Each sound can have its own (row knob).</span>
  </div>

  <div class="overflow-x-auto pb-2">
    {#each track.rows as row (row.id)}
      {@const s = pattern.steps[row.id] ?? []}
      <!-- Each row is an instrument: sound, volume, pan, swing, mute, effects (FX), its steps. -->
      <div
        class="mb-1 flex w-max items-center gap-1"
        use:contextMenu={() => [
          { label: 'Mute', checked: row.mute, action: () => (row.mute = !row.mute) },
          { label: 'Effects…', action: () => (fxOpen = fxOpen === row.id ? null : row.id) },
          { label: 'Follow track swing', disabled: row.swing === undefined, action: () => (row.swing = undefined) },
          { separator: true },
          { label: 'Every beat', action: () => fill(row, (i) => i % beat === 0) },
          { label: 'Every off-beat', action: () => fill(row, (i) => i % beat === Math.floor(beat / 2)) },
          { label: 'Every step', action: () => fill(row, () => true) },
          { label: 'Clear', action: () => fill(row, () => false) },
          { separator: true },
          { label: 'Reset volume and pan', action: () => Object.assign(row, { volume: 0, pan: 0 }) },
          { label: 'Remove sound', danger: true, action: () => removeDrumRow(track, row.id) }
        ]}
      >
        <Dropdown class="w-28" bind:value={row.sound} ariaLabel="Sound" options={DRUM_SOUNDS.map((d) => ({ value: d.type, label: d.name }))} />
        <div title="Volume"><Knob size={24} bind:value={row.volume} min={-30} max={6} step={1} defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${v}dB`} /></div>
        <div title="Pan"><Knob size={24} bind:value={row.pan} min={-1} max={1} step={0.05} defaultValue={0} format={(v) => (Math.abs(v) < 0.025 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)} /></div>
        <div title="Swing for this sound (right-click the row: follow the track's)" class={row.swing === undefined ? 'opacity-50' : ''}>
          <Knob size={24} bind:value={() => row.swing ?? track.swing, (v) => (row.swing = v)} min={0.5} max={0.75} step={0.01} format={(v) => (row.swing === undefined ? 'trk' : pct(v))} />
        </div>
        <button
          class="h-6 w-6 rounded text-xs font-bold {row.mute ? 'bg-amber-500 text-white' : 'text-muted-foreground border'}"
          onclick={() => (row.mute = !row.mute)}
          aria-pressed={row.mute}
          title="Mute this sound">M</button
        >
        <button
          class="mr-1 h-6 rounded px-1.5 text-xs {row.effects.length ? 'bg-primary text-primary-foreground' : 'text-muted-foreground border'}"
          onclick={() => (fxOpen = fxOpen === row.id ? null : row.id)}
          title="Effects on this sound">FX{row.effects.length ? ` ${row.effects.length}` : ''}</button
        >
        {#each Array(steps) as _, step (step)}
          {@const on = !!s[step]}
          <!-- Beats and bars: gaps and lighter boxes make the pattern easy to read. -->
          <button
            class="h-8 w-7 shrink-0 rounded border {on ? 'bg-primary' : step % beat === 0 ? 'bg-muted' : ''} {step > 0 && step % perBar === 0 ? 'ml-3' : step % beat === 0 && step > 0 ? 'ml-1.5' : ''} {step === current ? 'ring-2 ring-red-500' : ''}"
            aria-label="{row.sound} step {step + 1}"
            aria-pressed={on}
            onclick={() => (stepsOf(row)[step] = !on)}
          ></button>
        {/each}
        <button class="text-muted-foreground hover:text-foreground ml-2 px-1" onclick={() => removeDrumRow(track, row.id)} aria-label="Remove row">✕</button>
      </div>
      {#if fxOpen === row.id}
        <div class="mb-2 ml-8 w-72 rounded border p-2">
          <div class="text-muted-foreground mb-1 text-xs">Effects on {drumName(row.sound)}</div>
          <EffectList ownerId={row.id} effects={row.effects} />
        </div>
      {/if}
    {/each}
  </div>

  <!-- Add a sound: a menu of every drum sound. -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button {...props} size="sm" variant="outline" class="w-fit">+ Add sound</Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="max-h-80">
      {#each DRUM_SOUNDS as d (d.type)}
        <DropdownMenu.Item onSelect={() => addDrumRow(track, d.type as DrumSound)}>{d.name}</DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
