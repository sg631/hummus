<!--
  The instrument window for a melody track. Left: every preset (built in, then yours);
  clicking one gives the track that sound. Right: the chosen preset's settings, a control
  per setting of its engine (music/instruments.ts ENGINES), and a keyboard to try it.

  Built-in presets can't be changed: "Duplicate" makes your own copy to edit. Your
  presets live in the project (project.instruments), so they're saved with it, and any
  melody track can use them.
-->
<script lang="ts">
  import Dropdown from './Dropdown.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { previewNote } from '$lib/audio/instruments';
  import { formatParam } from '$lib/music/effects';
  import {
    BUILT_IN_PRESETS,
    ENGINES,
    engine,
    isBuiltIn,
    isSampled,
    paramValue,
    type EngineType,
    type InstrumentParam,
    type NumberParam
  } from '$lib/music/instruments';
  import { SAMPLES_CREDIT } from '$lib/music/samples';
  import { addPreset, project, removePreset, trackPreset } from '$lib/state/project.svelte';

  let { open = $bindable(false), trackId }: { open?: boolean; trackId: string | null } = $props();

  // The built-in presets in two lists: synths, and real instruments (samples).
  const SECTIONS = [
    { title: 'Synths', presets: BUILT_IN_PRESETS.filter((p) => !isSampled(p)) },
    { title: 'Sampled (real instruments)', presets: BUILT_IN_PRESETS.filter(isSampled) }
  ];
  let loading = $state(false); // a sampled instrument downloading for the keyboard

  const track = $derived(project.tracks.find((t) => t.id === trackId && t.kind === 'midi'));
  const preset = $derived(track?.kind === 'midi' ? trackPreset(track) : undefined);
  const builtIn = $derived(!!preset && isBuiltIn(preset.id));
  const definition = $derived(preset && engine(preset.engine));
  // The settings by heading ('Sound', 'Envelope'…), in the order they're listed.
  const groups = $derived.by(() => {
    const byGroup = new Map<string, InstrumentParam[]>();
    for (const p of definition?.params ?? []) byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), p]);
    return [...byGroup];
  });

  // Times and frequencies feel even on a ratio scale, so `log` settings use a 0–1000
  // knob mapped onto min…max by ratio (a 0 minimum is treated as the first step).
  const STEPS = 1000;
  const low = (p: NumberParam) => (p.min > 0 ? p.min : p.step);
  const toSlider = (p: NumberParam, v: number) => (Math.log(Math.max(v, low(p)) / low(p)) / Math.log(p.max / low(p))) * STEPS;
  const fromSlider = (p: NumberParam, s: number) => {
    const v = low(p) * (p.max / low(p)) ** (s / STEPS);
    return Math.round(v / p.step) * p.step;
  };

  function choose(id: string) {
    if (track?.kind === 'midi') track.instrument = id;
  }

  function duplicate() {
    if (!preset || track?.kind !== 'midi') return;
    track.instrument = addPreset(preset).id;
  }

  function changeEngine(type: EngineType) {
    if (!preset || builtIn) return;
    // Settings don't carry over between engines; keep only the volume.
    const volume = preset.params.volume;
    preset.engine = type;
    preset.params = volume === undefined ? {} : { volume };
  }

  function set(key: string, value: number | string) {
    if (preset && !builtIn) preset.params[key] = value;
  }

  // One octave to try the sound: C4 (MIDI 60) to C5.
  const KEYS = Array.from({ length: 13 }, (_, i) => 60 + i);
  const BLACK = [1, 3, 6, 8, 10];
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>Instrument{track ? `: ${track.name}` : ''}</Dialog.Title>
      <Dialog.Description>Pick a preset, or make your own and shape its sound.</Dialog.Description>
    </Dialog.Header>

    {#if track?.kind === 'midi' && preset && definition}
      <div class="grid gap-6 sm:grid-cols-[12rem_1fr]">
        <!-- ---------- Presets ---------- -->
        <div class="flex flex-col gap-1">
          {#each SECTIONS as section, i (section.title)}
            <h3 class="text-muted-foreground text-xs font-semibold uppercase {i > 0 ? 'mt-3' : ''}">{section.title}</h3>
            <div class="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {#each section.presets as p (p.id)}
                <button
                  class="rounded px-2 py-1 text-left text-sm {p.id === preset.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
                  onclick={() => choose(p.id)}
                >
                  {p.name}
                </button>
              {/each}
            </div>
          {/each}

          <h3 class="text-muted-foreground mt-3 text-xs font-semibold uppercase">Yours</h3>
          {#each project.instruments as p (p.id)}
            <button
              class="truncate rounded px-2 py-1 text-left text-sm {p.id === preset.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
              onclick={() => choose(p.id)}
            >
              {p.name}
            </button>
          {:else}
            <p class="text-muted-foreground px-2 text-xs">None yet: duplicate a preset to start.</p>
          {/each}
          <Button size="sm" variant="outline" class="mt-2" onclick={duplicate}>Duplicate “{preset.name}”</Button>
        </div>

        <!-- ---------- The chosen preset ---------- -->
        <div class="flex flex-col gap-4">
          {#if builtIn}
            <p class="bg-muted rounded p-2 text-xs">
              Built-in presets can't be changed. Duplicate it (left) to make your own version.
            </p>
          {:else}
            <div class="flex items-end gap-2">
              <label class="flex flex-1 flex-col gap-1 text-sm font-medium">
                Name
                <input bind:value={preset.name} class="bg-background rounded border px-2 py-1 font-normal" />
              </label>
              <Button variant="destructive" size="sm" onclick={() => removePreset(preset.id)}>Delete preset</Button>
            </div>
          {/if}

          <label class="flex flex-col gap-1 text-sm font-medium">
            Engine
            <Dropdown
              size="default"
              value={preset.engine}
              onchange={(v) => changeEngine(v as EngineType)}
              disabled={builtIn}
              ariaLabel="Engine"
              options={ENGINES.map((en) => ({ value: en.type, label: en.name }))}
            />
            <span class="text-muted-foreground text-xs font-normal">{definition.description}</span>
            {#if definition.bends === false}
              <span class="text-xs font-normal text-amber-600">
                Sung slides and vibrato aren't played with this engine; pick a synth to keep them.
              </span>
            {/if}
          </label>

          {#each groups as [group, params] (group)}
            <h3 class="mt-1 text-sm font-semibold">{group}</h3>
            <!-- Choices (waveform, filter type) as dropdowns, numbers as knobs. -->
            <div class="flex flex-wrap items-start gap-4">
              {#each params as p (p.key)}
                {@const value = paramValue(preset, p)}
                <div class="flex flex-col gap-1.5">
                  {#if p.kind === 'choice'}
                    <label class="flex w-40 flex-col gap-1 text-sm font-medium">
                      {p.label}
                      <Dropdown
                        size="default"
                        class="w-full"
                        value={String(value)}
                        onchange={(v) => set(p.key, v)}
                        disabled={builtIn}
                        ariaLabel={p.label}
                        options={p.options.map((o) => ({ value: o, label: p.labels?.[o] ?? o }))}
                      />
                    </label>
                  {:else if p.log}
                    <Knob
                      class="w-24 text-center"
                      label={p.label}
                      bind:value={() => toSlider(p, Number(value)), (s) => set(p.key, fromSlider(p, s))}
                      min={0}
                      max={STEPS}
                      step={1}
                      defaultValue={toSlider(p, p.default)}
                      format={(s) => formatParam(p, fromSlider(p, s))}
                      disabled={builtIn}
                      automate={preset ? { kind: 'instrument', ownerId: preset.id, param: p.key } : false}
                    />
                  {:else}
                    <Knob
                      class="w-24 text-center"
                      label={p.label}
                      bind:value={() => Number(value), (v) => set(p.key, v)}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      defaultValue={p.default}
                      format={(v) => formatParam(p, v)}
                      disabled={builtIn}
                      automate={preset ? { kind: 'instrument', ownerId: preset.id, param: p.key } : false}
                    />
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>

      <!-- ---------- Try it ---------- -->
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs">Try it (without the track's effects):</span>
        <div class="flex">
          {#each KEYS as pitch (pitch)}
            <button
              class="h-14 flex-1 border text-[10px] {BLACK.includes(pitch % 12) ? 'bg-foreground text-background' : 'bg-background'} active:opacity-60"
              onpointerdown={async () => {
                loading = true;
                try {
                  await previewNote($state.snapshot(preset), pitch + project.transpose + project.detune / 100);
                } finally {
                  loading = false;
                }
              }}
            >
              {NAMES[pitch % 12]}
            </button>
          {/each}
        </div>
        <p class="text-muted-foreground text-xs">
          {#if loading}Loading the recordings…{:else}Changes are heard straight away while playing; a different engine or
            sampled instrument applies on the next Play.{/if}
        </p>
        {#if isSampled(preset)}
          <p class="text-muted-foreground text-xs">{SAMPLES_CREDIT} Downloaded when first used (needs internet).</p>
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
