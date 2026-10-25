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
  import { moveEffect, effectOwner, removeEffect } from '$lib/state/project.svelte';

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
        <Switch id="effect-on" bind:checked={effect.enabled} />
        <Label for="effect-on">{effect.enabled ? 'On' : 'Off (bypassed)'}</Label>
      </div>

      <!-- A knob per setting: drag up or down (or arrow keys), double-click for the default. -->
      <div class="flex flex-wrap justify-center gap-4">
        {#each definition.params as p (p.key)}
          {#if p.log}
            <Knob
              class="w-24 text-center"
              label={p.label}
              bind:value={() => toSlider(p, effect.params[p.key] ?? p.default), (s) => (effect.params[p.key] = fromSlider(p, s))}
              min={0}
              max={SLIDER_STEPS}
              step={1}
              defaultValue={toSlider(p, p.default)}
              format={(s) => formatParam(p, fromSlider(p, s))}
              disabled={!effect.enabled}
            />
          {:else}
            <Knob
              class="w-24 text-center"
              label={p.label}
              bind:value={() => effect.params[p.key] ?? p.default, (v) => (effect.params[p.key] = v)}
              min={p.min}
              max={p.max}
              step={p.step}
              defaultValue={p.default}
              format={(v) => formatParam(p, v)}
              disabled={!effect.enabled}
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
