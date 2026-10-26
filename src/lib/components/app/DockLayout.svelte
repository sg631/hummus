<!--
  The studio's panels (state/layout.svelte.ts): the docked tree (DockNode), floating windows
  over it, and, while a tab is dragged, a ghost under the pointer.
  - a floating window: drag its title to move it (onto a stack's drop targets to dock it
    again), its right / bottom edges or corner to resize; ⇲ docks it back, – hides it
  - opening a panel from anywhere (view.main = 'playlist', a double-click in the playlist…)
    brings it to the front wherever it is
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import DockNode from './DockNode.svelte';
  import PanelView from './PanelView.svelte';
  import {
    PANEL_NAMES,
    activePanel,
    dock,
    hidePanel,
    layout,
    panelDrag,
    pressPanel,
    raise,
    resizeFloating,
    saveLayout,
    showPanel,
    stackOf,
    stacks,
    type Panel
  } from '$lib/state/layout.svelte';
  import { selectedTrack } from '$lib/state/project.svelte';
  import { view } from '$lib/state/view.svelte';

  // Opening a panel from anywhere: to the front.
  $effect(() => {
    const panel = view.main;
    untrack(() => showPanel(panel));
  });

  const label = (p: Panel) => (p === 'editor' ? `Editor${selectedTrack() ? `: ${selectedTrack()!.name}` : ''}` : PANEL_NAMES[p]);
  const ordered = $derived([...layout.floating].sort((a, b) => a.z - b.z));

  // Back into the layout: as a tab beside the editor (or the first stack).
  function dockBack(panel: Panel) {
    const home = stackOf('editor') ?? stacks()[0];
    if (home) dock(panel, home.id, 'center');
    else dock(panel, '', 'center');
  }

  function onResizeDown(e: PointerEvent, panel: Panel, edges: { w: boolean; h: boolean }) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const f = layout.floating.find((p) => p.panel === panel)!;
    const start = { x: e.clientX, y: e.clientY, w: f.w, h: f.h };
    const move = (ev: PointerEvent) =>
      resizeFloating(panel, edges.w ? start.w + ev.clientX - start.x : f.w, edges.h ? start.h + ev.clientY - start.y : f.h);
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
</script>

<div class="relative min-h-0 flex-1">
  {#if layout.root}
    <DockNode node={layout.root} />
  {:else}
    <div class="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
      Every panel is floating or hidden: drag one onto here, or use View → Panels.
      <div class="sr-only" data-dock-zone=":center"></div>
    </div>
  {/if}
</div>

<!-- Floating windows: the last one touched on top. -->
{#each ordered as f (f.panel)}
  <div
    class="bg-background fixed z-40 flex flex-col overflow-hidden rounded-lg border shadow-2xl {panelDrag.active && panelDrag.panel === f.panel ? 'pointer-events-none opacity-80' : ''}"
    style="left: {f.x}px; top: {f.y}px; width: {f.w}px; height: {f.h}px"
    role="region"
    aria-label={PANEL_NAMES[f.panel]}
    onpointerdowncapture={() => {
      raise(f.panel);
      activePanel.panel = f.panel;
    }}
  >
    <div class="bg-muted/60 flex h-8 shrink-0 cursor-grab items-center gap-2 border-b px-2 text-sm select-none" role="presentation" onpointerdown={(e) => pressPanel(e, f.panel)}>
      <span class="min-w-0 flex-1 truncate font-semibold">{label(f.panel)}</span>
      <button class="text-muted-foreground hover:text-foreground px-1" title="Dock it back (as a tab)" onpointerdown={(e) => e.stopPropagation()} onclick={() => dockBack(f.panel)}>⇲</button>
      <button class="text-muted-foreground hover:text-foreground px-1" title="Hide (View → Panels brings it back)" onpointerdown={(e) => e.stopPropagation()} onclick={() => hidePanel(f.panel)}>–</button>
    </div>
    <div class="relative min-h-0 flex-1 overflow-auto">
      <PanelView panel={f.panel} />
    </div>
    <!-- Resize: right edge, bottom edge, corner. -->
    <div class="absolute top-8 right-0 bottom-3 w-1.5 cursor-ew-resize" role="presentation" onpointerdown={(e) => onResizeDown(e, f.panel, { w: true, h: false })}></div>
    <div class="absolute right-3 bottom-0 left-0 h-1.5 cursor-ns-resize" role="presentation" onpointerdown={(e) => onResizeDown(e, f.panel, { w: false, h: true })}></div>
    <div class="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize" role="presentation" onpointerdown={(e) => onResizeDown(e, f.panel, { w: true, h: true })}>
      <svg viewBox="0 0 10 10" class="text-muted-foreground h-3 w-3"><path d="M9 3 L3 9 M9 6 L6 9" stroke="currentColor" fill="none" /></svg>
    </div>
  </div>
{/each}

<!-- A tab being dragged: a ghost of it under the pointer. -->
{#if panelDrag.active && !panelDrag.floating && panelDrag.panel}
  <div
    class="bg-background/80 pointer-events-none fixed z-[45] flex h-24 w-48 items-start rounded-lg border-2 border-dashed border-sky-500 p-2 text-sm font-semibold shadow-xl"
    style="left: {panelDrag.x + 18}px; top: {panelDrag.y + 18}px"
  >
    {PANEL_NAMES[panelDrag.panel]}
    <span class="text-muted-foreground ml-auto text-[10px] font-normal">{panelDrag.over ? 'dock here' : 'let go to float'}</span>
  </div>
{/if}
