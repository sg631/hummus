<!--
  A voice track's recordings, as waveforms on the timeline, and how they play.
  - drag a recording to move it in time (snaps to sixteenths; Alt: free)
  - drag its left / right edge to trim the start / end (the cut parts show faded)
  - knobs: speed (pitch unchanged), pitch (speed unchanged), gain, fade in, fade out
  - Reverse, Normalize (loudest point to 0 dB), Reset, quick ½× / 2× / ±1 / ±12 buttons
  - the ruler: click or drag to move the playhead; right-click anything for more
  Nothing changes the recording itself: the edits are settings (`clip.edit`) applied when
  it plays (audio/playback.ts scheduleRecording), so Reset always gets the original back.
  Changes apply on the next Play.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { PPQ, barTicks, secondsToTicks, ticksToSeconds } from '$lib/music/time';
  import type { VoiceClip, VoiceEdit, VoiceTrack } from '$lib/music/types';
  import { contextMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import { playhead, seek } from '$lib/state/playhead.svelte';
  import { project } from '$lib/state/project.svelte';

  let { track }: { track: VoiceTrack } = $props();

  const WAVE_H = 140;
  const RULER_H = 22;
  const BINS_PER_SEC = 100; // waveform detail
  let pxPerBeat = $state(80);
  let selectedId = $state<string | null>(null);

  const x = (ticks: number) => (ticks / PPQ) * pxPerBeat;
  const ticksAt = (px: number) => (px / pxPerBeat) * PPQ;
  const bar = $derived(barTicks(project.timeSignature));

  // ---------- Per clip ----------
  const edit = (c: VoiceClip): VoiceEdit => c.edit ?? {};
  const fullSec = (c: VoiceClip) => c.audio.length / c.sampleRate;
  const trimStart = (c: VoiceClip) => edit(c).trimStart ?? 0;
  const trimEnd = (c: VoiceClip) => edit(c).trimEnd ?? fullSec(c);
  // Seconds of the recording → ticks on the timeline (it follows the tempo, and its speed).
  const toTicks = (c: VoiceClip, sec: number) => secondsToTicks(sec / (edit(c).speed ?? 1), c.recordedBpm);
  const lengthTicks = (c: VoiceClip) => toTicks(c, trimEnd(c) - trimStart(c));
  // Where the recording's own time 0 sits on the timeline (the start is trimmed off it).
  const zeroAt = (c: VoiceClip) => c.start - toTicks(c, trimStart(c));

  const clip = $derived(track.clips.find((c) => c.id === selectedId) ?? track.clips[0]);
  const songEnd = $derived(Math.max(0, ...track.clips.map((c) => c.start + lengthTicks(c))));
  const width = $derived(Math.max(1200, x(songEnd + bar * 4)));

  // ---------- Waveform ----------
  // The loudest sample in each 1/100 s, worked out once per recording.
  const peakCache = new WeakMap<Float32Array, Float32Array>();
  function peaks(c: VoiceClip): Float32Array {
    let p = peakCache.get(c.audio);
    if (!p) {
      const per = Math.max(1, Math.floor(c.sampleRate / BINS_PER_SEC));
      p = new Float32Array(Math.ceil(c.audio.length / per));
      for (let i = 0; i < p.length; i++) {
        let m = 0;
        for (let j = i * per, end = Math.min(c.audio.length, j + per); j < end; j++) m = Math.max(m, Math.abs(c.audio[j]));
        p[i] = m;
      }
      peakCache.set(c.audio, p);
    }
    return p;
  }

  // The waveform as an SVG path, mirrored around the middle, with gain, fades and reverse.
  function wavePath(c: VoiceClip): string {
    const p = peaks(c);
    const e = edit(c);
    const gain = 10 ** ((e.gain ?? 0) / 20);
    const full = fullSec(c);
    const playLen = (trimEnd(c) - trimStart(c)) / (e.speed ?? 1);
    const top: string[] = [];
    const bottom: string[] = [];
    const step = Math.max(1, Math.floor(p.length / Math.max(1, x(toTicks(c, full)))));
    for (let i = 0; i < p.length; i += step) {
      const sec = i / BINS_PER_SEC; // place on screen…
      const src = e.reverse ? full - sec : sec; // …and which audio is heard there
      let amp = (p[Math.min(p.length - 1, Math.floor(src * BINS_PER_SEC))] ?? 0) * gain;
      // Fades (in timeline seconds from the trimmed start).
      const t = (sec - trimStart(c)) / (e.speed ?? 1);
      if (e.fadeIn && t < e.fadeIn) amp *= Math.max(0, t / e.fadeIn);
      if (e.fadeOut && t > playLen - e.fadeOut) amp *= Math.max(0, (playLen - t) / e.fadeOut);
      const h = Math.min(1, amp) * (WAVE_H / 2 - 4);
      const px = x(zeroAt(c) + toTicks(c, sec));
      top.push(`${px.toFixed(1)},${(WAVE_H / 2 - h).toFixed(1)}`);
      bottom.push(`${px.toFixed(1)},${(WAVE_H / 2 + h).toFixed(1)}`);
    }
    return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`;
  }

  // ---------- Changing a clip ----------
  function set(c: VoiceClip, change: Partial<VoiceEdit>) {
    c.edit = { ...c.edit, ...change };
  }

  function normalize(c: VoiceClip) {
    let peak = 0;
    for (let i = 0; i < c.audio.length; i++) peak = Math.max(peak, Math.abs(c.audio[i]));
    if (peak > 0) set(c, { gain: Math.round(-20 * Math.log10(peak) * 10) / 10 });
  }

  function remove(c: VoiceClip) {
    track.clips = track.clips.filter((k) => k.id !== c.id);
  }

  function menuFor(c: VoiceClip): MenuItem[] {
    const e = edit(c);
    return [
      { label: 'Faster (×2)', action: () => set(c, { speed: Math.min(2, (e.speed ?? 1) * 2) }) },
      { label: 'Slower (½×)', action: () => set(c, { speed: Math.max(0.5, (e.speed ?? 1) / 2) }) },
      { label: 'Up an octave', action: () => set(c, { pitch: Math.min(12, (e.pitch ?? 0) + 12) }) },
      { label: 'Down an octave', action: () => set(c, { pitch: Math.max(-12, (e.pitch ?? 0) - 12) }) },
      { separator: true },
      { label: 'Reverse', checked: !!e.reverse, action: () => set(c, { reverse: !e.reverse }) },
      { label: 'Normalize', action: () => normalize(c) },
      { label: 'Untrim', disabled: e.trimStart === undefined && e.trimEnd === undefined, action: () => { c.start = Math.max(0, zeroAt(c)); set(c, { trimStart: undefined, trimEnd: undefined }); } },
      { label: 'Move to the start', action: () => (c.start = 0) },
      { label: 'Reset all edits', action: () => (c.edit = undefined) },
      { separator: true },
      { label: 'Delete recording', danger: true, action: () => remove(c) }
    ];
  }

  // ---------- Dragging: move, trim ----------
  let svg = $state<SVGSVGElement>();
  function onDown(e: PointerEvent, c: VoiceClip, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectedId = c.id;
    const x0 = e.clientX;
    const orig = { start: c.start, trimStart: trimStart(c), trimEnd: trimEnd(c) };
    const snap = (t: number, free: boolean) => (free ? Math.round(t) : Math.round(t / (PPQ / 4)) * (PPQ / 4));
    // Ticks on the timeline → seconds of the recording.
    const toSec = (ticks: number) => ticksToSeconds(ticks, c.recordedBpm) * (edit(c).speed ?? 1);
    const move = (ev: PointerEvent) => {
      const dTicks = ticksAt(ev.clientX - x0);
      if (part === 'body') c.start = Math.max(0, snap(orig.start + dTicks, ev.altKey));
      else if (part === 'start') {
        // The audio stays put: trimming the start moves where the clip begins.
        const newStart = Math.max(zeroAt({ ...c, edit: { ...c.edit, trimStart: orig.trimStart } } as VoiceClip), snap(orig.start + dTicks, ev.altKey));
        const ts = Math.max(0, Math.min(orig.trimEnd - 0.05, orig.trimStart + toSec(newStart - orig.start)));
        set(c, { trimStart: ts });
        c.start = Math.max(0, Math.round(orig.start + toTicks(c, ts - orig.trimStart)));
      } else {
        const te = Math.max(orig.trimStart + 0.05, Math.min(fullSec(c), orig.trimEnd + toSec(dTicks)));
        set(c, { trimEnd: te });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }

  function onRuler(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const to = (ev: PointerEvent) => seek(Math.round(ticksAt(ev.clientX - r.left) / (PPQ / 4)) * (PPQ / 4));
    to(e);
    window.addEventListener('pointermove', to);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', to), { once: true });
  }

  const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
</script>

<div class="flex h-full flex-col">
  {#if clip}
    {@const e = edit(clip)}
    <!-- How the selected recording plays. -->
    <div class="flex items-end gap-x-4 overflow-x-auto border-b px-3 py-2 text-xs whitespace-nowrap">
      <span class="self-center font-semibold">Recording</span>
      <Knob label="Speed" size={30} bind:value={() => e.speed ?? 1, (v) => set(clip, { speed: v })} min={0.5} max={2} step={0.01} defaultValue={1} format={(v) => `${v.toFixed(2)}×`} />
      <Knob label="Pitch" size={30} bind:value={() => e.pitch ?? 0, (v) => set(clip, { pitch: v })} min={-12} max={12} step={0.5} defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${v} st`} />
      <Knob label="Gain" size={30} bind:value={() => e.gain ?? 0, (v) => set(clip, { gain: v })} min={-24} max={24} step={0.5} defaultValue={0} format={formatDb} />
      <Knob label="Fade in" size={30} bind:value={() => e.fadeIn ?? 0, (v) => set(clip, { fadeIn: v })} min={0} max={2} step={0.05} defaultValue={0} format={(v) => `${v.toFixed(2)} s`} />
      <Knob label="Fade out" size={30} bind:value={() => e.fadeOut ?? 0, (v) => set(clip, { fadeOut: v })} min={0} max={2} step={0.05} defaultValue={0} format={(v) => `${v.toFixed(2)} s`} />
      <label class="flex flex-col items-center gap-2 self-center">
        <span class="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">Reverse</span>
        <Switch size="sm" bind:checked={() => !!e.reverse, (v) => set(clip, { reverse: v })} />
      </label>
      <div class="flex gap-1 self-center">
        <Button size="sm" variant="outline" class="h-7" onclick={() => set(clip, { speed: Math.max(0.5, (e.speed ?? 1) / 2) })} title="Half speed">½×</Button>
        <Button size="sm" variant="outline" class="h-7" onclick={() => set(clip, { speed: Math.min(2, (e.speed ?? 1) * 2) })} title="Double speed">2×</Button>
        <Button size="sm" variant="outline" class="h-7" onclick={() => set(clip, { pitch: Math.max(-12, (e.pitch ?? 0) - 1) })} title="Down a semitone">−1</Button>
        <Button size="sm" variant="outline" class="h-7" onclick={() => set(clip, { pitch: Math.min(12, (e.pitch ?? 0) + 1) })} title="Up a semitone">+1</Button>
        <Button size="sm" variant="outline" class="h-7" onclick={() => normalize(clip)} title="Make its loudest point 0 dB">Normalize</Button>
        <Button size="sm" variant="outline" class="h-7" onclick={() => (clip.edit = undefined)} title="Back to the recording as it was">Reset</Button>
      </div>
      <div class="flex items-center gap-1 self-center">
        <Button size="sm" variant="ghost" class="h-7 px-2" onclick={() => (pxPerBeat = Math.max(15, pxPerBeat * 0.8))}>−</Button>
        <Button size="sm" variant="ghost" class="h-7 px-2" onclick={() => (pxPerBeat = Math.min(400, pxPerBeat * 1.25))}>+</Button>
      </div>
      <span class="text-muted-foreground self-center">Changes apply on the next Play.</span>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto">
    {#if track.clips.length}
      <!-- Ruler: bar numbers; click or drag to move the playhead. -->
      <svg {width} height={RULER_H} class="bg-background sticky top-0 block cursor-pointer border-b select-none" role="presentation" onpointerdown={onRuler}>
        {#each Array.from({ length: Math.ceil(ticksAt(width) / bar) + 1 }, (_, i) => i) as b (b)}
          <line x1={x(b * bar)} x2={x(b * bar)} y1="0" y2={RULER_H} class="stroke-foreground/40" />
          <text x={x(b * bar) + 3} y="12" class="fill-muted-foreground pointer-events-none text-[10px]">{b + 1}</text>
        {/each}
        <polygon points="{x(playhead.cursor) - 6},0 {x(playhead.cursor) + 6},0 {x(playhead.cursor)},9" class="pointer-events-none fill-sky-500" />
      </svg>

      <svg bind:this={svg} {width} height={WAVE_H * track.clips.length + 8} class="block select-none" role="application" aria-label="Recordings">
        {#each Array.from({ length: Math.ceil(ticksAt(width) / bar) + 1 }, (_, i) => i) as b (b)}
          <line x1={x(b * bar)} x2={x(b * bar)} y1="0" y2={WAVE_H * track.clips.length + 8} class="stroke-border" />
        {/each}
        {#each track.clips as c, i (c.id)}
          {@const left = x(c.start)}
          {@const w = Math.max(4, x(lengthTicks(c)))}
          <g transform="translate(0 {i * WAVE_H + 4})" use:contextMenu={() => menuFor(c)}>
            <clipPath id="trim-{c.id}"><rect x={left} y="0" width={w} height={WAVE_H} /></clipPath>
            <!-- The whole recording, faded; the part that plays, solid. -->
            <path d={wavePath(c)} class="fill-sky-600/20" />
            <path d={wavePath(c)} clip-path="url(#trim-{c.id})" class="fill-sky-600" />
            <rect
              x={left}
              y="0"
              width={w}
              height={WAVE_H - 8}
              rx="4"
              class="cursor-grab fill-transparent {c.id === clip?.id ? 'stroke-amber-500' : 'stroke-sky-700'}"
              stroke-width="2"
              role="button"
              tabindex="-1"
              aria-label="Recording"
              onpointerdown={(ev) => onDown(ev, c, 'body')}
            />
            <rect x={left - 3} y="0" width="8" height={WAVE_H - 8} class="cursor-ew-resize fill-amber-500/0 hover:fill-amber-500/40" role="presentation" onpointerdown={(ev) => onDown(ev, c, 'start')} />
            <rect x={left + w - 5} y="0" width="8" height={WAVE_H - 8} class="cursor-ew-resize fill-amber-500/0 hover:fill-amber-500/40" role="presentation" onpointerdown={(ev) => onDown(ev, c, 'end')} />
          </g>
        {/each}
        <line x1={x(playhead.cursor)} x2={x(playhead.cursor)} y1="0" y2={WAVE_H * track.clips.length + 8} class="pointer-events-none stroke-sky-400" stroke-dasharray="4 4" />
        {#if playhead.running && playhead.ticks >= 0}
          <line x1={x(playhead.ticks)} x2={x(playhead.ticks)} y1="0" y2={WAVE_H * track.clips.length + 8} class="pointer-events-none stroke-red-500" stroke-width="2" />
        {/if}
      </svg>
    {:else}
      <p class="text-muted-foreground p-6 text-sm">No recording yet: press Record and sing (recordings aren't saved with the project).</p>
    {/if}
  </div>
</div>
