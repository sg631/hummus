<!--
  The "Add effect" window: a search bar and every effect, grouped by category. Clicking
  one (or Enter, for the first match) calls `onpick` with its type; the parent adds it.

  Svelte reminders:
  - bind:value={query} keeps the search box and `query` in sync, so `results` (a
    $derived) re-filters as you type.
  - {#each groups as group (group.category)} … {/each} nests fine: a list of lists.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { EFFECT_CATEGORIES, searchEffects, type EffectType } from '$lib/music/effects';

  let { open = $bindable(false), onpick }: { open?: boolean; onpick: (type: EffectType) => void } = $props();

  let query = $state('');
  const results = $derived(searchEffects(query));
  // The results by category, in the categories' order, leaving out empty ones.
  const groups = $derived(
    EFFECT_CATEGORIES.map((category) => ({ category, effects: results.filter((e) => e.category === category) })).filter(
      (g) => g.effects.length > 0
    )
  );

  // Closes first: the parent then opens the effect's own window (two windows changing
  // at once confuses the dialog library and leaves this one stuck open).
  function pick(type: string) {
    open = false;
    query = '';
    onpick(type as EffectType);
  }

  // Enter picks the first match. After the key event, not during it: closing the window
  // while its own keydown is still being handled left it stuck open.
  function onSearchKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !results.length) return;
    e.preventDefault();
    const type = results[0].type;
    setTimeout(() => pick(type), 0);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[80vh] flex-col sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add effect</Dialog.Title>
      <Dialog.Description>Search, then click an effect to add it to the track.</Dialog.Description>
    </Dialog.Header>

    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="search"
      placeholder="Search effects: reverb, echo, lo-fi, wide…"
      bind:value={query}
      onkeydown={onSearchKey}
      autofocus
      class="bg-background rounded-md border px-3 py-2 text-sm"
    />

    <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
      {#each groups as group (group.category)}
        <h3 class="text-muted-foreground mt-3 mb-1 text-xs font-semibold tracking-wide uppercase">{group.category}</h3>
        {#each group.effects as effect (effect.type)}
          <button class="hover:bg-muted flex w-full flex-col rounded-md px-2 py-1.5 text-left" onclick={() => pick(effect.type)}>
            <span class="text-sm font-medium">{effect.name}</span>
            <span class="text-muted-foreground text-xs">{effect.description}</span>
          </button>
        {/each}
      {:else}
        <p class="text-muted-foreground py-6 text-center text-sm">No effect matches "{query}".</p>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
