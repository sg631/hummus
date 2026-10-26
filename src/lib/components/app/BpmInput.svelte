<!--
  The tempo: type a number (Enter), scroll the mouse wheel over it (Shift: by 5), or use the
  arrow keys. Hovering shows Tap tempo: click Tap (or press T while hovering) in time with
  the music and the tempo follows your taps; ×2 / ÷2 fix a tempo read at half or double.
  The tap panel is fixed on the screen, so the top bar (which scrolls sideways) can't
  clip it. Ctrl+drag it onto an automation lane (or right-click) to change the tempo over
  the song; while the song plays it shows the lane's tempo.
-->
<script lang="ts">
  import { automationFor, project } from '$lib/state/project.svelte';
  import { automationMenu, shown, startKnobDrag } from '$lib/state/automation.svelte';
  import { contextMenu } from '$lib/state/context-menu.svelte';
  import { TEMPO } from '$lib/music/automation';

  let { disabled = false }: { disabled?: boolean } = $props();

  const MIN = 40;
  const MAX = 240;
  const clamp = (v: number) => Math.round(Math.max(MIN, Math.min(MAX, v)));

  let text = $state(String(project.bpm));
  let editing = $state(false);
  const live = $derived(Math.round(shown(automationFor('song', 'bpm'), project.bpm)));
  $effect(() => {
    if (!editing) text = String(live); // changed elsewhere (Settings, undo, a project, its lane)
  });

  function commit() {
    const v = Number(text);
    if (text.trim() !== '' && !Number.isNaN(v)) project.bpm = clamp(v);
    text = String(project.bpm);
    editing = false;
  }

  let field = $state<HTMLDivElement>();
  function onWheel(e: WheelEvent) {
    if (disabled) return;
    e.preventDefault();
    project.bpm = clamp(project.bpm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1));
  }
  $effect(() => {
    // Non-passive, so the page doesn't scroll while changing the tempo.
    const el = field;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---------- Tap tempo ----------
  let open = $state(false);
  let at = $state({ left: 0, top: 0 });
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let taps: number[] = [];
  let tapped = $state(0); // taps so far in this run

  function show() {
    if (disabled || !field) return;
    clearTimeout(closeTimer);
    const r = field.getBoundingClientRect();
    at = { left: r.left, top: r.bottom + 4 };
    open = true;
  }
  function hide() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (open = false), 200);
  }

  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; // a pause: start again
    taps = [...taps, now].slice(-6);
    tapped = taps.length;
    if (taps.length < 2) return;
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    project.bpm = clamp(60000 / avg);
  }

  function onKey(e: KeyboardEvent) {
    if (open && !editing && (e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      tap();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  bind:this={field}
  class="relative flex h-10 w-full min-w-24 items-center rounded-md border {disabled ? 'pointer-events-none opacity-50' : ''}"
  title="Tempo: type it, or scroll over it (Shift: by 5). Hover for tap tempo"
  role="group"
  aria-label="Tempo"
  onmouseenter={show}
  onmouseleave={hide}
  onpointerdowncapture={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.button === 0) {
      open = false;
      startKnobDrag(e, TEMPO, e.currentTarget);
    }
  }}
  use:contextMenu={() => automationMenu(TEMPO)}
>
  <input
    class="h-full w-full min-w-0 bg-transparent pr-10 pl-2 text-right font-mono text-lg tabular-nums outline-none"
    inputmode="numeric"
    size={3}
    aria-label="Tempo in BPM"
    bind:value={text}
    {disabled}
    onfocus={() => (editing = true)}
    onblur={commit}
    onkeydown={(e) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      else if (e.key === 'Escape') {
        text = String(project.bpm);
        e.currentTarget.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        project.bpm = clamp(project.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1));
        text = String(project.bpm);
      }
    }}
  />
  <span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px]">BPM</span>
</div>

{#if open}
  <div
    class="bg-popover text-popover-foreground fixed z-[60] flex w-56 flex-col gap-2 rounded-md border p-2 shadow-lg"
    style="left: {at.left}px; top: {at.top}px"
    role="dialog"
    aria-label="Tap tempo"
    tabindex="-1"
    onmouseenter={show}
    onmouseleave={hide}
  >
    <button
      class="bg-primary text-primary-foreground h-14 rounded-md text-sm font-semibold active:scale-[0.98]"
      onpointerdown={(e) => {
        e.preventDefault();
        tap();
      }}>Tap{tapped > 1 ? ` · ${project.bpm} BPM` : tapped === 1 ? ' · again…' : ''}</button
    >
    <div class="flex items-center gap-1 text-xs">
      <span class="text-muted-foreground flex-1">Tap in time (or press T)</span>
      <button class="rounded border px-2 py-0.5" onclick={() => (project.bpm = clamp(project.bpm / 2))} title="Half the tempo">÷2</button>
      <button class="rounded border px-2 py-0.5" onclick={() => (project.bpm = clamp(project.bpm * 2))} title="Double the tempo">×2</button>
    </div>
  </div>
{/if}
