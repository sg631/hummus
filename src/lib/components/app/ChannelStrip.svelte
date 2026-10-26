<!--
  One channel in the mixer: a track, a drum row, or the master.
  Top to bottom: its name, its effects (in order), pan, the fader with its meter, the dB
  value, mute and solo. Right-click anywhere for more (automate volume or pan…).
  An amber "A" means a lane automates it: while the song plays the fader / knob follows
  the lane; click the A to see it in the playlist.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { formatDb, formatPan } from '$lib/music/automation';
  import type { Effect } from '$lib/music/types';
  import { automate, shown } from '$lib/state/automation.svelte';
  import { contextMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import { sidechainMenu } from '$lib/state/sidechain';
  import { automatable } from '$lib/state/automation.svelte';
  import { addBus, addReverbBus, automationFor, project, setSend } from '$lib/state/project.svelte';
  import Dropdown from './Dropdown.svelte';
  import type { Send } from '$lib/music/types';
  import { view } from '$lib/state/view.svelte';
  import EffectList from './EffectList.svelte';
  import Fader from './Fader.svelte';

  // What a strip changes. Tracks and drum rows are passed as they are (stored in the
  // project, so changes show and are heard); the master is a stand-in with getters/setters.
  interface StripOwner {
    id: string;
    name: string;
    volume: number;
    pan?: number;
    mute?: boolean;
    solo?: boolean;
    effects: Effect[];
    output?: string; // tracks: the bus they play into
    sends?: Send[];  // tracks: their sends into buses
  }

  let {
    owner,
    kind,
    color = 'bg-slate-500',
    level = -Infinity,
    selected = false,
    onselect,
    menu,
    routable = false,
    children
  }: {
    owner: StripOwner;
    kind: string; // under the name: 'melody', 'kick'…
    color?: string; // the stripe on top
    level?: number;
    selected?: boolean;
    onselect?: () => void;
    menu?: () => MenuItem[]; // more right-click items
    routable?: boolean; // a track: where it plays into, and its sends into buses
    children?: Snippet; // more buttons under mute / solo
  } = $props();

  const volumeLane = $derived(automationFor(owner.id, 'volume'));
  const panLane = $derived(automationFor(owner.id, 'pan'));
  const showLane = (id: string) => {
    view.focusLane = id;
    view.main = 'playlist';
  };

  const volumeTarget = $derived({ kind: 'mix' as const, ownerId: owner.id, param: 'volume' as const });
  const panTarget = $derived({ kind: 'mix' as const, ownerId: owner.id, param: 'pan' as const });

  function stripMenu(): MenuItem[] {
    return [
      { label: volumeLane ? 'Show volume automation' : 'Automate volume in a new lane', action: () => automate(volumeTarget) },
      ...(owner.pan !== undefined ? [{ label: panLane ? 'Show pan automation' : 'Automate pan in a new lane', action: () => automate(panTarget) }] : []),
      { separator: true },
      { label: 'Reset volume and pan', action: () => Object.assign(owner, { volume: 0, ...(owner.pan !== undefined ? { pan: 0 } : {}) }) },
      ...(owner.mute !== undefined ? [{ label: 'Mute', checked: owner.mute, action: () => (owner.mute = !owner.mute) }] : []),
      ...(owner.solo !== undefined ? [{ label: 'Solo', checked: !!owner.solo, action: () => (owner.solo = !owner.solo) }] : []),
      ...(routable
        ? [
            { separator: true },
            { label: 'Send to a new reverb bus', action: () => addReverbBus(owner.id) },
            { label: 'Route into a new group bus', action: () => (owner.output = addBus('Group').id) }
          ]
        : []),
      ...(owner.id !== 'master' ? [{ separator: true }, ...sidechainMenu(owner.id)] : []),
      ...(menu ? [{ separator: true }, ...menu()] : [])
    ];
  }
</script>

<div
  class="bg-background flex w-36 shrink-0 flex-col items-center gap-2 rounded-md border p-2 {selected ? 'ring-primary ring-2' : ''}"
  role="group"
  aria-label={owner.name}
  use:contextMenu={stripMenu}
>
  <button class="w-full min-w-0 text-left" onclick={onselect}>
    <div class="mb-1 h-1 w-full rounded {color}"></div>
    <div class="truncate text-sm font-medium" title={owner.name}>{owner.name}</div>
    <div class="text-muted-foreground truncate text-[10px]">{kind}</div>
  </button>

  <div class="h-28 w-full overflow-y-auto">
    <EffectList ownerId={owner.id} effects={owner.effects} />
  </div>

  {#if routable}
    <!-- Where it plays into (the master, or a bus: a group), and how much goes to each bus. -->
    <div class="flex w-full flex-col gap-1 text-[10px]">
      <label class="flex items-center gap-1">
        <span class="text-muted-foreground shrink-0">Out</span>
        <Dropdown
          value={owner.output ?? ''}
          onchange={(v: string) => (owner.output = v || undefined)}
          ariaLabel="Output"
          options={[{ value: '', label: 'Master' }, ...project.buses.map((b) => ({ value: b.id, label: b.name }))]}
          class="h-6 min-w-0 flex-1 text-[10px]"
        />
      </label>
      {#if project.buses.length}
        <div class="flex flex-wrap justify-center gap-1">
          {#each project.buses.filter((b) => b.id !== owner.output) as bus (bus.id)}
            <Knob
              label="→ {bus.name}"
              size={22}
              bind:value={() => owner.sends?.find((s) => s.busId === bus.id)?.level ?? -60, (v) => setSend(owner.id, bus.id, v <= -60 ? null : v)}
              min={-60}
              max={6}
              step={0.5}
              defaultValue={-60}
              format={(v) => (v <= -60 ? 'off' : `${Math.round(v)} dB`)}
              automate={{ kind: 'send', ownerId: owner.id, param: bus.id }}
            />
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if owner.pan !== undefined}
    <div class="relative">
      <Knob
        label="Pan"
        size={32}
        bind:value={() => shown(panLane, owner.pan ?? 0), (v) => (owner.pan = v)}
        min={-1}
        max={1}
        step={0.01}
        defaultValue={0}
        format={formatPan}
        color={panLane?.enabled ? 'rgb(245 158 11)' : undefined}
        automate={panTarget}
      />
      {#if panLane}
        <button class="absolute -top-1 -right-4 rounded bg-amber-500 px-1 text-[9px] font-bold text-white" title="Automated: show the lane" onclick={() => showLane(panLane.id)}>A</button>
      {/if}
    </div>
  {:else}
    <div class="h-[74px]"></div>
  {/if}

  <div class="relative">
    <Fader
      bind:value={() => shown(volumeLane, owner.volume), (v) => (owner.volume = v)}
      {level}
      automated={!!volumeLane?.enabled}
      label="{owner.name} volume"
      automate={volumeTarget}
    />
    {#if volumeLane}
      <button class="absolute -top-1 -right-4 rounded bg-amber-500 px-1 text-[9px] font-bold text-white" title="Automated: show the lane" onclick={() => showLane(volumeLane.id)}>A</button>
    {/if}
  </div>
  <span class="font-mono text-xs">{formatDb(shown(volumeLane, owner.volume))}</span>

  <div class="flex gap-1">
    {#if owner.mute !== undefined}
      <button
        class="h-6 w-7 rounded text-xs font-bold {owner.mute ? 'bg-amber-500 text-white' : 'text-muted-foreground border'}"
        onclick={() => (owner.mute = !owner.mute)}
        aria-pressed={owner.mute}
        title="Mute (Ctrl+drag onto an automation lane to automate)"
        use:automatable={{ kind: 'mix', ownerId: owner.id, param: 'mute' }}>M</button
      >
    {/if}
    {#if owner.solo !== undefined}
      <button
        class="h-6 w-7 rounded text-xs font-bold {owner.solo ? 'bg-sky-500 text-white' : 'text-muted-foreground border'}"
        onclick={() => (owner.solo = !owner.solo)}
        aria-pressed={!!owner.solo}
        title="Solo: only soloed tracks play (Ctrl+drag onto an automation lane to automate)"
        use:automatable={{ kind: 'mix', ownerId: owner.id, param: 'solo' }}>S</button
      >
    {/if}
    {@render children?.()}
  </div>
</div>
