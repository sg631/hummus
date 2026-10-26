<!--
  One automation lane in the playlist: a setting's line over the song.
  A new lane is empty: Ctrl+drag a knob (fader, tempo, time signature) onto it, or
  right-click a knob → "Automate in …", to say what it changes. Dropping another knob on a
  lane switches it to that setting. While a knob is being dragged, lanes light up.
  - click empty space: a point there (then drag it); drag a point: move it (Shift: only up
    and down; Alt: don't snap)
  - right-click a point: delete it; double-click a point: type its value
  - each segment's shape (right-click between two points): line, curve, S-curve, hold, or a
    wave (sine, triangle, square, saw) between the two values. The small ring in the middle
    of a segment: drag it up / down to bend a curve (or, on a wave, for more / fewer cycles);
    double-click it for a straight line again
  - right-click the lane: flatten, turn off, delete…
  - the switch turns the lane off (the knob's own value is used); ✕ deletes it
  Between points the value moves in a straight line; before the first and after the last
  it stays level.
-->
<script lang="ts">
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { addPoint, fromUnit, shapeAt, targetInfo, toUnit, valueAt } from '$lib/music/automation';
  import type { AutomationLane, AutomationPoint } from '$lib/music/types';
  import { contextMenu, openMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import { playhead } from '$lib/state/playhead.svelte';
  import { project, removeAutomation } from '$lib/state/project.svelte';
  import { view } from '$lib/state/view.svelte';
  import { knobDrag } from '$lib/state/automation.svelte';

  let {
    lane,
    width,
    headWidth,
    height = 60,
    bars,
    x,
    ticksAt,
    snap
  }: {
    lane: AutomationLane;
    width: number;
    headWidth: number;
    height?: number;
    bars: number[]; // where bar lines go (ticks)
    x: (ticks: number) => number;
    ticksAt: (px: number) => number;
    snap: (ticks: number, e: { altKey: boolean }) => number;
  } = $props();

  const PAD = 6;
  const info = $derived(targetInfo(project, lane.target));

  const y = (v: number) => (info ? PAD + (1 - toUnit(info, v)) * (height - 2 * PAD) : height / 2);
  const valueAtY = (py: number) => (info ? fromUnit(info, 1 - (py - PAD) / (height - 2 * PAD)) : 0);

  // The line and the shaded area under it: each segment drawn along its shape.
  const line = $derived.by(() => {
    const pts = lane.points;
    if (!pts.length) return '';
    const coords = [`0,${y(pts[0].value)}`, `${x(pts[0].tick)},${y(pts[0].value)}`];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (info?.stepped || a.shape === 'hold') {
        coords.push(`${x(b.tick)},${y(a.value)}`, `${x(b.tick)},${y(b.value)}`);
        continue;
      }
      const n = a.shape === 'wave' ? Math.min(800, Math.max(24, Math.round((a.cycles ?? 4) * 24))) : !a.shape || a.shape === 'linear' ? 1 : 32;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        coords.push(`${x(a.tick + (b.tick - a.tick) * t).toFixed(1)},${y(a.value + (b.value - a.value) * shapeAt(a, t)).toFixed(1)}`);
      }
    }
    coords.push(`${width},${y(pts[pts.length - 1].value)}`);
    return coords.join(' ');
  });

  // Each segment's middle: the ring that bends it.
  const middles = $derived(
    info?.stepped
      ? []
      : lane.points.slice(0, -1).map((a, i) => {
          const b = lane.points[i + 1];
          const t = a.shape === 'wave' ? 0.25 / Math.max(0.5, a.cycles ?? 4) : 0.5; // a wave's first peak
          return { a, b, x: x(a.tick + (b.tick - a.tick) * t), y: y(a.value + (b.value - a.value) * shapeAt(a, t)) };
        })
  );

  // Dragging a segment's ring: bends a curve, or changes a wave's cycles.
  function onMiddleDown(e: PointerEvent, a: AutomationPoint, b: AutomationPoint) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const y0 = e.clientY;
    const tension0 = a.tension ?? 0;
    const cycles0 = a.cycles ?? 4;
    if (a.shape !== 'wave' && a.shape !== 'hold') a.shape = 'curve';
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (a.shape === 'wave') a.cycles = Math.max(1, Math.min(64, Math.round(cycles0 - dy / 8)));
      else a.tension = Math.max(-1, Math.min(1, tension0 + (dy / 50) * (b.value >= a.value ? 1 : -1)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }

  function setShape(a: AutomationPoint, shape: NonNullable<AutomationPoint['shape']>, extra: Partial<AutomationPoint> = {}) {
    Object.assign(a, { shape, ...extra });
    if (shape === 'wave') a.cycles ??= 4;
  }
  const area = $derived(line ? `0,${height} ${line} ${width},${height}` : '');

  let dragging = $state<AutomationPoint | null>(null);

  function drag(point: AutomationPoint, e: PointerEvent, svg: SVGSVGElement) {
    const r = svg.getBoundingClientRect();
    const tick0 = point.tick;
    dragging = point;
    const move = (ev: PointerEvent) => {
      if (!ev.shiftKey) point.tick = Math.max(0, snap(ticksAt(ev.clientX - r.left), ev));
      else point.tick = tick0;
      point.value = valueAtY(ev.clientY - r.top);
      lane.points.sort((a, b) => a.tick - b.tick);
    };
    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener(
      'pointerup',
      () => {
        window.removeEventListener('pointermove', move);
        // Two points dragged onto the same tick: keep the one moved.
        lane.points = addPoint(lane.points.filter((p) => p !== point), { ...$state.snapshot(point) });
        dragging = null;
      },
      { once: true }
    );
  }

  function onBackgroundDown(e: PointerEvent) {
    if (e.button !== 0 || !info) return;
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const tick = Math.max(0, snap(ticksAt(e.clientX - r.left), e));
    lane.points = addPoint(lane.points, { tick, value: valueAtY(e.clientY - r.top) });
    const point = lane.points.find((p) => p.tick === tick)!;
    drag(point, e, svg);
  }

  function onPointDown(e: PointerEvent, point: AutomationPoint) {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag(point, e, (e.currentTarget as SVGElement).ownerSVGElement!);
  }

  function typeValue(point: AutomationPoint) {
    if (!info) return;
    const typed = window.prompt(`${info.label} (${info.min} to ${info.max})`, String(point.value));
    if (typed === null || typed.trim() === '' || Number.isNaN(Number(typed))) return;
    point.value = Math.max(info.min, Math.min(info.max, Number(typed)));
  }

  function laneMenu(e: MouseEvent) {
    if (!info) return;
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const tick = Math.max(0, snap(ticksAt(e.clientX - r.left), e));
    // The segment under the pointer: its shape.
    const exact = ticksAt(e.clientX - r.left);
    const i = lane.points.findIndex((p, k) => p.tick <= exact && (lane.points[k + 1]?.tick ?? -1) > exact);
    const a = i >= 0 ? lane.points[i] : undefined;
    const shapeItems: MenuItem[] =
      a && !info.stepped
        ? [
            { label: 'This segment:', disabled: true },
            { label: '   Line', checked: !a.shape || a.shape === 'linear', action: () => setShape(a, 'linear') },
            { label: '   Curve (drag its ring to bend)', checked: a.shape === 'curve', action: () => setShape(a, 'curve', { tension: a.tension || 0.5 }) },
            { label: '   S-curve', checked: a.shape === 'smooth', action: () => setShape(a, 'smooth') },
            { label: '   Hold, then jump', checked: a.shape === 'hold', action: () => setShape(a, 'hold') },
            ...(['sine', 'triangle', 'square', 'saw'] as const).map((w) => ({
              label: `   Wave: ${w}`,
              checked: a.shape === 'wave' && (a.wave ?? 'sine') === w,
              action: () => setShape(a, 'wave', { wave: w })
            })),
            ...(a.shape === 'wave'
              ? [1, 2, 4, 8, 16, 32].map((c) => ({ label: `      ${c} cycle${c > 1 ? 's' : ''}`, checked: (a.cycles ?? 4) === c, action: () => (a.cycles = c) }))
              : []),
            { separator: true }
          ]
        : [];
    openMenu(e, [
      ...shapeItems,
      { label: 'Add a point here', action: () => (lane.points = addPoint(lane.points, { tick, value: valueAt(lane.points, tick) ?? info.value })) },
      { label: `Flatten to the knob's value (${info.format(info.value)})`, action: () => (lane.points = [{ tick: 0, value: info.value }]) },
      { label: `Flatten to the default (${info.format(info.default)})`, action: () => (lane.points = [{ tick: 0, value: info.default }]) },
      { separator: true },
      { label: 'Lane on', checked: lane.enabled, action: () => (lane.enabled = !lane.enabled) },
      { label: 'Delete lane', danger: true, action: () => removeAutomation(lane.id) }
    ]);
  }

  // Just made from a knob's menu: scroll to it and flash.
  let row = $state<HTMLDivElement>();
  let flash = $state(false);
  $effect(() => {
    if (view.focusLane !== lane.id || !row) return;
    row.scrollIntoView({ block: 'nearest' });
    view.focusLane = null;
    flash = true;
    setTimeout(() => (flash = false), 900);
  });

  const now = $derived(playhead.running && !playhead.pattern ? valueAt(lane.points, Math.max(0, playhead.ticks), info?.stepped) : undefined);
  const dropping = $derived(knobDrag.active && knobDrag.overLane === lane.id);

  function rename() {
    const name = window.prompt('Lane name', lane.name ?? '')?.trim();
    if (name) lane.name = name;
  }
</script>

<div
  bind:this={row}
  data-automation-lane={lane.id}
  class="flex border-b transition-colors {dropping ? 'bg-amber-500/25 outline-2 outline-amber-500' : flash ? 'bg-amber-500/20' : knobDrag.active ? 'bg-amber-500/5' : ''}"
  style="width: {headWidth + width}px"
>
  {#if !info}
    <!-- Empty: waiting for a knob. -->
    <div
      class="bg-background sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r px-2 text-left"
      style="width: {headWidth}px; height: {height}px"
      use:contextMenu={() => [
        { label: 'Rename…', action: rename },
        { label: 'Delete lane', danger: true, action: () => removeAutomation(lane.id) }
      ]}
    >
      <div class="flex items-center gap-1">
        <button class="min-w-0 flex-1 truncate text-left text-xs font-medium" ondblclick={rename} title="Double-click to rename">{lane.name ?? 'Automation'}</button>
        <button class="text-muted-foreground hover:text-foreground px-0.5 text-xs" onclick={() => removeAutomation(lane.id)} aria-label="Delete lane">✕</button>
      </div>
      <span class="text-muted-foreground truncate text-[10px]">empty</span>
    </div>
    <div class="text-muted-foreground flex shrink-0 items-center border-2 border-dashed px-4 text-xs {dropping ? 'border-amber-500 text-amber-700' : 'border-border'}" style="width: {width}px; height: {height}px">
      {dropping ? 'Let go to automate it here' : `Ctrl+drag a knob here (or right-click a knob → Automate in “${lane.name ?? 'Automation'}”)`}
    </div>
  {:else}
    <div
      class="bg-background sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r px-2 text-left"
      style="width: {headWidth}px; height: {height}px"
      use:contextMenu={() => [
        { label: 'Lane on', checked: lane.enabled, action: () => (lane.enabled = !lane.enabled) },
        { label: 'Empty it (pick another knob)', action: () => ((lane.target = undefined), (lane.points = [])) },
        { label: 'Delete lane', danger: true, action: () => removeAutomation(lane.id) }
      ]}
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs font-medium" title="{info.owner}: {info.label}">{info.label}</span>
        <Switch size="sm" bind:checked={lane.enabled} aria-label="Lane on" />
        <button class="text-muted-foreground hover:text-foreground px-0.5 text-xs" onclick={() => removeAutomation(lane.id)} aria-label="Delete lane">✕</button>
      </div>
      <span class="text-muted-foreground truncate text-[10px]">{info.owner}{now !== undefined ? ` · ${info.format(now)}` : ''}</span>
    </div>
    <svg
      {width}
      {height}
      class="block shrink-0 cursor-crosshair select-none {lane.enabled ? '' : 'opacity-40'}"
      role="presentation"
      onpointerdown={onBackgroundDown}
      oncontextmenu={laneMenu}
    >
      {#each bars as b (b)}
        <line x1={x(b)} x2={x(b)} y1="0" y2={height} class="stroke-border" />
      {/each}
      <line x1="0" x2={width} y1={y(info.default)} y2={y(info.default)} class="stroke-foreground/15" stroke-dasharray="3 3" />
      {#if area}
        <polygon points={area} class="pointer-events-none fill-amber-500/15" />
        <polyline points={line} class="pointer-events-none fill-none stroke-amber-500" stroke-width="2" />
      {/if}
      {#each middles as m, i (i)}
        <circle
          cx={m.x}
          cy={m.y}
          r="4"
          class="fill-background cursor-ns-resize stroke-amber-600 hover:fill-amber-200"
          stroke-width="1.5"
          role="button"
          tabindex="-1"
          aria-label="Bend segment {i + 1}"
          onpointerdown={(e) => onMiddleDown(e, m.a, m.b)}
          ondblclick={() => setShape(m.a, 'linear', { tension: 0 })}
        >
          <title>{m.a.shape === 'wave' ? 'Drag up / down: more / fewer cycles' : 'Drag up / down to bend · double-click: straight'}</title>
        </circle>
      {/each}
      {#each lane.points as p, i (i)}
        <circle
          cx={x(p.tick)}
          cy={y(p.value)}
          r="5"
          class="cursor-grab fill-amber-400 stroke-amber-700 hover:fill-amber-200"
          role="button"
          tabindex="-1"
          aria-label="Point {i + 1}: {info.format(p.value)}"
          onpointerdown={(e) => onPointDown(e, p)}
          ondblclick={() => typeValue(p)}
          oncontextmenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            lane.points = lane.points.filter((q) => q !== p);
          }}
        >
          <title>{info.format(p.value)} · right-click to delete</title>
        </circle>
        {#if dragging === p}
          <text x={x(p.tick) + 8} y={Math.max(12, y(p.value) - 6)} class="fill-foreground pointer-events-none text-[10px] font-medium">{info.format(p.value)}</text>
        {/if}
      {/each}
      {#if playhead.running && playhead.ticks >= 0 && !playhead.pattern}
        <line x1={x(playhead.ticks)} x2={x(playhead.ticks)} y1="0" y2={height} class="pointer-events-none stroke-red-500" stroke-width="2" />
      {/if}
    </svg>
  {/if}
</div>
