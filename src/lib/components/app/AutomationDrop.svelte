<!--
  While a knob's setting is being dragged (Ctrl+drag, state/automation.svelte.ts):
  - a chip under the pointer: what's being dragged, and where it would go
  - if the playlist isn't on screen, a preview of its automation lanes slides up from the
    bottom to drop on (above any open window). Let go anywhere else to cancel.
-->
<script lang="ts">
  import { songLength } from '$lib/music/arrange';
  import { barTicks } from '$lib/music/time';
  import { targetInfo, toUnit, valueAt } from '$lib/music/automation';
  import type { AutomationLane } from '$lib/music/types';
  import { knobDrag, laneName } from '$lib/state/automation.svelte';
  import { project } from '$lib/state/project.svelte';

  const W = 360;
  const H = 28;
  const span = $derived(Math.max(songLength(project), 8 * barTicks(project.timeSignature), ...project.automation.flatMap((l) => l.points.map((p) => p.tick + 1))));

  // A lane's line, small.
  function mini(lane: AutomationLane): string {
    const info = targetInfo(project, lane.target);
    if (!info || !lane.points.length) return '';
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * span;
      const v = valueAt(lane.points, t, info.stepped) ?? info.value;
      pts.push(`${((i / 60) * W).toFixed(1)},${(2 + (1 - toUnit(info, v)) * (H - 4)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  const over = $derived(project.automation.find((l) => l.id === knobDrag.overLane));
</script>

{#if knobDrag.active}
  <!-- The chip under the pointer. -->
  <div
    class="pointer-events-none fixed z-[110] rounded-md px-2 py-1 text-xs font-medium shadow-lg {over ? 'bg-amber-500 text-white' : 'bg-foreground text-background'}"
    style="left: {knobDrag.x + 14}px; top: {knobDrag.y + 14}px"
  >
    {knobDrag.label}{over ? ` → ${laneName(over)}` : ''}
  </div>

  {#if knobDrag.preview}
    <!-- The playlist's lanes, to drop on. -->
    <div class="bg-background/95 fixed inset-x-0 bottom-0 z-[100] border-t shadow-2xl backdrop-blur" role="region" aria-label="Automation lanes">
      <div class="mx-auto flex max-w-3xl flex-col gap-1.5 px-4 py-3">
        <div class="flex items-baseline gap-2 text-sm">
          <span class="font-semibold">Drop on an automation lane</span>
          <span class="text-muted-foreground text-xs">Playlist preview · let go anywhere else to cancel · Esc</span>
        </div>
        {#each project.automation as lane (lane.id)}
          {@const info = targetInfo(project, lane.target)}
          <div
            data-automation-lane={lane.id}
            class="flex items-center gap-3 rounded-md border px-2 py-1 transition {knobDrag.overLane === lane.id ? 'border-amber-500 bg-amber-500/15' : info ? '' : 'border-dashed'}"
          >
            <div class="w-48 min-w-0">
              <div class="truncate text-sm font-medium">{laneName(lane)}</div>
              <div class="text-muted-foreground truncate text-[10px]">{info ? 'drop here to change it to this setting' : 'empty: drop here'}</div>
            </div>
            <svg width={W} height={H} class="bg-muted/40 rounded">
              {#if mini(lane)}<polyline points={mini(lane)} class="fill-none stroke-amber-500" stroke-width="1.5" />{/if}
            </svg>
          </div>
        {:else}
          <p class="text-muted-foreground py-2 text-sm">No automation lanes yet: make one in the playlist with <b>+ Lane</b>, then drag the knob onto it. (Right-click a knob → "Automate in a new lane" does both.)</p>
        {/each}
      </div>
    </div>
  {/if}
{/if}
