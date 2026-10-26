<!--
  The Playlist: the whole song, one lane per track, clips placed along the timeline.
  A block is a placement: a clip (melody) or pattern (drums) playing from there. The clip's
  notes are stored once, on its track; blocks only point at it (music/arrange.ts). So
  copying blocks costs nothing, and editing a clip changes every block of it.

  - click empty space in a lane: place the track's current clip there
  - drag a block: move it (snaps to bars; Alt: beats); Ctrl-drag: a copy (same clip)
  - drag a block's right edge: its length (longer loops the clip, shorter cuts it); its left
    edge: where it starts in the clip (a recording: trim its start)
  - S (or right-click → Split): split the selected blocks at the playhead; right-click →
    Mute a block or a take, or keep only this take (mutes the recordings it overlaps)
  - double-click a block: edit that clip; right-click: copy, make unique, delete…
  - selecting: click a block; Shift+click adds or removes it; Shift+drag across lanes draws
    a box; Ctrl+A selects everything. Dragging moves every selected block together
  - keys: Delete, Ctrl+C / X / V (pastes at the playhead), Ctrl+D (a copy right after),
    ← → (nudge by the snap), Esc (select nothing); the ruler moves the playhead
  - voice tracks: their recordings, dragged to move (Ctrl-drag copies, sharing the audio)
  - drum tracks with nothing placed loop their pattern for the whole song (shown faint)
  - markers: right-click the ruler → Add a marker (Transport menu: at the playhead); click one
    to jump there, drag to move, right-click to rename or delete. The ruler's and the loop's
    menus also insert or delete bars (everything after moves)
  - the loop region: the strip at the top of the ruler. Drag across it to set the loop, drag
    the band to move it, its ends to resize it; right-click for more. ⟳ in the top bar
    turns the loop on (Song mode then repeats it)
  - automation lanes (under the tracks): a setting's line over the song. "+ Lane" adds an
    empty one; Ctrl+drag any knob, fader, the tempo or time signature onto it (or
    right-click a knob → Automate in…). See AutomationLaneRow.
