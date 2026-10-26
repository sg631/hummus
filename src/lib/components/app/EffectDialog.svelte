<!--
  One effect's own window: switch it on or off, a slider per setting, move it earlier or
  later in the chain, or remove it. The sliders change `effect.params` in the project;
  TrackList's $effect passes the change to the sound, so you hear it while playing.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { defaultParams, effectDefinition, formatParam, type EffectParam } from '$lib/music/effects';
  import { automationFor, moveEffect, effectOwner, removeEffect, sidechainSources } from '$lib/state/project.svelte';
  import Dropdown from './Dropdown.svelte';
  import Spectrum from './Spectrum.svelte';
  import { canAutomate } from '$lib/music/automation';
  import { automatable, shown } from '$lib/state/automation.svelte';

  let {
    open = $bindable(false),
    trackId,
    effectId
  }: { open?: boolean; trackId: string | null; effectId: string | null } = $props();

  // The track or drum row the effect is on (trackId is either).
  const track = $derived(trackId ? effectOwner(trackId) : undefined);
  const effect = $derived(track?.effects.find((e) => e.id === effectId));
  const definition = $derived(effect && effectDefinition(effect.type));
  const position = $derived(track && effect ? track.effects.indexOf(effect) : -1);

  // Frequencies feel even on a ratio scale (100 → 200 Hz is as big a step as 1000 → 2000),
  // so `log` settings use a 0–1000 knob mapped onto min…max by ratio.
  const SLIDER_STEPS = 1000;
  const toSlider = (p: EffectParam, v: number) => (Math.log(v / p.min) / Math.log(p.max / p.min)) * SLIDER_STEPS;
  const fromSlider = (p: EffectParam, s: number) => Math.round(p.min * (p.max / p.min) ** (s / SLIDER_STEPS));

  // Ctrl+drag a knob onto an automation lane (or right-click it) to automate that setting
  // (not ones too slow to change while playing). Dragged out of this window, it fades.
  const laneOf = (key: string) => (trackId && effectId ? automationFor(trackId, key, effectId) : undefined);
  const targetOf = (p: EffectParam) =>
    trackId && effect && canAutomate(effect.type, p.key) ? { kind: 'effect' as const, ownerId: trackId, effectId: effect.id, param: p.key } : undefined;
  const value = (p: EffectParam) => shown(laneOf(p.key), effect?.params[p.key] ?? p.default);
  const amber = (p: EffectParam) => (laneOf(p.key)?.enabled ? 'rgb(245 158 11)' : undefined);

  function remove() {
    if (trackId && effectId) removeEffect(trackId, effectId);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    {#if track && effect && definition}
      <Dialog.Header>
        <Dialog.Title>{definition.name}</Dialog.Title>
        <Dialog.Description>{definition.description} On {track.name}, effect {position + 1} of {track.effects.length}.</Dialog.Description>
      </Dialog.Header>

      <div class="flex items-center gap-2">
        <span class="flex" use:automatable={trackId ? { kind: 'effect', ownerId: trackId, effectId: effect.id, param: 'enabled' } : false} title="Ctrl+drag onto an automation lane to automate">
          <Switch id="effect-on" bind:checked={effect.enabled} />
        </span>
        <Label for="effect-on">{effect.enabled ? 'On' : 'Off (bypassed)'}</Label>
      </div>

      {#if effect.type === 'sidechain'}
        <!-- What it listens to: ducks whenever that plays. -->
        <label class="flex items-center gap-2 text-sm">
          <span class="shrink-0">Duck when this plays</span>
          <Dropdown
            value={effect.source ?? ''}
            onchange={(v: string) => (effect.source = v || undefined)}
            ariaLabel="Sidechain source"
            options={[{ value: '', label: 'Choose a track…' }, ...sidechainSources(trackId ?? '').map((s) => ({ value: s.id, label: s.name }))]}
          />
        </label>
        {#if !effect.source}<p class="text-muted-foreground text-xs">Pick the track that should push this one down (usually the kick).</p>{/if}
      {/if}

      {#if trackId && ['eq', 'lowpass', 'highpass', 'bandpass', 'compressor', 'autowah', 'autofilter'].includes(effect.type)}
        <!-- What this channel's frequencies look like now (while playing): see the EQ / filter work. -->
        <div class="flex flex-col items-center gap-0.5">
          <Spectrum id={trackId} width={380} height={70} />
          <span class="text-muted-foreground text-[10px]">This channel's frequencies while playing (100 Hz · 1 kHz · 10 kHz)</span>
        </div>
      {/if}

      <!-- A knob per setting: drag up or down (or arrow keys), double-click for the default. -->
      <div class="flex flex-wrap justify-center gap-4">
        {#each definition.params as p (p.key)}
          {#if p.log}
            <Knob
              class="w-24 text-center"
              label={p.label}
              bind:value={() => toSlider(p, value(p)), (s) => (effect.params[p.key] = fromSlider(p, s))}
              min={0}
              max={SLIDER_STEPS}
              step={1}
              defaultValue={toSlider(p, p.default)}
              format={(s) => formatParam(p, fromSlider(p, s))}
              disabled={!effect.enabled}
              color={amber(p)}
              automate={targetOf(p) ?? false}
            />
          {:else}
            <Knob
              class="w-24 text-center"
              label={p.label}
              bind:value={() => value(p), (v) => (effect.params[p.key] = v)}
              min={p.min}
              max={p.max}
              step={p.step}
              defaultValue={p.default}
              format={(v) => formatParam(p, v)}
              disabled={!effect.enabled}
              color={amber(p)}
              automate={targetOf(p) ?? false}
            />
          {/if}
        {/each}
      </div>

      <Dialog.Footer class="flex-wrap gap-2 sm:justify-between">
        <div class="flex gap-2">
          <Button variant="outline" size="sm" disabled={position <= 0} onclick={() => moveEffect(trackId!, effect.id, -1)}>
            ↑ Earlier
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={position >= track.effects.length - 1}
            onclick={() => moveEffect(trackId!, effect.id, 1)}
          >
            ↓ Later
          </Button>
          <Button variant="outline" size="sm" onclick={() => (effect.params = defaultParams(effect.type))}>Reset</Button>
        </div>
        <div class="flex gap-2">
          <Button variant="destructive" size="sm" onclick={remove}>Remove</Button>
          <Button size="sm" onclick={() => (open = false)}>Done</Button>
        </div>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
