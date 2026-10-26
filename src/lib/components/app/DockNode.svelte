<!--
  One part of the docking layout (state/layout.svelte.ts), drawn recursively:
  - a split: its children side by side (a row) or stacked (a column), with a border between
    each pair to drag (it resizes the two either side)
  - a stack: tabs for its panels, and the open one's content. Drag a tab out to dock it
    elsewhere or float it; click to open it; ⋯ for float, hide and layouts.
  While a panel is being dragged, each stack shows five drop targets in its middle (left,
  right, top, bottom: dock beside; centre: add as a tab) and where it would land.
-->
<script lang="ts">
  import DockNode from './DockNode.svelte';
  import PanelView from './PanelView.svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import {
    PANEL_NAMES,
    PRESETS,
    activePanel,
    applyLayoutPreset,
    floatPanel,
    hidePanel,
    panelDrag,
    pressPanel,
    saveLayout,
    setActive,
    setSizes,
    type DockNode as Node,
    type Panel,
    type PresetName,
    type Zone
  } from '$lib/state/layout.svelte';
  import { selectedTrack } from '$lib/state/project.svelte';

  let { node }: { node: Node } = $props();

  const label = (p: Panel) => (p === 'editor' ? `Editor${selectedTrack() ? `: ${selectedTrack()!.name}` : ''}` : PANEL_NAMES[p]);
  const TOUR_IDS: Partial<Record<Panel, string>> = { playlist: 'tour-playlist', mixer: 'tour-mixer' };

  // ---------- Resizing a split ----------
  let box = $state<HTMLDivElement>();
  function onBorderDown(e: PointerEvent, i: number) {
    if (e.button !== 0 || node.type !== 'split' || !box) return;
    e.preventDefault();
    const split = node;
    const row = split.dir === 'row';
    const total = row ? box.clientWidth : box.clientHeight;
    const start = row ? e.clientX : e.clientY;
    const sizes0 = [...split.sizes];
    const MIN = 0.06;
    const move = (ev: PointerEvent) => {
      const d = ((row ? ev.clientX : ev.clientY) - start) / total;
      const pair = sizes0[i] + sizes0[i + 1];
      const a = Math.max(MIN, Math.min(pair - MIN, sizes0[i] + d));
      const sizes = [...sizes0];
      sizes[i] = a;
      sizes[i + 1] = pair - a;
      setSizes(split.id, sizes);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener(
      'pointerup',
      () => {
        window.removeEventListener('pointermove', move);
        saveLayout();
      },
      { once: true }
    );
  }

  // Where a panel dropped on this stack would go.
  const ZONES: { zone: Zone; cls: string; icon: string }[] = [
    { zone: 'top', cls: 'col-start-2 row-start-1', icon: '▀' },
    { zone: 'left', cls: 'col-start-1 row-start-2', icon: '▌' },
    { zone: 'center', cls: 'col-start-2 row-start-2', icon: '▣' },
    { zone: 'right', cls: 'col-start-3 row-start-2', icon: '▐' },
    { zone: 'bottom', cls: 'col-start-2 row-start-3', icon: '▄' }
  ];
  const PREVIEW: Record<Zone, string> = {
    left: 'inset-y-0 left-0 w-1/2',
    right: 'inset-y-0 right-0 w-1/2',
    top: 'inset-x-0 top-0 h-1/2',
    bottom: 'inset-x-0 bottom-0 h-1/2',
    center: 'inset-0'
  };
</script>

{#if node.type === 'split'}
  <div bind:this={box} class="flex h-full min-h-0 w-full min-w-0 {node.dir === 'row' ? 'flex-row' : 'flex-col'}">
    {#each node.children as child, i (child.id)}
      <div class="min-h-0 min-w-0 overflow-hidden" style="flex: {node.sizes[i]} 1 0%">
        <DockNode node={child} />
      </div>
      {#if i < node.children.length - 1}
        <div
          class="bg-border hover:bg-primary/60 shrink-0 transition-colors {node.dir === 'row' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}"
          role="separator"
          aria-orientation={node.dir === 'row' ? 'vertical' : 'horizontal'}
          onpointerdown={(e) => onBorderDown(e, i)}
        ></div>
      {/if}
    {/each}
  </div>
{:else}
  {@const stack = node}
  <div class="flex h-full min-h-0 flex-col" role="presentation" onpointerdowncapture={() => (activePanel.panel = stack.active)}>
    <!-- Tabs: click to open, drag to dock elsewhere or float. -->
    <div class="bg-muted/30 flex h-8 shrink-0 items-end gap-0.5 border-b px-1 text-sm">
      {#each stack.panels as p (p)}
        <button
          id={TOUR_IDS[p]}
          role="tab"
          aria-selected={stack.active === p}
          class="max-w-56 cursor-grab truncate rounded-t px-3 py-1 {stack.active === p ? 'bg-background border-x border-t font-semibold' : 'text-muted-foreground hover:text-foreground'}"
          title="Click to open · drag to move it (dock it elsewhere, or drop it anywhere to float it)"
          onpointerdown={(e) => pressPanel(e, p, () => setActive(stack.id, p))}>{label(p)}</button
        >
      {/each}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="text-muted-foreground hover:text-foreground ml-auto self-center rounded px-1.5 text-xs" aria-label="Panel options">⋯</DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-56">
          <DropdownMenu.Item onclick={() => floatPanel(stack.active, { x: 200, y: 140 })}>Float “{PANEL_NAMES[stack.active]}” as a window</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => hidePanel(stack.active)}>Hide “{PANEL_NAMES[stack.active]}”</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Label>Layouts</DropdownMenu.Label>
          {#each Object.entries(PRESETS) as [key, preset] (key)}
            <DropdownMenu.Item onclick={() => applyLayoutPreset(key as PresetName)}>{preset.name}</DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator />
          <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Drag a tab to move a panel; drag the borders to resize.</DropdownMenu.Label>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    <div class="relative min-h-0 flex-1 overflow-auto" id={stack.active === 'editor' ? 'tour-editor' : undefined}>
      <PanelView panel={stack.active} />

      {#if panelDrag.active}
        <!-- Where it would land, and the five targets. -->
        {#if panelDrag.over?.stackId === stack.id}
          <div class="pointer-events-none absolute z-40 rounded bg-sky-500/20 ring-2 ring-sky-500 {PREVIEW[panelDrag.over.zone]}"></div>
        {/if}
        <div class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div class="pointer-events-auto grid grid-cols-3 grid-rows-3 gap-1">
            {#each ZONES as z (z.zone)}
              <div
                data-dock-zone="{stack.id}:{z.zone}"
                class="flex h-9 w-9 items-center justify-center rounded border text-sm shadow {z.cls} {panelDrag.over?.stackId === stack.id && panelDrag.over.zone === z.zone
                  ? 'border-sky-600 bg-sky-500 text-white'
                  : 'bg-background/90 text-sky-700'}"
                title={z.zone === 'center' ? 'Add as a tab here' : `Dock to the ${z.zone}`}
              >
                {z.icon}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