-->
<script lang="ts">
  import Dropdown from './Dropdown.svelte';
  import AutomationLaneRow from './AutomationLaneRow.svelte';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { arrangementEnd, blockOffset, contentLength, placementLength, splitPlacement } from '$lib/music/arrange';
  import { PPQ, barTicks, beatTicks, secondsToTicks, ticksToSeconds } from '$lib/music/time';
  import type { DrumTrack, MidiTrack, Placement, Track, VoiceClip } from '$lib/music/types';
  import { contextMenu, openMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import { playhead, seek } from '$lib/state/playhead.svelte';
  import { addEmptyLane, addMarker, addPlacement, deleteTime, insertTime, makeUnique, newContent, project, removeMarker, removePlacement, selection } from '$lib/state/project.svelte';
  import { view } from '$lib/state/view.svelte';
  import { keysFor } from '$lib/state/layout.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { presetById } from '$lib/music/instruments';

  const HEAD_W = 150; // lane headers on the left
  const LANE_H = 52;
  const RULER_H = 44;
  const LOOP_H = 10; // the loop strip at the top of the ruler
  const MARK_H = 14; // then the markers' row, then bar numbers

  let pxPerBeat = $state(24);
  let snapTo = $state<'bar' | 'beat' | 'off'>('bar');
  // The selected blocks, as 'trackId|blockId' (a placement's id, or a voice recording's).
  let selected = $state<Set<string>>(new Set());
  const keyOf = (trackId: string, id: string) => `${trackId}|${id}`;
  const isSelected = (trackId: string, id: string) => selected.has(keyOf(trackId, id));
  function select(keys: string[], add = false) {
    selected = new Set(add ? [...selected, ...keys] : keys);
  }

  const x = (ticks: number) => (ticks / PPQ) * pxPerBeat;
  const ticksAt = (px: number) => (px / pxPerBeat) * PPQ;
  const bar = $derived(barTicks(project.timeSignature));
  const beat = $derived(beatTicks(project.timeSignature));
  const snap = (t: number, e?: { altKey: boolean }) => {
    const step = e?.altKey ? beat : snapTo === 'bar' ? bar : snapTo === 'beat' ? beat : 1;
    return Math.max(0, Math.round(t / step) * step);
  };
  // ---------- What a click places ----------
  // Every melody clip and drum pattern, by track; the chosen one is its track's current one.
  // Grouped under each track's instrument (and the track's name, as two tracks can share one).
  const placeOptions = $derived.by(() => {
    // Two tracks with the same name get their number (track 2, track 3…) so their groups differ.
    const named = (t: Track, i: number) => (project.tracks.filter((x) => x.name === t.name).length > 1 ? `${t.name} (track ${i + 1})` : t.name);
    return project.tracks.flatMap((t, i) =>
      t.kind === 'midi'
        ? t.clips.map((c) => ({ value: `${t.id}|${c.id}`, label: c.name ?? 'Clip', group: `${presetById(project.instruments, t.instrument).name} · ${named(t, i)}` }))
        : t.kind === 'drums'
          ? t.patterns.map((p) => ({ value: `${t.id}|${p.id}`, label: p.name, group: `Drum kit · ${named(t, i)}` }))
          : []
    );
  });
  // The selected track's (or else the first arranged track's) current clip / pattern.
  const placingTrack = $derived.by(() => {
    const arranged = project.tracks.filter((t): t is MidiTrack | DrumTrack => t.kind !== 'voice');
    return arranged.find((t) => t.id === selection.trackId) ?? arranged[0];
  });
  const placing = $derived(placingTrack ? `${placingTrack.id}|${placingTrack.current ?? (placingTrack.kind === 'midi' ? placingTrack.clips[0]?.id : placingTrack.patterns[0]?.id) ?? ''}` : '');
  function choosePlacing(value: string) {
    const [trackId, clipId] = value.split('|');
    const t = project.tracks.find((x) => x.id === trackId);
    if (!t || t.kind === 'voice') return;
    t.current = clipId;
    selection.trackId = t.id;
  }

  // Automation points snap finer: to sixteenths (Snap off or Alt: anywhere).
  const snapPoint = (t: number, e: { altKey: boolean }) => (e.altKey || snapTo === 'off' ? Math.round(t) : Math.round(t / (PPQ / 4)) * (PPQ / 4));

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
    for (let loop = -blockOffset(p, content); loop < len; loop += content) {
      for (const n of c.notes) {
        if (loop + n.start >= len || loop + n.start < 0) continue;
        out.push({
          x: x(loop + n.start),
          y: 16 + (hi === lo ? 0.5 : (hi - n.pitch) / (hi - lo)) * (LANE_H - 24),
          w: Math.max(1, Math.min(x(n.duration), w - x(loop + n.start)))
        });
      }
    }
    return out;
  }

  // ---------- Selected blocks ----------
  interface Block {
    track: Track;
    item: { id: string; start: number; length?: number }; // a placement or a voice recording
  }
  function blockOf(key: string): Block | undefined {
    const [trackId, id] = key.split('|');
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const item = track.kind === 'voice' ? track.clips.find((c) => c.id === id) : track.placements.find((p) => p.id === id);
    return item ? { track, item } : undefined;
  }
  const selectedBlocks = () => [...selected].map(blockOf).filter((b): b is Block => !!b);
  const blockLength = (b: Block) => (b.track.kind === 'voice' ? voiceLength(b.item as VoiceClip) : lengthOf(b.track, b.item as Placement));
  const allKeys = () => project.tracks.flatMap((t) => (t.kind === 'voice' ? t.clips : t.placements).map((x) => keyOf(t.id, x.id)));

  // A copy of a block at `start` (a placement of the same clip; a recording sharing its
  // audio): nothing big is duplicated. Returns its key.
  function copyBlock(b: Block, start: number): string {
    if (b.track.kind === 'voice') {
      const c = b.item as VoiceClip;
      const id = crypto.randomUUID();
      b.track.clips.push({ ...c, id, start, edit: c.edit && { ...c.edit } });
      return keyOf(b.track.id, id);
    }
    const p = b.item as Placement;
    return keyOf(b.track.id, addPlacement(b.track, p.clipId, start, p.length).id);
  }

  function deleteBlocks(blocks: Block[]) {
    for (const b of blocks) {
      if (b.track.kind === 'voice') b.track.clips = b.track.clips.filter((c) => c.id !== b.item.id);
      else removePlacement(b.track, b.item.id);
    }
    selected = new Set();
  }

  // ---------- Dragging blocks ----------
  // Moves every selected block together (by the clicked one's snapped move). Ctrl-drag:
  // copies stay where they were. The right edge: that block's length.
  function onBlockDown(e: PointerEvent, track: Track, id: string, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.stopPropagation();
    const key = keyOf(track.id, id);
    if (e.shiftKey && part === 'body') {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selected = next;
      return;
    }
    if (!selected.has(key)) select([key]);
    const clicked = blockOf(key);
    if (!clicked) return;
    const x0 = e.clientX;
    const blocks = part === 'body' ? selectedBlocks() : [clicked];
    const starts = blocks.map((b) => b.item.start);
    const origLength = blockLength(clicked);
    const origStart = clicked.item.start;
    const origOffset = (clicked.item as Placement).offset ?? 0;
    const origEdit = track.kind === 'voice' ? { ...((clicked.item as VoiceClip).edit ?? {}) } : {};
    const copy = e.ctrlKey || e.metaKey;
    let copied = false;
    const move = (ev: PointerEvent) => {
      const d = ticksAt(ev.clientX - x0);
      if (copy && !copied && Math.abs(ev.clientX - x0) > 3 && part === 'body') {
        copied = true;
        blocks.forEach((b, i) => copyBlock(b, starts[i]));
      }
      if (part === 'body') {
        // The clicked block snaps; the others move with it. (Found by id: the lists hold
        // separate objects for the same block.)
        const own = starts[blocks.findIndex((b) => b.item.id === clicked.item.id)] ?? clicked.item.start;
        const by = snap(own + d, ev) - own;
        if (!Number.isFinite(by)) return;
        const minStart = Math.min(...starts);
        const shift = Math.max(-minStart, by);
        blocks.forEach((b, i) => (b.item.start = starts[i] + shift));
      } else if (track.kind === 'voice') trimRecording(clicked.item as VoiceClip, part, d, ev, { origStart, origLength, origEdit });
      else if (part === 'end') (clicked.item as Placement).length = Math.max(beat, snap(origLength + d, ev) || beat);
      else {
        // Left edge: start later (or earlier) in the clip; the end stays put.
        const p = clicked.item as Placement;
        const start = Math.min(origStart + origLength - beat, snap(origStart + d, ev));
        const by = start - origStart;
        if (origStart + by < 0) return;
        Object.assign(p, { start, offset: origOffset + by, length: origLength - by });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }

  // A recording's edges: trim where it starts or ends playing (its audio is kept whole).
  // Reversed recordings play from their end, so their edges trim the other side.
  function trimRecording(
    c: VoiceClip,
    part: 'start' | 'end',
    d: number,
    ev: PointerEvent,
    o: { origStart: number; origLength: number; origEdit: NonNullable<VoiceClip['edit']> }
  ) {
    const full = c.audio.length / c.sampleRate;
    const speed = o.origEdit.speed ?? 1;
    const sec = (ticks: number) => ticksToSeconds(ticks, c.recordedBpm) * speed;
    const trimStart = o.origEdit.trimStart ?? 0;
    const trimEnd = o.origEdit.trimEnd ?? full;
    const MIN = 0.05;
    const e = (c.edit ??= {});
    if (part === 'end') {
      const length = Math.max(beat / 4, snap(o.origLength + d, ev));
      if (o.origEdit.reverse) e.trimStart = Math.max(0, Math.min(trimEnd - MIN, trimEnd - sec(length)));
      else e.trimEnd = Math.min(full, Math.max(trimStart + MIN, trimStart + sec(length)));
    } else {
      const start = Math.max(0, Math.min(o.origStart + o.origLength - beat / 4, snap(o.origStart + d, ev)));
      const by = sec(start - o.origStart);
      if (o.origEdit.reverse) {
        const next = Math.max(trimStart + MIN, Math.min(full, trimEnd - by));
        e.trimEnd = next;
        c.start = o.origStart + (trimEnd - next) / speed / ticksToSeconds(1, c.recordedBpm);
      } else {
        const next = Math.max(0, Math.min(trimEnd - MIN, trimStart + by));
        e.trimStart = next;
        c.start = o.origStart + (next - trimStart) / speed / ticksToSeconds(1, c.recordedBpm);
      }
    }
  }

  // Splits blocks (and recordings) at `tick`: each ends there, and a new one carries on.
  function splitAt(blocks: Block[], tick: number): string[] {
    const made: string[] = [];
    for (const b of blocks) {
      if (b.track.kind === 'voice') {
        const c = b.item as VoiceClip;
        const len = voiceLength(c);
        const at = tick - c.start;
        if (at <= 0 || at >= len) continue;
        const full = c.audio.length / c.sampleRate;
        const speed = c.edit?.speed ?? 1;
        const trimStart = c.edit?.trimStart ?? 0;
        const trimEnd = c.edit?.trimEnd ?? full;
        const cut = ticksToSeconds(at, c.recordedBpm) * speed;
        const second: VoiceClip = { ...c, id: crypto.randomUUID(), start: tick, edit: { ...c.edit } };
        if (c.edit?.reverse) {
          c.edit = { ...c.edit, trimStart: trimEnd - cut };
          second.edit = { ...second.edit, trimEnd: trimEnd - cut };
        } else {
          c.edit = { ...c.edit, trimEnd: trimStart + cut };
          second.edit = { ...second.edit, trimStart: trimStart + cut };
        }
        // Fades belong to the outer ends.
        if (c.edit) delete c.edit.fadeOut;
        if (second.edit) delete second.edit.fadeIn;
        b.track.clips.push(second);
        made.push(keyOf(b.track.id, second.id));
      } else {
        const p = b.item as Placement;
        const second = splitPlacement(p, tick, contentOf(b.track, p).length);
        if (!second) continue;
        b.track.placements.push(second);
        made.push(keyOf(b.track.id, second.id));
      }
    }
    return made;
  }

  // Keep only this take: the track's other recordings that overlap it are muted.
  function soloTake(track: Track, id: string) {
    if (track.kind !== 'voice') return;
    const me = track.clips.find((c) => c.id === id);
    if (!me) return;
    const end = me.start + voiceLength(me);
    for (const c of track.clips) {
      if (c === me) c.muted = false;
      else if (c.start < end && c.start + voiceLength(c) > me.start) c.muted = true;
    }
  }

  // Shift+drag on empty lanes: a box; every block it touches is selected (added to what's selected).
  let box = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  function startBox(e: PointerEvent) {
    const s = scroller!;
    const r = s.getBoundingClientRect();
    const at = (ev: PointerEvent) => ({ x: ev.clientX - r.left + s.scrollLeft, y: ev.clientY - r.top + s.scrollTop });
    const p0 = at(e);
    box = { x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y };
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      box = { ...box!, x1: p.x, y1: p.y };
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      const b = box!;
      box = null;
      const left = Math.min(b.x0, b.x1) + r.left - s.scrollLeft;
      const right = Math.max(b.x0, b.x1) + r.left - s.scrollLeft;
      const top = Math.min(b.y0, b.y1) + r.top - s.scrollTop;
      const bottom = Math.max(b.y0, b.y1) + r.top - s.scrollTop;
      const keys: string[] = [];
      for (const lane of s.querySelectorAll<SVGSVGElement>('svg[data-track]')) {
        const lr = lane.getBoundingClientRect();
        if (lr.bottom < top || lr.top > bottom) continue;
        const track = project.tracks.find((t) => t.id === lane.dataset.track);
        if (!track) continue;
        const from = ticksAt(left - lr.left);
        const to = ticksAt(right - lr.left);
        for (const item of track.kind === 'voice' ? track.clips : track.placements) {
          const len = blockLength({ track, item });
          if (item.start < to && item.start + len > from) keys.push(keyOf(track.id, item.id));
        }
      }
      select(keys, true);
      void ev;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  // ---------- Copy and paste ----------
  let clipboard: { trackId: string; offset: number; block: Block }[] = [];
  function copySelected() {
    const blocks = selectedBlocks();
    const min = Math.min(...blocks.map((b) => b.item.start));
    clipboard = blocks.map((b) => ({ trackId: b.track.id, offset: b.item.start - min, block: { track: b.track, item: { ...b.item } } }));
  }
  function paste(at: number) {
    const keys = clipboard.filter((c) => project.tracks.some((t) => t.id === c.trackId)).map((c) => copyBlock(c.block, at + c.offset));
    select(keys);
  }

  function open(track: Track, clipId?: string) {
    selection.trackId = track.id;
    if (clipId && track.kind !== 'voice') track.current = clipId;
    view.main = 'editor';
  }

  // Click empty space in a lane: place the track's current clip there. Shift+drag: a
  // selection box instead.
  // Where on a lane the pointer is (ticks), measured from the lane itself: the element under
  // the pointer may be a bar line or a label, whose own offsets would be wrong.
  const laneTick = (e: MouseEvent, lane: Element) => ticksAt(e.clientX - lane.getBoundingClientRect().left);
  const currentOf = (track: MidiTrack | DrumTrack) => track.current ?? (track.kind === 'midi' ? track.clips[0]?.id : track.patterns[0]?.id);

  function onLaneDown(e: PointerEvent, track: Track) {
    if (e.button !== 0) return;
    if (e.shiftKey) return startBox(e);
    if (track.kind === 'voice') {
      selected = new Set();
      ui.message = 'Voice tracks hold recordings: select the track and press Record to add one';
      setTimeout(() => (ui.message = ''), 3000);
      return;
    }
    const lane = (e.currentTarget as Element) ?? (e.target as Element).closest('svg');
    const at = snap(laneTick(e, lane), e);
    const id = currentOf(track);
    if (!id) return;
    const p = addPlacement(track, id, at);
    select([keyOf(track.id, p.id)]);
    ghost = null;
  }

  // The ghost: what a click on empty space would place, and where (hovering a lane).
  let ghost = $state<{ trackId: string; tick: number } | null>(null);
  function onLaneMove(e: PointerEvent, track: Track) {
    if (track.kind === 'voice' || e.buttons || (e.target as Element).closest('[role=button]')) {
      ghost = null;
      return;
    }
    ghost = { trackId: track.id, tick: snap(laneTick(e, e.currentTarget as Element), e) };
  }

  function blockMenu(track: Track, id: string) {
    const block = blockOf(keyOf(track.id, id));
    const split = { label: 'Split at the playhead', shortcut: 'S', action: () => block && splitAt([block], playhead.cursor) };
    if (track.kind === 'voice') {
      const c = track.clips.find((k) => k.id === id)!;
      return [
        { label: 'Edit recording', action: () => open(track) },
        split,
        { label: 'Mute this take', checked: !!c.muted, action: () => (c.muted = !c.muted) },
        { label: 'Keep only this take (mute the ones it overlaps)', action: () => soloTake(track, id) },
        { separator: true },
        { label: 'Delete', danger: true, action: () => (track.clips = track.clips.filter((k) => k.id !== id)) }
      ];
    }
    const p = track.placements.find((k) => k.id === id)!;
    return [
      { label: 'Edit clip', action: () => open(track, p.clipId) },
      split,
      { label: 'Mute this block', checked: !!p.muted, action: () => (p.muted = !p.muted) },
      { label: 'Copy after it', action: () => addPlacement(track, p.clipId, p.start + lengthOf(track, p), p.length) },
      { label: 'Make unique', action: () => makeUnique(track, p.id) },
      ...(currentOf(track) && currentOf(track) !== p.clipId
        ? [
            { label: `Replace with “${contentOf(track, { id: '', clipId: currentOf(track)!, start: 0 }).name}”`, action: () => (p.clipId = currentOf(track)!) },
            { label: `Place “${contentOf(track, { id: '', clipId: currentOf(track)!, start: 0 }).name}” after it`, action: () => addPlacement(track, currentOf(track)!, p.start + lengthOf(track, p)) }
          ]
        : []),
      { label: 'Loop this block', action: () => (setLoop(p.start, p.start + lengthOf(track, p)), (project.loop!.enabled = true)) },
      { label: 'Length: one loop', disabled: p.length === undefined, action: () => (p.length = undefined) },
      { separator: true },
      { label: 'Delete', shortcut: 'Del', danger: true, action: () => removePlacement(track, p.id) }
    ];
  }

  function laneMenu(e: MouseEvent, track: Track) {
    if (track.kind === 'voice') return openMenu(e, [{ label: 'Edit recordings', action: () => open(track) }]);
    const at = snap(laneTick(e, e.currentTarget as Element));
    const current = track.kind === 'midi' ? track.clips.find((c) => c.id === track.current) : track.patterns.find((c) => c.id === track.current);
    openMenu(e, [
      { label: `Place “${current?.name ?? 'clip'}” here`, disabled: !current, action: () => current && addPlacement(track, current.id, at) },
      { label: track.kind === 'midi' ? 'New clip here' : 'New pattern here', action: () => addPlacement(track, newContent(track).id, at) },
      { label: 'Play from here', action: () => seek(at) }
    ]);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"], [role="slider"]')) return;
    if (!keysFor('playlist')) return; // another panel on screen was clicked last
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const blocks = selectedBlocks();
    let handled = true;
    if (mod && k === 'a') select(allKeys());
    else if (mod && k === 'c') copySelected();
    else if (mod && k === 'x') {
      copySelected();
      deleteBlocks(blocks);
    } else if (mod && k === 'v') paste(snap(playhead.cursor, { altKey: false }));
    else if (mod && k === 'd' && blocks.length) {
      // A copy of the selection right after it.
      const from = Math.min(...blocks.map((b) => b.item.start));
      const to = Math.max(...blocks.map((b) => b.item.start + blockLength(b)));
      select(blocks.map((b) => copyBlock(b, b.item.start + (to - from))));
    } else if ((k === 'delete' || k === 'backspace') && blocks.length) deleteBlocks(blocks);
    else if (k === 's' && !mod && blocks.length) select(splitAt(blocks, playhead.cursor), true);
    else if (k === 'escape') selected = new Set();
    else if ((k === 'arrowleft' || k === 'arrowright') && blocks.length) {
      const step = snapTo === 'bar' ? bar : snapTo === 'beat' ? beat : beat / 4;
      const by = k === 'arrowleft' ? -step : step;
      if (Math.min(...blocks.map((b) => b.item.start)) + by >= 0) for (const b of blocks) b.item.start += by;
    } else handled = false;
    if (handled) e.preventDefault();
  }

  // ---------- The loop region ----------
  const loop = $derived(project.loop ?? { start: 0, end: 4 * bar, enabled: false });
  function setLoop(start: number, end: number) {
    project.loop = { start: Math.max(0, Math.min(start, end)), end: Math.max(start, end), enabled: project.loop?.enabled ?? false };
  }

  // Drag on the loop strip: across empty space draws a new loop; the band moves it; its
  // ends resize it. Snaps to bars (Alt: beats).
  function onLoopDown(e: PointerEvent, part: 'new' | 'body' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    const at = (ev: PointerEvent) => snap(ticksAt(ev.clientX - r.left), ev);
    const t0 = at(e);
    const orig = { ...loop };
    const move = (ev: PointerEvent) => {
      const t = at(ev);
      if (part === 'new') setLoop(Math.min(t0, t), Math.max(t0, t, Math.min(t0, t) + (ev.altKey ? beat : bar)));
      else if (part === 'body') {
        const d = Math.max(-orig.start, t - t0);
        setLoop(orig.start + d, orig.end + d);
      } else if (part === 'start') setLoop(Math.min(t, orig.end - beat), orig.end);
      else setLoop(orig.start, Math.max(t, orig.start + beat));
    };
    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }

  function loopMenu(): MenuItem[] {
    return [
      { label: 'Loop on', checked: loop.enabled, action: () => (setLoop(loop.start, loop.end), (project.loop!.enabled = !loop.enabled)) },
      { label: 'Loop the whole song', action: () => setLoop(0, Math.max(bar, Math.ceil(songEnd / bar) * bar)) },
      { label: 'Play from the loop start', action: () => seek(loop.start) },
      { separator: true },
      { label: `Insert ${Math.round((loop.end - loop.start) / bar)} empty bar(s) at the loop start`, action: () => insertTime(loop.start, loop.end - loop.start) },
      { label: "Delete the loop region's bars (everything after moves up)", danger: true, action: () => deleteTime(loop.start, loop.end) }
    ];
  }

  // ---------- Markers ----------
  // Named places in the song, on the ruler: click one to move the playhead there, drag it to
  // move it, right-click for rename / delete.
  function onMarkerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const m = project.markers.find((k) => k.id === id);
    if (!m) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (moved) m.tick = snap(ticksAt(ev.clientX - r.left), ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener(
      'pointerup',
      () => {
        window.removeEventListener('pointermove', move);
        if (!moved) seek(m.tick);
        project.markers.sort((a, b) => a.tick - b.tick);
      },
      { once: true }
    );
  }

  function markerMenu(id: string): MenuItem[] {
    const m = project.markers.find((k) => k.id === id);
    if (!m) return [];
    return [
      { label: 'Play from here', action: () => seek(m.tick) },
      { label: 'Rename…', action: () => { const n = window.prompt('Marker name', m.name)?.trim(); if (n) m.name = n; } },
      { label: 'Delete marker', danger: true, action: () => removeMarker(m.id) }
    ];
  }

  function rulerMenu(e: MouseEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const at = snap(ticksAt(e.clientX - r.left), { altKey: false });
    const barStart = Math.floor(ticksAt(e.clientX - r.left) / bar) * bar;
    openMenu(e, [
      { label: 'Add a marker here', action: () => addMarker(at) },
      { label: 'Play from here', action: () => seek(at) },
      { separator: true },
      { label: `Insert an empty bar before bar ${barStart / bar + 1}`, action: () => insertTime(barStart, bar) },
      { label: `Delete bar ${barStart / bar + 1} (everything after moves up)`, danger: true, action: () => deleteTime(barStart, barStart + bar) }
    ]);
  }

  // Ruler: click or drag to move the playhead.
  function onRuler(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    if (e.clientY - r.top < LOOP_H) return onLoopDown(e, 'new');
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
    <!-- What clicking a lane places: pick any track's clip or pattern (it becomes that
         track's current one, and the track is selected). -->
    <label class="flex items-center gap-1" title="What clicking a track's lane places">
      Place
      <Dropdown
        value={placing}
        onchange={(v: string) => choosePlacing(v)}
        ariaLabel="What to place"
        placeholder="Add a melody or drum track"
        options={placeOptions}
        class="h-7 max-w-56 text-xs"
      />
    </label>
    <Button
      size="sm"
      variant="outline"
      class="h-7 px-2 text-xs"
      disabled={!placingTrack}
      title="A new empty clip (or pattern) for this track, ready to place"
      onclick={() => placingTrack && (newContent(placingTrack), (selection.trackId = placingTrack.id))}>+ New</Button
    >
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
    <Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => (view.focusLane = addEmptyLane().id)} title="An empty automation lane: Ctrl+drag a knob onto it">+ Lane</Button>
    <div class="flex items-center gap-1">
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => (pxPerBeat = Math.max(4, pxPerBeat * 0.8))}>−</Button>
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => (pxPerBeat = Math.min(120, pxPerBeat * 1.25))}>+</Button>
    </div>
    <span class="text-muted-foreground">
      Click empty space in a lane to place (the dashed outline shows what) · drag to move, edge to lengthen (loops) · Ctrl-drag copies · double-click to edit
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
      <svg {width} height={RULER_H} class="block shrink-0 cursor-pointer select-none" role="presentation" onpointerdown={onRuler} oncontextmenu={rulerMenu}>
        {#each bars as b (b)}
          <line x1={x(b * bar)} x2={x(b * bar)} y1="0" y2={RULER_H} class="stroke-foreground/40" />
          {#if x(bar) >= 18 || b % 4 === 0}
            <text x={x(b * bar) + 3} y={LOOP_H + MARK_H + 13} class="fill-muted-foreground pointer-events-none text-[10px]">{b + 1}</text>
          {/if}
        {/each}
        <!-- The loop region: a band on the strip at the top (amber when the loop is on). -->
        <rect x="0" y="0" {width} height={LOOP_H} class="fill-muted/60" />
        <g use:contextMenu={loopMenu}>
          <rect
            x={x(loop.start)}
            y="0"
            width={Math.max(4, x(loop.end - loop.start))}
            height={LOOP_H}
            rx="2"
            class="cursor-grab {loop.enabled ? 'fill-amber-500/80' : 'fill-foreground/25'}"
            role="presentation"
            onpointerdown={(e) => onLoopDown(e, 'body')}
          />
          <rect x={x(loop.start) - 3} y="0" width="6" height={LOOP_H} class="cursor-ew-resize fill-transparent" role="presentation" onpointerdown={(e) => onLoopDown(e, 'start')} />
          <rect x={x(loop.end) - 3} y="0" width="6" height={LOOP_H} class="cursor-ew-resize fill-transparent" role="presentation" onpointerdown={(e) => onLoopDown(e, 'end')} />
        </g>
        <!-- Markers. -->
        {#each project.markers as m (m.id)}
          <g use:contextMenu={() => markerMenu(m.id)}>
            <line x1={x(m.tick)} x2={x(m.tick)} y1={LOOP_H} y2={RULER_H} class="pointer-events-none stroke-violet-500" />
            <rect
              x={x(m.tick)}
              y={LOOP_H + 1}
              width={Math.max(24, m.name.length * 5.6 + 8)}
              height={MARK_H - 2}
              rx="2"
              class="cursor-grab fill-violet-500/85 hover:fill-violet-500"
              role="button"
              tabindex="-1"
              aria-label="Marker {m.name}"
              onpointerdown={(e) => onMarkerDown(e, m.id)}
            />
            <text x={x(m.tick) + 4} y={LOOP_H + MARK_H - 3} class="pointer-events-none fill-white text-[9px] font-medium">{m.name}</text>
          </g>
        {/each}
        <polygon points="{x(playhead.cursor) - 6},{LOOP_H + MARK_H} {x(playhead.cursor) + 6},{LOOP_H + MARK_H} {x(playhead.cursor)},{LOOP_H + MARK_H + 9}" class="pointer-events-none fill-sky-500" />
        {#if playhead.running && playhead.ticks >= 0 && !playhead.pattern}
          <line x1={x(playhead.ticks)} x2={x(playhead.ticks)} y1="0" y2={RULER_H} class="pointer-events-none stroke-red-500" stroke-width="2" />
        {/if}
      </svg>
    </div>

    {#each project.tracks as track (track.id)}
      <div class="flex border-b" style="width: {HEAD_W + width}px">
        <!-- Lane header: stuck to the left. Click: select the track; double-click: edit it. -->
        <button
          class="bg-background sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r px-2 text-left {selection.trackId === track.id ? 'bg-muted' : ''} {placingTrack?.id === track.id ? 'border-l-4 border-l-amber-500' : ''}"
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
          data-track={track.id}
          onpointerdown={(e) => onLaneDown(e, track)}
          onpointermove={(e) => onLaneMove(e, track)}
          onpointerleave={() => (ghost = null)}
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
                  class="{KIND_FILL.voice} cursor-grab {isSelected(track.id, c.id) ? 'stroke-amber-400 opacity-100' : c.muted ? 'opacity-30' : 'opacity-80'}"
                  stroke-width="2"
                  role="button"
                  tabindex="-1"
                  aria-label="Recording"
                  onpointerdown={(e) => onBlockDown(e, track, c.id, 'body')}
                  ondblclick={() => open(track)}
                />
                <text x={bx + 4} y="16" class="pointer-events-none fill-white text-[10px]">{c.muted ? 'Muted take' : 'Recording'}</text>
                <!-- Edges: trim where it starts or ends. -->
                <rect x={bx - 2} y="4" width="7" height={LANE_H - 8} class="cursor-ew-resize fill-white/0 hover:fill-white/30" role="presentation" onpointerdown={(e) => onBlockDown(e, track, c.id, 'start')} />
                <rect x={bx + bw - 5} y="4" width="7" height={LANE_H - 8} class="cursor-ew-resize fill-white/0 hover:fill-white/30" role="presentation" onpointerdown={(e) => onBlockDown(e, track, c.id, 'end')} />
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
                  class="{KIND_FILL[track.kind]} cursor-grab {isSelected(track.id, p.id) ? 'stroke-amber-400 opacity-100' : p.muted ? 'opacity-30' : 'opacity-85'}"
                  stroke-width="2"
                  role="button"
                  tabindex="-1"
                  aria-label={info.name}
                  onpointerdown={(e) => onBlockDown(e, track, p.id, 'body')}
                  ondblclick={() => open(track, p.clipId)}
                />
                <!-- Loop marks where the clip repeats. -->
                {#each Array.from({ length: Math.max(0, Math.ceil((len + blockOffset(p, info.length)) / info.length)) }, (_, i) => (i + 1) * info.length - blockOffset(p, info.length)).filter((t) => t > 0 && t < len) as t (t)}
                  <line x1={bx + x(t)} x2={bx + x(t)} y1="6" y2={LANE_H - 6} class="pointer-events-none stroke-white/50" stroke-dasharray="2 2" />
                {/each}
                {#if track.kind === 'midi'}
                  {#each notePreview(track, p, bw) as n, i (i)}
                    <rect x={bx + n.x} y={n.y} width={n.w} height="2" class="pointer-events-none fill-white/80" />
                  {/each}
                {/if}
                <text x={bx + 4} y="14" class="pointer-events-none fill-white text-[10px]">{info.name}</text>
                <!-- Left edge: where it starts in the clip. Right edge: its length. -->
                <rect x={bx - 2} y="4" width="7" height={LANE_H - 8} class="cursor-ew-resize fill-white/0 hover:fill-white/30" role="presentation" onpointerdown={(e) => onBlockDown(e, track, p.id, 'start')} />
                <rect x={bx + bw - 6} y="4" width="8" height={LANE_H - 8} class="cursor-ew-resize fill-white/0 hover:fill-white/30" role="presentation" onpointerdown={(e) => onBlockDown(e, track, p.id, 'end')} />
              </g>
            {/each}
          {/if}

          {#if ghost?.trackId === track.id && track.kind !== 'voice'}
            {@const id = currentOf(track)}
            {@const info = id ? contentOf(track, { id: 'ghost', clipId: id, start: 0 }) : null}
            {#if info}
              <!-- What a click here would place. -->
              <rect x={x(ghost.tick)} y="4" width={Math.max(6, x(info.length))} height={LANE_H - 8} rx="4" class="pointer-events-none fill-foreground/5 stroke-foreground/40" stroke-dasharray="4 3" />
              <text x={x(ghost.tick) + 4} y="16" class="fill-muted-foreground pointer-events-none text-[10px]">+ {info.name}</text>
            {/if}
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

    {#if box}
      <div
        class="pointer-events-none absolute z-30 border border-sky-500 bg-sky-500/15"
        style="left: {Math.min(box.x0, box.x1)}px; top: {Math.min(box.y0, box.y1)}px; width: {Math.abs(box.x1 - box.x0)}px; height: {Math.abs(box.y1 - box.y0)}px"
      ></div>
    {/if}

    {#if project.automation.length}
      <div class="bg-muted/40 text-muted-foreground flex border-b text-[10px] font-semibold tracking-wide uppercase" style="width: {HEAD_W + width}px">
        <div class="bg-muted sticky left-0 z-10 shrink-0 border-r px-2 py-1" style="width: {HEAD_W}px">Automation</div>
      </div>
      {#each project.automation as lane (lane.id)}
        <AutomationLaneRow {lane} {width} headWidth={HEAD_W} bars={bars.map((b) => b * bar)} {x} {ticksAt} snap={snapPoint} />
      {/each}
    {/if}
  </div>
</div>

