<!--
  The Playlist: the whole song, one lane per track, clips placed along the timeline.
  A block is a placement: a clip (melody) or pattern (drums) playing from there. The clip's
  notes are stored once, on its track; blocks only point at it (music/arrange.ts). So
  copying blocks costs nothing, and editing a clip changes every block of it.

  - click empty space in a lane: place the track's current clip there
  - drag a block: move it (snaps to bars; Alt: beats); Ctrl-drag: a copy (same clip)
  - drag a block's right edge: its length (longer loops the clip, shorter cuts it)
  - double-click a block: edit that clip; right-click: copy, make unique, delete…
  - Delete removes the selected block; the ruler moves the playhead
  - voice tracks: their recordings, dragged to move (Ctrl-drag copies, sharing the audio)
  - drum tracks with nothing placed loop their pattern for the whole song (shown faint)
-->
<script lang="ts">
  import Dropdown from './Dropdown.svelte';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { arrangementEnd, contentLength, placementLength } from '$lib/music/arrange';
  import { PPQ, barTicks, beatTicks, secondsToTicks } from '$lib/music/time';
  import type { DrumTrack, MidiTrack, Placement, Track, VoiceClip } from '$lib/music/types';
  import { contextMenu, openMenu } from '$lib/state/context-menu.svelte';
  import { playhead, seek } from '$lib/state/playhead.svelte';
  import { addPlacement, makeUnique, newContent, project, removePlacement, selection } from '$lib/state/project.svelte';
  import { view } from '$lib/state/view.svelte';

  const HEAD_W = 150; // lane headers on the left
  const LANE_H = 52;
  const RULER_H = 22;

  let pxPerBeat = $state(24);
  let snapTo = $state<'bar' | 'beat' | 'off'>('bar');
  let chosen = $state<{ trackId: string; id: string } | null>(null); // the selected block

  const x = (ticks: number) => (ticks / PPQ) * pxPerBeat;
  const ticksAt = (px: number) => (px / pxPerBeat) * PPQ;
  const bar = $derived(barTicks(project.timeSignature));
  const beat = $derived(beatTicks(project.timeSignature));
  const snap = (t: number, e?: { altKey: boolean }) => {
    const step = e?.altKey ? beat : snapTo === 'bar' ? bar : snapTo === 'beat' ? beat : 1;
    return Math.max(0, Math.round(t / step) * step);
  };

  type Arranged = MidiTrack | DrumTrack;
  // A placement's content length and name.
  function contentOf(track: Arranged, p: Placement): { length: number; name: string } {
    if (track.kind === 'midi') {
      const c = track.clips.find((k) => k.id === p.clipId);
      return { length: contentLength(c?.duration ?? 0, bar), name: c?.name ?? 'Clip' };
    }
    const pat = track.patterns.find((k) => k.id === p.clipId);
    return { length: (pat?.bars ?? 1) * bar, name: pat?.name ?? 'Pattern' };
  }
  const lengthOf = (track: Arranged, p: Placement) => placementLength(p, contentOf(track, p).length);
  const voiceLength = (c: VoiceClip) => {
    const e = c.edit ?? {};
    const sec = ((e.trimEnd ?? c.audio.length / c.sampleRate) - (e.trimStart ?? 0)) / (e.speed ?? 1);
    return secondsToTicks(sec, c.recordedBpm);
  };

  const songEnd = $derived(
    Math.max(
      0,
      ...project.tracks.map((t) =>
        t.kind === 'voice' ? Math.max(0, ...t.clips.map((c) => c.start + voiceLength(c))) : arrangementEnd(t.placements, (p) => lengthOf(t, p))
      )
    )
  );
  const width = $derived(Math.max(1600, x(songEnd + bar * 8)));
  const bars = $derived(Array.from({ length: Math.ceil(ticksAt(width) / bar) + 1 }, (_, i) => i));

  // A little picture of a melody clip: its notes as dashes, scaled to the block.
  function notePreview(track: MidiTrack, p: Placement, w: number): { x: number; y: number; w: number }[] {
    const c = track.clips.find((k) => k.id === p.clipId);
    if (!c || !c.notes.length) return [];
    const lo = Math.min(...c.notes.map((n) => n.pitch));
    const hi = Math.max(...c.notes.map((n) => n.pitch));
    const content = contentLength(c.duration, bar);
    const len = placementLength(p, content);
    const out: { x: number; y: number; w: number }[] = [];
    for (let loop = 0; loop < len; loop += content) {
      for (const n of c.notes) {
        if (loop + n.start >= len) continue;
        out.push({
          x: x(loop + n.start),
          y: 16 + (hi === lo ? 0.5 : (hi - n.pitch) / (hi - lo)) * (LANE_H - 24),
          w: Math.max(1, Math.min(x(n.duration), w - x(loop + n.start)))
        });
      }
    }
    return out;
  }

  // ---------- Dragging blocks ----------
  function onBlockDown(e: PointerEvent, track: Track, id: string, part: 'body' | 'end') {
    if (e.button !== 0) return;
    e.stopPropagation();
    chosen = { trackId: track.id, id };
    const x0 = e.clientX;
    let target: { start: number; length?: number } | undefined;
    let copied = false;
    if (track.kind === 'voice') target = track.clips.find((c) => c.id === id);
    else target = track.placements.find((p) => p.id === id);
    if (!target) return;
    const orig = { start: target.start, length: track.kind === 'voice' ? 0 : lengthOf(track, target as Placement) };
    const copy = e.ctrlKey || e.metaKey;
    const move = (ev: PointerEvent) => {
      const d = ticksAt(ev.clientX - x0);
      if (copy && !copied && Math.abs(ev.clientX - x0) > 3) {
        // Ctrl-drag: the copy stays, this one moves. A copy is another placement of the
        // same clip (voice: another clip sharing the same audio): nothing duplicated.
        copied = true;
        if (track.kind === 'voice') {
          const c = target as VoiceClip;
          track.clips.push({ ...c, id: crypto.randomUUID(), edit: c.edit && { ...c.edit } });
        } else {
          const p = target as Placement;
          addPlacement(track, p.clipId, p.start, p.length);
        }
      }
      if (part === 'body') target!.start = snap(orig.start + d, ev);
      else if (track.kind !== 'voice') (target as Placement).length = Math.max(beat, snap(orig.length + d, ev) || beat);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }

  function open(track: Track, clipId?: string) {
    selection.trackId = track.id;
    if (clipId && track.kind !== 'voice') track.current = clipId;
    view.main = 'editor';
  }

  // Click empty space in a lane: place the track's current clip there.
  function onLaneDown(e: PointerEvent, track: Track) {
    if (e.button !== 0 || track.kind === 'voice') return;
    const at = snap(ticksAt(e.offsetX), e);
    const id = track.current ?? (track.kind === 'midi' ? track.clips[0]?.id : track.patterns[0]?.id);
    if (!id) return;
    const p = addPlacement(track, id, at);
    chosen = { trackId: track.id, id: p.id };
  }

  function blockMenu(track: Track, id: string) {
    if (track.kind === 'voice') {
      return [
        { label: 'Edit recording', action: () => open(track) },
        { label: 'Delete', danger: true, action: () => (track.clips = track.clips.filter((c) => c.id !== id)) }
      ];
    }
    const p = track.placements.find((k) => k.id === id)!;
    return [
      { label: 'Edit clip', action: () => open(track, p.clipId) },
      { label: 'Copy after it', action: () => addPlacement(track, p.clipId, p.start + lengthOf(track, p), p.length) },
      { label: 'Make unique', action: () => makeUnique(track, p.id) },
      { label: 'Length: one loop', disabled: p.length === undefined, action: () => (p.length = undefined) },
      { separator: true },
      { label: 'Delete', shortcut: 'Del', danger: true, action: () => removePlacement(track, p.id) }
    ];
  }

  function laneMenu(e: MouseEvent, track: Track) {
    if (track.kind === 'voice') return openMenu(e, [{ label: 'Edit recordings', action: () => open(track) }]);
    const at = snap(ticksAt(e.offsetX));
    const current = track.kind === 'midi' ? track.clips.find((c) => c.id === track.current) : track.patterns.find((c) => c.id === track.current);
    openMenu(e, [
      { label: `Place “${current?.name ?? 'clip'}” here`, disabled: !current, action: () => current && addPlacement(track, current.id, at) },
      { label: track.kind === 'midi' ? 'New clip here' : 'New pattern here', action: () => addPlacement(track, newContent(track).id, at) },
      { label: 'Play from here', action: () => seek(at) }
    ]);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"], [role="slider"]')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && chosen) {
      const track = project.tracks.find((t) => t.id === chosen!.trackId);
      if (track?.kind === 'voice') track.clips = track.clips.filter((c) => c.id !== chosen!.id);
      else if (track) removePlacement(track, chosen.id);
      chosen = null;
      e.preventDefault();
    }
  }

  // Ruler: click or drag to move the playhead.
  function onRuler(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const to = (ev: PointerEvent) => seek(snap(ticksAt(ev.clientX - r.left), { altKey: true }));
    to(e);
    window.addEventListener('pointermove', to);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', to), { once: true });
  }

  // Middle-drag pans; Ctrl + wheel zooms (like the piano roll).
  let scroller = $state<HTMLDivElement>();
  function onScrollerDown(e: PointerEvent) {
    if (e.button !== 1 || !scroller) return;
    e.preventDefault();
    const s = scroller;
    const start = { x: e.clientX, y: e.clientY, left: s.scrollLeft, top: s.scrollTop };
    const move = (ev: PointerEvent) => {
      s.scrollLeft = start.left - (ev.clientX - start.x);
      s.scrollTop = start.top - (ev.clientY - start.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }
  onMount(() => {
    const s = scroller!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      pxPerBeat = Math.max(4, Math.min(120, pxPerBeat * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    s.addEventListener('wheel', onWheel, { passive: false });
    return () => s.removeEventListener('wheel', onWheel);
  });

  const KIND_FILL: Record<Track['kind'], string> = { midi: 'fill-sky-600', drums: 'fill-emerald-600', voice: 'fill-violet-600' };
</script>

<svelte:window onkeydown={onKey} />

<div class="flex h-full flex-col">
  <div class="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-b px-3 text-xs whitespace-nowrap">
    <span class="font-semibold">Playlist</span>
    <label class="flex items-center gap-1">
      Snap
      <Dropdown
        bind:value={snapTo}
        ariaLabel="Snap"
        options={[
          { value: 'bar', label: 'Bar' },
          { value: 'beat', label: 'Beat' },
          { value: 'off', label: 'Off' }
        ]}
      />
    </label>
    <div class="flex items-center gap-1">
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => (pxPerBeat = Math.max(4, pxPerBeat * 0.8))}>−</Button>
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => (pxPerBeat = Math.min(120, pxPerBeat * 1.25))}>+</Button>
    </div>
    <span class="text-muted-foreground">
      Click a lane to place its current clip · drag to move, edge to lengthen (loops) · Ctrl-drag copies · double-click to edit
    </span>
  </div>

  <div
    bind:this={scroller}
    class="relative min-h-0 flex-1 overflow-auto"
    role="presentation"
    onpointerdown={onScrollerDown}
    onmousedown={(e) => e.button === 1 && e.preventDefault()}
  >
    <!-- Ruler, stuck to the top. -->
    <div class="bg-background sticky top-0 z-20 flex border-b" style="width: {HEAD_W + width}px">
      <div class="bg-background sticky left-0 z-10 shrink-0 border-r" style="width: {HEAD_W}px"></div>
      <svg {width} height={RULER_H} class="block shrink-0 cursor-pointer select-none" role="presentation" onpointerdown={onRuler}>
        {#each bars as b (b)}
          <line x1={x(b * bar)} x2={x(b * bar)} y1="0" y2={RULER_H} class="stroke-foreground/40" />
          {#if x(bar) >= 18 || b % 4 === 0}
            <text x={x(b * bar) + 3} y="12" class="fill-muted-foreground pointer-events-none text-[10px]">{b + 1}</text>
          {/if}
        {/each}
        <polygon points="{x(playhead.cursor) - 6},0 {x(playhead.cursor) + 6},0 {x(playhead.cursor)},9" class="pointer-events-none fill-sky-500" />
        {#if playhead.running && playhead.ticks >= 0 && !playhead.pattern}
          <line x1={x(playhead.ticks)} x2={x(playhead.ticks)} y1="0" y2={RULER_H} class="pointer-events-none stroke-red-500" stroke-width="2" />
        {/if}
      </svg>
    </div>

    {#each project.tracks as track (track.id)}
      <div class="flex border-b" style="width: {HEAD_W + width}px">
        <!-- Lane header: stuck to the left. Click: select the track; double-click: edit it. -->
        <button
          class="bg-background sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r px-2 text-left {selection.trackId === track.id ? 'bg-muted' : ''}"
          style="width: {HEAD_W}px; height: {LANE_H}px"
          onclick={() => (selection.trackId = track.id)}
          ondblclick={() => open(track)}
        >
          <span class="truncate text-sm font-medium">{track.name}</span>
          <span class="text-muted-foreground text-[10px]">{track.kind === 'midi' ? 'melody' : track.kind}{track.mute ? ' · muted' : ''}{track.solo ? ' · solo' : ''}</span>
        </button>
        <svg
          {width}
          height={LANE_H}
          class="block shrink-0 select-none"
          role="presentation"
          onpointerdown={(e) => onLaneDown(e, track)}
          oncontextmenu={(e) => laneMenu(e, track)}
        >
          {#each bars as b (b)}
            <line x1={x(b * bar)} x2={x(b * bar)} y1="0" y2={LANE_H} class="stroke-border" />
          {/each}

          {#if track.kind === 'drums' && !track.placements.length}
            <!-- Not arranged: the current pattern loops for the whole song. -->
            <rect x="0" y="4" {width} height={LANE_H - 8} rx="4" class="pointer-events-none fill-emerald-600/10" />
            <text x="6" y={LANE_H / 2 + 4} class="pointer-events-none fill-emerald-700 text-[10px]">
              Looping “{track.patterns.find((p) => p.id === track.current)?.name ?? 'Pattern'}” all song: click to place patterns
            </text>
          {/if}

          {#if track.kind === 'voice'}
            {#each track.clips as c (c.id)}
              {@const bx = x(c.start)}
              {@const bw = Math.max(6, x(voiceLength(c)))}
              <g use:contextMenu={() => blockMenu(track, c.id)}>
                <rect
                  x={bx}
                  y="4"
                  width={bw}
                  height={LANE_H - 8}
                  rx="4"
                  class="{KIND_FILL.voice} cursor-grab opacity-80 {chosen?.id === c.id ? 'stroke-amber-400' : ''}"
                  stroke-width="2"
                  role="button"
                  tabindex="-1"
                  aria-label="Recording"
                  onpointerdown={(e) => onBlockDown(e, track, c.id, 'body')}
                  ondblclick={() => open(track)}
                />
                <text x={bx + 4} y="16" class="pointer-events-none fill-white text-[10px]">Recording</text>
              </g>
            {/each}
          {:else}
            {#each track.placements as p (p.id)}
              {@const info = contentOf(track, p)}
              {@const len = lengthOf(track, p)}
              {@const bx = x(p.start)}
              {@const bw = Math.max(6, x(len))}
              <g use:contextMenu={() => blockMenu(track, p.id)}>
                <rect
                  x={bx}
                  y="4"
                  width={bw}
                  height={LANE_H - 8}
                  rx="4"
                  class="{KIND_FILL[track.kind]} cursor-grab opacity-85 {chosen?.id === p.id ? 'stroke-amber-400' : ''}"
                  stroke-width="2"
                  role="button"
                  tabindex="-1"
                  aria-label={info.name}
                  onpointerdown={(e) => onBlockDown(e, track, p.id, 'body')}
                  ondblclick={() => open(track, p.clipId)}
                />
                <!-- Loop marks where the clip repeats. -->
                {#each Array.from({ length: Math.max(0, Math.ceil(len / info.length) - 1) }, (_, i) => i + 1) as k (k)}
                  <line x1={bx + x(k * info.length)} x2={bx + x(k * info.length)} y1="6" y2={LANE_H - 6} class="pointer-events-none stroke-white/50" stroke-dasharray="2 2" />
                {/each}
                {#if track.kind === 'midi'}
                  {#each notePreview(track, p, bw) as n, i (i)}
                    <rect x={bx + n.x} y={n.y} width={n.w} height="2" class="pointer-events-none fill-white/80" />
                  {/each}
                {/if}
                <text x={bx + 4} y="14" class="pointer-events-none fill-white text-[10px]">{info.name}</text>
                <!-- Right edge: drag for the length. -->
                <rect x={bx + bw - 6} y="4" width="8" height={LANE_H - 8} class="cursor-ew-resize fill-white/0 hover:fill-white/30" role="presentation" onpointerdown={(e) => onBlockDown(e, track, p.id, 'end')} />
              </g>
            {/each}
          {/if}

          <line x1={x(playhead.cursor)} x2={x(playhead.cursor)} y1="0" y2={LANE_H} class="pointer-events-none stroke-sky-400" stroke-dasharray="4 4" />
          {#if playhead.running && playhead.ticks >= 0 && !playhead.pattern}
            <line x1={x(playhead.ticks)} x2={x(playhead.ticks)} y1="0" y2={LANE_H} class="pointer-events-none stroke-red-500" stroke-width="2" />
          {/if}
        </svg>
      </div>
    {:else}
      <p class="text-muted-foreground p-6 text-sm">Add tracks to arrange them here.</p>
    {/each}
  </div>
</div>
