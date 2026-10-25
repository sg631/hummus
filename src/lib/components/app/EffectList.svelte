<!--
  An effect chain: a track's, or a drum row's (each row is an instrument of its own).
  One line per effect, in the order the sound goes through them:
  - click the name: its window (settings); the switch: on/off; ✕: remove
  - drag by ⋮⋮ to reorder; right-click for more
  - "+ Effect": search and add one (its window opens straight after)
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { effectDefinition, type EffectType } from '$lib/music/effects';
  import type { Effect } from '$lib/music/types';
  import { contextMenu } from '$lib/state/context-menu.svelte';
  import { addEffect, moveEffect, moveEffectTo, removeEffect } from '$lib/state/project.svelte';
  import AddEffectDialog from './AddEffectDialog.svelte';
  import EffectDialog from './EffectDialog.svelte';

  let { ownerId, effects }: { ownerId: string; effects: Effect[] } = $props();

  let pickerOpen = $state(false);
  let effectOpen = $state(false);
  let effectId = $state<string | null>(null);

  function open(id: string) {
    effectId = id;
    effectOpen = true;
  }

  function onpick(type: EffectType) {
    const effect = addEffect(ownerId, type);
    // Once the picker has finished closing (its animation), open the new effect's window.
    if (effect) setTimeout(() => open(effect.id), 150);
  }

  function duplicate(effect: Effect) {
    const copy = addEffect(ownerId, effect.type);
    if (!copy) return;
    copy.params = { ...effect.params };
    copy.enabled = effect.enabled;
    moveEffectTo(ownerId, copy.id, effects.indexOf(effect) + 1);
  }

  // ---------- Reordering by dragging ----------
  let dragging = $state<string | null>(null); // the effect being dragged
  let dropAt = $state<number | null>(null); // the gap it would land in (0 = before the first)

  function onOver(e: DragEvent, index: number) {
    if (!dragging) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = e.clientY < box.top + box.height / 2 ? index : index + 1;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (dragging && dropAt !== null) moveEffectTo(ownerId, dragging, dropAt);
    dragging = null;
    dropAt = null;
  }
</script>

<div class="flex flex-col gap-1" role="list">
  {#each effects as effect, index (effect.id)}
    <div
      class="relative flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs {dragging === effect.id ? 'opacity-40' : ''}"
      role="listitem"
      draggable="true"
      ondragstart={(e) => {
        dragging = effect.id;
        e.dataTransfer?.setData('text/plain', effect.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      ondragover={(e) => onOver(e, index)}
      ondrop={onDrop}
      ondragend={() => {
        dragging = null;
        dropAt = null;
      }}
      use:contextMenu={() => [
        { label: 'Open settings', action: () => open(effect.id) },
        { label: effect.enabled ? 'Turn off' : 'Turn on', action: () => (effect.enabled = !effect.enabled) },
        { label: 'Duplicate', action: () => duplicate(effect) },
        { separator: true },
        { label: 'Move up', disabled: index === 0, action: () => moveEffect(ownerId, effect.id, -1) },
        { label: 'Move down', disabled: index === effects.length - 1, action: () => moveEffect(ownerId, effect.id, 1) },
        { separator: true },
        { label: 'Remove', danger: true, action: () => removeEffect(ownerId, effect.id) }
      ]}
    >
      {#if dragging && dropAt === index}
        <div class="bg-primary absolute -top-1 right-0 left-0 h-0.5 rounded"></div>
      {/if}
      {#if dragging && dropAt === index + 1 && index === effects.length - 1}
        <div class="bg-primary absolute right-0 -bottom-1 left-0 h-0.5 rounded"></div>
      {/if}
      <span class="text-muted-foreground cursor-grab px-0.5 select-none" title="Drag to reorder">⋮⋮</span>
      <button class="flex-1 truncate text-left {effect.enabled ? '' : 'text-muted-foreground line-through'}" onclick={() => open(effect.id)}>
        {effectDefinition(effect.type).name}
      </button>
      <Switch size="sm" bind:checked={effect.enabled} aria-label="Effect on" />
      <button class="text-muted-foreground hover:text-foreground px-1" onclick={() => removeEffect(ownerId, effect.id)} aria-label="Remove effect">✕</button>
    </div>
  {/each}
  <Button size="sm" variant="ghost" class="h-7 justify-start text-xs" onclick={() => (pickerOpen = true)}>+ Effect</Button>
</div>

<AddEffectDialog bind:open={pickerOpen} {onpick} />
<EffectDialog bind:open={effectOpen} trackId={ownerId} {effectId} />
