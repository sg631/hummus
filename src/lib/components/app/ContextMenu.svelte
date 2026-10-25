<!--
  The right-click menu (state/context-menu.svelte.ts says what's in it). Opens where you
  clicked, kept on screen; closes on a choice, a click elsewhere, Esc, scrolling or resizing.
  The browser's own menu is switched off everywhere except in text fields.
-->
<script lang="ts">
  import { closeMenu, menu } from '$lib/state/context-menu.svelte';

  let el = $state<HTMLDivElement>();
  // Kept on screen: flipped left / up if it would run off the edge.
  let pos = $state({ x: 0, y: 0 });
  $effect(() => {
    if (!menu.open || !el) return;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.min(menu.x, window.innerWidth - r.width - 4),
      y: menu.y + r.height > window.innerHeight - 4 ? Math.max(4, menu.y - r.height) : menu.y
    };
  });

  function choose(action?: () => void) {
    closeMenu();
    action?.();
  }

  function onWindowContext(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable]')) return; // keep copy/paste there
    e.preventDefault(); // things with a menu open theirs; elsewhere, nothing
    if (!target.closest('[data-context-menu]')) closeMenu();
  }
</script>

<svelte:window
  oncontextmenu={onWindowContext}
  onpointerdown={(e) => menu.open && !el?.contains(e.target as Node) && closeMenu()}
  onkeydown={(e) => menu.open && e.key === 'Escape' && closeMenu()}
  onresize={closeMenu}
  onwheel={() => menu.open && closeMenu()}
/>

{#if menu.open}
  <div
    bind:this={el}
    data-context-menu
    role="menu"
    class="bg-popover text-popover-foreground fixed z-[10000] min-w-44 rounded-md border p-1 text-sm shadow-lg"
    style="left: {pos.x || menu.x}px; top: {pos.y || menu.y}px"
  >
    {#each menu.items as item, i (i)}
      {#if item.separator}
        <div class="bg-border my-1 h-px"></div>
      {:else}
        <button
          role="menuitem"
          class="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-left disabled:pointer-events-none disabled:opacity-40 {item.danger ? 'text-destructive' : ''}"
          disabled={item.disabled}
          onclick={() => choose(item.action)}
        >
          <span class="w-3 text-xs">{item.checked ? '✓' : ''}</span>
          <span class="flex-1">{item.label}</span>
          {#if item.shortcut}<span class="text-muted-foreground font-mono text-xs">{item.shortcut}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}
