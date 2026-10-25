<!--
  A dropdown (shadcn-svelte's Select) from a list of options, for the whole app: one
  component instead of the browser's own <select>, so they all look and behave alike.

    <Dropdown bind:value={track.instrument} options={[{ value: 'piano', label: 'Piano', group: 'Synths' }, …]} />

  Options with a `group` are shown under group headings. `onchange` runs after a choice
  (bind:value works too).
-->
<script module lang="ts">
  export interface DropdownOption<V> {
    value: V;
    label: string;
    group?: string;
    disabled?: boolean;
  }
</script>

<script lang="ts" generics="T extends string | number">
  import * as Select from '$lib/components/ui/select/index.js';
  import { cn } from '$lib/utils.js';

  let {
    value = $bindable(),
    options,
    placeholder = 'Choose…',
    size = 'sm',
    disabled = false,
    title,
    ariaLabel,
    class: className,
    onchange
  }: {
    value: T;
    options: DropdownOption<T>[];
    placeholder?: string;
    size?: 'sm' | 'default';
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    class?: string;
    onchange?: (value: T) => void;
  } = $props();

  const selected = $derived(options.find((o) => o.value === value));
  // Groups in the order they first appear; options without one come first.
  const groups = $derived([...new Set(options.map((o) => o.group ?? ''))]);

  function choose(v: string) {
    const option = options.find((o) => String(o.value) === v);
    if (!option) return;
    value = option.value;
    onchange?.(option.value);
  }
</script>

<Select.Root type="single" value={String(value ?? '')} onValueChange={choose} {disabled}>
  <Select.Trigger {size} {title} aria-label={ariaLabel} class={cn(size === 'sm' && 'h-7 py-0 text-xs', className)}>
    <span class="min-w-0 truncate {selected ? '' : 'text-muted-foreground'}">{selected?.label ?? placeholder}</span>
  </Select.Trigger>
  <Select.Content class="max-h-80">
    {#each groups as group (group)}
      {#if group}
        <Select.Group>
          <Select.GroupHeading>{group}</Select.GroupHeading>
          {#each options.filter((o) => o.group === group) as o (o.value)}
            <Select.Item value={String(o.value)} label={o.label} disabled={o.disabled} />
          {/each}
        </Select.Group>
      {:else}
        {#each options.filter((o) => !o.group) as o (o.value)}
          <Select.Item value={String(o.value)} label={o.label} disabled={o.disabled} />
        {/each}
      {/if}
    {/each}
  </Select.Content>
</Select.Root>
