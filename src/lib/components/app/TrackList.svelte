<!--
  The tracks, one card each, and buttons to add tracks.
  - click a card's name to select the track (the editor and Record use it); double-click
    (or right-click → Rename) to rename it
  - ▾ folds a card to its title row (▸ opens it); M mutes, S solos (only soloed tracks
    play), ⧉ duplicates, ✕ deletes
  - melody tracks: instrument (✎ designs your own), and Allow Polyphony (multiple notes at
    once, e.g. chords; no pitch bends)
  - knobs: volume, pan, swing (melody and drums); drag up/down, double-click or
    right-click to reset
  - effects (EffectList): the sound goes through them in order
  Right-click a card for everything at once.

  Svelte reminders:
  - {#each list as item (item.id)} … {/each} repeats markup for each item; the (item.id)
    lets Svelte keep rows straight when the list changes.
  - Changing a track (track.mute = true) updates the screen: tracks live in $state.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { applyMix } from '$lib/audio/mixer';
  import { presetById } from '$lib/music/instruments';
  import type { Track } from '$lib/music/types';
  import { contextMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import {
    addDrumTrack,
    addMidiTrack,
    addVoiceTrack,
    duplicateTrack,
    project,
    removeTrack,
    selection
  } from '$lib/state/project.svelte';
  import EffectList from './EffectList.svelte';
  import InstrumentDialog from './InstrumentDialog.svelte';
  import InstrumentBrowser from './InstrumentBrowser.svelte';

  // Runs again whenever any volume, pan, mute, solo, effect or instrument changes (it
  // reads them all), so changes are heard straight away while playing.
  $effect(() => {
    void JSON.stringify([
      project.instruments,
      project.tracks.map((t) => [
        t.volume, t.pan, t.mute, t.solo, t.effects,
        t.kind === 'midi' ? [t.instrument, t.poly] : null,
        t.kind === 'drums' ? t.rows.map((r) => [r.volume, r.pan, r.mute, r.effects]) : null
      ])
    ]);
    applyMix(project);
  });

  let instrumentOpen = $state(false);
  let browserOpen = $state(false);
  function browseInstrument(id: string) {
    instrumentTrack = id;
    browserOpen = true;
  }
  let instrumentTrack = $state<string | null>(null);

  // ---------- Renaming ----------
  let renaming = $state<string | null>(null); // the track whose name is being edited
  let nameInput = $state<HTMLInputElement>();

  async function rename(id: string) {
    renaming = id;
    await tick();
    nameInput?.select();
  }

  const formatDb = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} dB`;
  const formatPan = (v: number) => (Math.abs(v) < 0.025 ? 'C' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`);
  const formatSwing = (v: number) => (v <= 0.5 ? 'off' : `${Math.round(v * 100)}%`);

  function menuFor(track: Track): MenuItem[] {
    return [
      { label: track.collapsed ? 'Expand' : 'Collapse', action: () => (track.collapsed = !track.collapsed) },
      { label: 'Rename', action: () => rename(track.id) },
      { label: 'Duplicate', action: () => duplicateTrack(track.id) },
      { separator: true },
      { label: 'Mute', checked: track.mute, action: () => (track.mute = !track.mute) },
      { label: 'Solo', checked: !!track.solo, action: () => (track.solo = !track.solo) },
      ...(track.kind === 'midi'
        ? [
            { separator: true },
            { label: 'Choose instrument…', action: () => browseInstrument(track.id) },
            { label: 'Edit instrument…', action: () => openInstrument(track.id) },
            { label: 'Allow Polyphony (multiple notes)', checked: !!track.poly, action: () => (track.poly = !track.poly) }
          ]
        : []),
      ...(track.kind !== 'voice'
        ? [{ label: 'Swing off', disabled: track.swing <= 0.5, action: () => (track.swing = 0.5) }]
        : []),
      { label: 'Reset volume and pan', action: () => Object.assign(track, { volume: 0, pan: 0 }) },
      { separator: true },
      { label: 'Delete track', danger: true, action: () => removeTrack(track.id) }
    ];
  }

  function openInstrument(id: string) {
    instrumentTrack = id;
    instrumentOpen = true;
  }
</script>

<aside
  id="tour-tracks"
  class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
  use:contextMenu={() => [
    { label: 'Collapse all', action: () => project.tracks.forEach((t) => (t.collapsed = true)) },
    { label: 'Expand all', action: () => project.tracks.forEach((t) => (t.collapsed = false)) },
    { separator: true },
    { label: 'Add melody track', action: () => addMidiTrack() },
    { label: 'Add voice track', action: () => addVoiceTrack() },
    { label: 'Add drum track', action: () => addDrumTrack() }
  ]}
