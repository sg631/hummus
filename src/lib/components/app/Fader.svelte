<!--
  A mixer fader: a vertical volume slider (dB) with a level meter beside it.
  - drag the handle (or anywhere on it) up or down; Shift: finer
  - double-click: back to 0 dB; arrow keys: 0.5 dB (Shift: 3 dB)
  - right-click: reset, type a value, automate it; Ctrl+drag: onto an automation lane
  `level`: how loud it is now (dB), drawn as the meter. `automated`: a lane moves it while
  the song plays (the handle turns amber).
-->
<script lang="ts">
  import { contextMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import { automationMenu, startKnobDrag, touchAutomation } from '$lib/state/automation.svelte';
  import type { AutomationTarget } from '$lib/music/types';

  let {
    value = $bindable(0),
    min = -60,
    max = 6,
    defaultValue = 0,
    level = -Infinity,
    height = 180,
    automated = false,
    label = 'Volume',
    menu,
    automate
  }: {
    value?: number;
    min?: number;
    max?: number;
    defaultValue?: number;
    level?: number;
    height?: number;
    automated?: boolean;
    label?: string;
    menu?: () => MenuItem[];
    automate?: AutomationTarget; // Ctrl+drag (or right-click) to automate it
  } = $props();

  const MARKS = [6, 0, -6, -12, -24, -36, -48, -60];
  const HANDLE = 14;
  const unit = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const y = (v: number) => (1 - unit(v)) * (height - HANDLE) + HANDLE / 2;
  const set = (v: number) => {
    value = Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;
    if (automate) touchAutomation(automate); // recorded into its lane (Transport → Record automation)
  };

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ((e.ctrlKey || e.metaKey) && automate) return startKnobDrag(e, automate, e.currentTarget as Element);
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
    const startY = e.clientY;
    const start = value;
    const move = (ev: PointerEvent) => {
      const perPx = (max - min) / (height - HANDLE) / (ev.shiftKey ? 5 : 1);
      set(start + (startY - ev.clientY) * perPx);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }

  function onKey(e: KeyboardEvent) {
    const by = e.shiftKey ? 3 : 0.5;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + by);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - by);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
  }

  function faderMenu(): MenuItem[] {
    return [
      { label: 'Reset to 0 dB', action: () => set(defaultValue) },
      { label: 'Silence (−60 dB)', action: () => set(min) },
      {
        label: 'Type a value…',
        action: () => {
          const typed = window.prompt(`${label} in dB (${min} to ${max})`, String(value));
          if (typed !== null && typed.trim() !== '' && !Number.isNaN(Number(typed))) set(Number(typed));
        }
      },
      ...(menu ? [{ separator: true }, ...menu()] : []),
      ...(automate ? [{ separator: true }, ...automationMenu(automate)] : [])
    ];
  }

  const meterColor = $derived(level > -1 ? 'bg-red-500' : level > -9 ? 'bg-amber-400' : 'bg-emerald-500');
</script>

<div class="flex select-none items-stretch gap-1" style="height: {height}px">
  <!-- The scale. -->
  <div class="relative w-5 text-right">
    {#each MARKS as m (m)}
      <span class="text-muted-foreground absolute right-0 -translate-y-1/2 font-mono text-[8px] leading-none" style="top: {y(m)}px">{m > 0 ? `+${m}` : m}</span>
    {/each}
  </div>

  <!-- The fader. -->
  <div
    class="focus-visible:ring-ring relative w-6 cursor-ns-resize rounded outline-none focus-visible:ring-2"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    onpointerdown={onDown}
    ondblclick={() => set(defaultValue)}
    onkeydown={onKey}
    use:contextMenu={faderMenu}
  >
    <div class="bg-muted absolute top-[7px] bottom-[7px] left-1/2 w-1 -translate-x-1/2 rounded"></div>
    <div class="bg-foreground/30 absolute left-1 right-1 h-px" style="top: {y(0)}px"></div>
    <div
      class="absolute left-0 right-0 rounded-sm border shadow {automated ? 'border-amber-600 bg-amber-400' : 'bg-secondary border-foreground/30'}"
      style="top: {y(value) - HANDLE / 2}px; height: {HANDLE}px"
    >
      <div class="bg-foreground/60 mx-1 mt-[6px] h-px"></div>
    </div>
  </div>

  <!-- The meter. -->
  <div class="bg-muted relative w-2 overflow-hidden rounded-sm" title="Level">
    <div class="absolute right-0 bottom-0 left-0 {meterColor}" style="height: {unit(level) * 100}%"></div>
  </div>
</div>