>
  <h2 class="text-sm font-semibold">Tracks</h2>

  {#each project.tracks as track (track.id)}
    <div
      class="flex flex-col gap-2 rounded border p-2 {selection.trackId === track.id ? 'border-primary' : ''}"
      use:contextMenu={() => menuFor(track)}
    >
      <div class="flex items-center gap-1">
        <!-- Fold the card down to this row (or open it again). -->
        <button
          class="text-muted-foreground hover:text-foreground w-4 shrink-0 text-xs"
          onclick={() => (track.collapsed = !track.collapsed)}
          aria-expanded={!track.collapsed}
          title={track.collapsed ? 'Show the track’s controls' : 'Fold the track to its title'}
        >
          {track.collapsed ? '▸' : '▾'}
        </button>
        {#if renaming === track.id}
          <input
            bind:this={nameInput}
            bind:value={track.name}
            class="bg-background min-w-0 flex-1 rounded border px-1 text-sm font-medium"
            onkeydown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (renaming = null)}
            onblur={() => {
              if (!track.name.trim()) track.name = 'Track';
              renaming = null;
            }}
            aria-label="Track name"
          />
        {:else}
          <!-- Click: select. Double-click: rename. -->
          <button class="min-w-0 flex-1 text-left" onclick={() => (selection.trackId = track.id)} ondblclick={() => rename(track.id)} title="Double-click to rename">
            <div class="truncate text-sm font-medium">{track.name}</div>
            <div class="text-muted-foreground text-xs">{track.kind === 'midi' ? (track.poly ? 'melody · polyphonic' : 'melody') : track.kind}</div>
          </button>
        {/if}
        <button
          class="h-6 w-6 rounded text-xs font-bold {track.mute ? 'bg-amber-500 text-white' : 'text-muted-foreground border'}"
          onclick={() => (track.mute = !track.mute)}
          aria-pressed={track.mute}
          title="Mute">M</button
        >
        <button
          class="h-6 w-6 rounded text-xs font-bold {track.solo ? 'bg-sky-500 text-white' : 'text-muted-foreground border'}"
          onclick={() => (track.solo = !track.solo)}
          aria-pressed={!!track.solo}
          title="Solo: only soloed tracks play">S</button
        >
        <button class="text-muted-foreground hover:text-foreground h-6 w-6 text-sm" onclick={() => duplicateTrack(track.id)} title="Duplicate track">⧉</button>
        <button class="text-muted-foreground hover:text-foreground h-6 w-6 text-sm" onclick={() => removeTrack(track.id)} aria-label="Delete track" title="Delete track">✕</button>
      </div>

      {#if !track.collapsed}
      {#if track.kind === 'midi'}
        <!-- Quick pick of a preset, or ✎ for the instrument window (make and edit presets). -->
        <div class="flex items-center gap-1 text-xs">
          <!-- The instrument: opens the instrument browser (search, presets, your sounds). -->
          <Button size="sm" variant="outline" class="h-7 min-w-0 flex-1 justify-between px-2 text-xs" onclick={() => browseInstrument(track.id)} title="Choose the instrument">
            <span class="truncate">{presetById(project.instruments, track.instrument).name}</span><span class="text-muted-foreground">▾</span>
          </Button>
          <Button size="sm" variant="ghost" class="h-6 px-2" onclick={() => openInstrument(track.id)} aria-label="Edit instrument">✎</Button>
        </div>
        <label class="flex items-center gap-2 text-xs" title="Notes can overlap (chords, layers). Sung slides and vibrato aren't played.">
          <Switch size="sm" bind:checked={() => !!track.poly, (v) => (track.poly = v)} />
          Allow Polyphony (multiple notes)
        </label>
      {/if}

      <!-- Knobs: drag up or down to turn, double-click (or right-click) to reset. -->
      <div class="flex items-center justify-around text-xs">
        <Knob label="Volume" size={38} bind:value={track.volume} min={-40} max={6} step={1} defaultValue={0} format={formatDb} />
        <Knob label="Pan" size={38} bind:value={track.pan} min={-1} max={1} step={0.05} defaultValue={0} format={formatPan} />
        {#if track.kind !== 'voice'}
          <Knob label="Swing" size={38} bind:value={track.swing} min={0.5} max={0.75} step={0.01} defaultValue={0.5} format={formatSwing} />
        {/if}
      </div>

      <EffectList ownerId={track.id} effects={track.effects} />
      {/if}
    </div>
  {:else}
    <p class="text-muted-foreground text-sm">No tracks yet.</p>
  {/each}

  <div id="tour-add-tracks" class="flex flex-wrap gap-2">
    <Button size="sm" variant="outline" onclick={() => addMidiTrack()}>+ Melody</Button>
    <Button size="sm" variant="outline" onclick={() => addVoiceTrack()}>+ Voice</Button>
    <Button size="sm" variant="outline" onclick={() => addDrumTrack()}>+ Drums</Button>
  </div>
</aside>

<InstrumentDialog bind:open={instrumentOpen} trackId={instrumentTrack} />
<InstrumentBrowser bind:open={browserOpen} trackId={instrumentTrack} onedit={() => (instrumentOpen = true)} />
