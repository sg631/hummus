<!--
  The piano roll: a MIDI track's notes, time going right, pitch going up. Sing a sketch,
  then fix it here.

  Mouse
  - click empty space: add a note there (drag to size it)
  - click a note: select it (and hear it); Shift/Ctrl-click: add to or remove from the selection
  - Shift-drag on empty space: box-select, adding to what's already selected
  - drag a note: move the selection (snaps to the grid; hold Alt to move freely)
  - Ctrl-drag a note: copy it
  - drag a note's left or right edge: change where it starts or ends
  - right-click a note: delete it (and every other selected note, if it's selected);
    Alt+right-click: a menu of everything you can do to it
  - the ruler at the top (bar numbers): click or drag to move the playhead, where Play
    starts and Paste goes
  - keyboard on the left: hear a pitch
  - the lane at the bottom: Velocity (drag over the bars to set how hard notes play), or the
    clip's controller lanes: Bend (pitch bend, ±12 semitones over every note playing) and
    Mod (the mod wheel: a vibrato that deepens). Drag to draw them; right-click to clear
  - Ctrl + mouse wheel: zoom; hold the middle button (wheel) and drag: pan
  Keys: listed in SHORTCUTS below (and the "Keys" button).

  Every change goes through `checkpoint` first, so Ctrl+Z undoes it (state/history.svelte.ts).
  Editing a recorded clip by hand ends live re-quantizing for it (its `source` is dropped).
-->
<script module lang="ts">
  import { keysFor } from '$lib/state/layout.svelte';
  import { liveKeys } from '$lib/state/live-keys.svelte';
  import type { Copied } from '$lib/music/note-edit';
  // Copied notes, kept while switching tracks.
  let clipboard: Copied = [];
</script>

<script lang="ts">
  import Dropdown from './Dropdown.svelte';
  import { onMount } from 'svelte';
  import { Midi } from 'tonal';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { previewNote } from '$lib/audio/instruments';
  import { scalePitchClasses } from '$lib/music/key';
  import {
    absEnd,
    absStart,
    addNote,
    copiedLength,
    copyNotes,
    fitClip,
    nextAlternative,
    pasteNotes,
    placedNotes,
    quantizePlaced,
    removeNotes,
    setAbsStart,
    snapTo,
    type Placed
  } from '$lib/music/note-edit';
  import { rhythmBeat } from '$lib/music/rhythm';
  import { PPQ, barTicks, beatTicks, secondsToTicks, ticksToSeconds } from '$lib/music/time';
  import { bends, detuneAt } from '$lib/music/note-expression';
  import ExpressionPanel from './ExpressionPanel.svelte';
  import type { MidiTrack, NoteClip } from '$lib/music/types';
  import { checkpoint, dropCheckpoint, history, redo, undo } from '$lib/state/history.svelte';
  import { playhead, seek } from '$lib/state/playhead.svelte';
  import { openMenu, type MenuItem } from '$lib/state/context-menu.svelte';
  import { recorder } from '$lib/state/recorder.svelte';
  import { view } from '$lib/state/view.svelte';
  import { recordingSettings } from '$lib/state/settings.svelte';
  import { takeFor } from '$lib/state/takes.svelte';
  import { addVoiceClip, addVoiceTrack, cloneContent, deleteContent, newContent, recordIntoClip } from '$lib/state/project.svelte';
  import { contentLength, expandPlacements } from '$lib/music/arrange';
  import { applyShifts } from '$lib/music/shift-keys';
  import { encodeTake, takeToClip } from '$lib/transcription';
  import { downloadBlob } from '$lib/download';
  import { tracksToMidi } from '$lib/music/midi';
  import { project, selection, trackPreset } from '$lib/state/project.svelte';
  import QuantizePanel from './QuantizePanel.svelte';

  let { track }: { track: MidiTrack } = $props();

  // ---------- Layout ----------
  const HIGH = 108; // C8, the top row
  const LOW = 24; // C1, the bottom row
  const ROW = 12; // pixels per semitone
  const KEYS_W = 48; // the keyboard on the left
  const VEL_H = 64; // the velocity lane
  const RULER_H = 22; // bar numbers along the top
  const BLACK = [1, 3, 6, 8, 10];

  const SNAPS = [
    { label: '1/4', ticks: PPQ },
    { label: '1/8', ticks: PPQ / 2 },
    { label: '1/16', ticks: PPQ / 4 },
    { label: '1/32', ticks: PPQ / 8 },
    { label: '1/8 triplet', ticks: PPQ / 3 },
    { label: '1/16 triplet', ticks: PPQ / 6 },
    { label: 'Off', ticks: 0 }
  ];

  const SHORTCUTS: [string, string][] = [
    ['Click / Shift-drag', 'Add a note / Box-select (adds to the selection)'],
    ['Right-click / Alt+right-click', 'Delete note (all selected) / Note menu'],
    ['Home', 'Playhead to the start'],
    ['Delete', 'Delete selected notes'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo (also Ctrl+Y)'],
    ['Ctrl+A / Esc', 'Select all / Deselect'],
    ['Ctrl+C / X / V', 'Copy / Cut / Paste (at the playhead)'],
    ['Ctrl+D', 'Duplicate selection after itself'],
    ['↑ / ↓', 'Transpose a semitone (Shift: an octave)'],
    ['← / →', 'Move by the grid (Shift: a bar)'],
    ['Q', 'Quantize selection to the grid'],
    ['A', 'Swap to the other pitch it might have been'],
    ['P', 'Show / hide pitch lines (slides, vibrato)'],
    ['= / −', 'Zoom in / out'],
    ['Space', 'Play / Stop'],
    ['Middle-drag', 'Pan around (hold the wheel and drag)'],
    ['Ctrl + wheel', 'Zoom']
  ];

  let pxPerBeat = $state(80); // horizontal zoom: pixels per quarter note
  let grid = $state(PPQ / 4); // snap, ticks (0: off)
  let noteLength = $state(PPQ / 2); // new notes get the last length you set
  let showKeys = $state(false);
  let showPitch = $state(true); // draw each note's pitch line (slides, vibrato…)

  // ticks ↔ x, pitch ↔ y. All position maths goes through these.
  const x = (ticks: number) => (ticks / PPQ) * pxPerBeat;
  const ticksAt = (px: number) => (px / pxPerBeat) * PPQ;
  const y = (pitch: number) => (HIGH - pitch) * ROW;
  const pitchAt = (py: number) => Math.max(LOW, Math.min(HIGH, HIGH - Math.floor(py / ROW)));
  const name = (pitch: number) => Midi.midiToNoteName(pitch);

  // The clip being edited (a track's clips are placed in the song by the Playlist). The
  // roll shows it from its own start: bar 1 here is wherever each placement starts.
  const clip = $derived(track.clips.find((c) => c.id === track.current) ?? track.clips[0]);
  const clipList = $derived(clip ? [clip] : []); // for the note-edit helpers (clip.start is 0)
  // Where this clip first plays in the song: the ruler and Paste work in song time from it.
  const origin = $derived(track.placements.filter((pl) => pl.clipId === clip?.id).reduce((m, pl) => Math.min(m, pl.start), Infinity));
  const originTicks = $derived(Number.isFinite(origin) ? origin : 0);
  const cursor = $derived(playhead.cursor - originTicks); // the start/paste point, in clip time
  // The playhead in clip time, while this clip is playing somewhere in the song.
  const localPlayhead = $derived.by(() => {
    if (!playhead.running || playhead.ticks < 0 || !clip) return -1;
    // Pattern mode: the playhead already counts in the looping clip (if it's this one).
    if (playhead.pattern) return playhead.pattern.trackId === track.id && playhead.pattern.clipId === clip.id ? playhead.ticks : -1;
    const content = contentLength(clip.duration, bar);
    for (const pl of track.placements) {
      if (pl.clipId !== clip.id) continue;
      const len = pl.length ?? content;
      if (playhead.ticks >= pl.start && playhead.ticks < pl.start + len) return (playhead.ticks - pl.start) % content;
    }
    return -1;
  });
  const placed = $derived(placedNotes(clipList));
  const selected = $derived(new Set(selection.noteIds));
  const chosen = $derived(placed.filter((p) => selected.has(p.note.id)));

  // Each note's pitch line: how it bends while playing (the same function playback uses).
  // Points every few pixels; y moves a row per semitone.
  const pitchLines = $derived.by(() => {
    if (!showPitch) return [];
    const sorted = [...placed].sort((a, b) => absStart(a) - absStart(b));
    return sorted.flatMap((p, i) => {
      if (!bends(p.note)) return [];
      const seconds = ticksToSeconds(p.note.duration, project.bpm);
      const startX = x(absStart(p));
      const centre = y(p.note.pitch) + ROW / 2;
      const steps = Math.max(2, Math.ceil(x(p.note.duration) / 3));
      const points: string[] = [];
      for (let k = 0; k <= steps; k++) {
        const t = (k / steps) * seconds;
        const cents = detuneAt(p.note, t, seconds, sorted[i - 1]?.note.pitch);
        points.push(`${(startX + x(secondsToTicks(t, project.bpm))).toFixed(1)},${(centre - (cents / 100) * ROW).toFixed(1)}`);
      }
      return [{ id: p.note.id, points: points.join(' ') }];
    });
  });
  const bar = $derived(barTicks(project.timeSignature));
  const songEnd = $derived(Math.max(0, ...placed.map(absEnd)));
  const width = $derived(Math.max(1200, x(songEnd + bar * 4)));
  const height = (HIGH - LOW + 1) * ROW;
  const pitches = Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i);
  const inKey = $derived(scalePitchClasses(project.key, project.scale));

  // Grid lines: every grid step faintly, beats, then bars darker.
  const beatLen = $derived(rhythmBeat(project.timeSignature));
  const lines = $derived.by(() => {
    const step = grid > 0 && x(grid) >= 6 ? grid : beatLen;
    const out: { x: number; kind: 'bar' | 'beat' | 'sub' }[] = [];
    for (let t = 0; t <= ticksAt(width); t += step) {
      out.push({ x: x(t), kind: t % bar === 0 ? 'bar' : t % beatLen === 0 ? 'beat' : 'sub' });
    }
    return out;
  });

  let scroller: HTMLDivElement;
  let roll: SVGSVGElement;
  let ruler: SVGSVGElement;
  let lane = $state<SVGSVGElement>(null!); // the bottom lane (velocity, or a controller lane)

  // ---------- Small helpers ----------

  function point(e: MouseEvent, el: Element = roll) {
    const r = el.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  function select(ids: string[]) {
    selection.noteIds = ids;
  }

  function preview(pitch: number) {
    previewNote($state.snapshot(trackPreset(track)), pitch + project.transpose + project.detune / 100);
  }

  // After an edit by hand: clips grow to fit, and recorded clips stop re-quantizing.
  function edited(clips: Iterable<NoteClip> = clipList) {
    for (const clip of clips) {
      fitClip(clip);
      clip.source = undefined;
    }
  }

  const g = (e?: { altKey: boolean }) => (e?.altKey ? 0 : grid); // Alt: no snapping
  const minLength = (e?: { altKey: boolean }) => Math.max(10, g(e) || 10);

  // ---------- Dragging ----------

  type Drag =
    | { kind: 'move'; grab: Placed; px: number; py: number; orig: { p: Placed; start: number; pitch: number }[]; changed: boolean; copy: boolean; wasSelected: boolean; pitch: number }
    | { kind: 'end' | 'start'; grab: Placed; px: number; orig: { p: Placed; start: number; dur: number }[]; changed: boolean }
    | { kind: 'box'; px: number; py: number; x2: number; y2: number; base: string[] }
    | { kind: 'draw'; p: Placed; start: number; px: number; moved: boolean }
    | { kind: 'velocity'; changed: boolean };
  let drag: Drag | null = null; // plain, not $state: it holds the notes being dragged
  let box = $state<{ x1: number; y1: number; x2: number; y2: number } | null>(null); // drawn while box-selecting

  function startDrag(d: Drag) {
    drag = d;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function onNoteDown(e: PointerEvent, p: Placed, part: 'body' | 'start' | 'end') {
    if (e.button === 1) return; // middle button: let it pan
    e.stopPropagation();
    if (e.button === 2) return; // right-click: handled by oncontextmenu (delete)
    const id = p.note.id;
    const toggle = e.shiftKey || ((e.ctrlKey || e.metaKey) && part !== 'body');
    if (toggle) {
      select(selected.has(id) ? selection.noteIds.filter((n) => n !== id) : [...selection.noteIds, id]);
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const wasSelected = selected.has(id);
    // Ctrl adds the note to the selection (a Ctrl-click without dragging takes it out again).
    if (!wasSelected) select(ctrl ? [...selection.noteIds, id] : [id]);
    preview(p.note.pitch);

    const group = placed.filter((q) => selection.noteIds.includes(q.note.id));
    const { px, py } = point(e);
    if (part === 'body') {
      checkpoint(track, ctrl ? 'Copy notes' : 'Move notes');
      startDrag({
        kind: 'move', grab: p, px, py, changed: false, copy: ctrl, wasSelected, pitch: p.note.pitch,
        orig: group.map((q) => ({ p: q, start: absStart(q), pitch: q.note.pitch }))
      });
    } else {
      checkpoint(track, 'Change length');
      startDrag({ kind: part, grab: p, px, changed: false, orig: group.map((q) => ({ p: q, start: absStart(q), dur: q.note.duration })) });
    }
  }

  // Right-click a note: delete it, or all the selected notes if it's one of them.
  // Alt+right-click: a menu for it (and the rest of the selection, if it's selected).
  function onNoteContext(e: MouseEvent, p: Placed) {
    e.preventDefault();
    if (!e.altKey) {
      if (selected.has(p.note.id)) deleteSelected();
      else {
        checkpoint(track, 'Delete note');
        removeNotes(clipList, new Set([p.note.id]));
        edited([p.clip]);
      }
      return;
    }
    if (!selected.has(p.note.id)) select([p.note.id]);
    const legato = p.note.articulation?.kind === 'legato';
    openMenu(e, [
      { label: 'Delete', shortcut: 'Del', action: () => deleteSelected() },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: duplicate },
      { label: 'Cut', shortcut: 'Ctrl+X', action: () => { copySelected(); deleteSelected('Cut'); } },
      { label: 'Copy', shortcut: 'Ctrl+C', action: copySelected },
      { separator: true },
      { label: 'Up an octave', shortcut: 'Shift+↑', action: () => transpose(12) },
      { label: 'Down an octave', shortcut: 'Shift+↓', action: () => transpose(-12) },
      { label: 'Quantize to grid', shortcut: 'Q', disabled: grid <= 0, action: quantizeSelection },
      { label: 'Other pitch it might be', shortcut: 'A', disabled: !p.note.alternatives?.length, action: alternatives },
      { separator: true },
      { label: 'Legato into the next', checked: legato, action: () => setLegato(!legato) },
      { label: 'Flatten bends', action: flatten },
      { label: 'Hear it', action: () => preview(p.note.pitch) }
    ]);
  }

  function setLegato(on: boolean) {
    checkpoint(track, 'Legato');
    for (const q of chosen) q.note.articulation = { accent: false, accentDb: 0, ...q.note.articulation, kind: on ? 'legato' : 'normal' };
    edited(new Set(chosen.map((q) => q.clip)));
  }

  function flatten() {
    checkpoint(track, 'Flatten');
    for (const q of chosen) q.note.expression = { bend: 0 };
    edited(new Set(chosen.map((q) => q.clip)));
  }

  // Right-click empty space or the ruler.
  function onBackgroundContext(e: MouseEvent, el: Element) {
    const at = Math.max(0, snapTo(ticksAt(point(e, el).px), grid || beatLen));
    const items: MenuItem[] = [
      { label: 'Paste here', shortcut: 'Ctrl+V', disabled: !clipboard.length, action: () => paste(at) },
      { label: 'Play from here', action: () => seek(originTicks + at) },
      { label: 'Playhead to the start', shortcut: 'Home', action: () => seek(0) },
      { separator: true },
      { label: 'Select all', shortcut: 'Ctrl+A', action: () => select(placed.map((q) => q.note.id)) },
      { label: 'Deselect', shortcut: 'Esc', disabled: !chosen.length, action: () => select([]) },
      { separator: true },
      { label: 'Zoom in', shortcut: '=', action: () => zoom(1.25) },
      { label: 'Zoom out', shortcut: '−', action: () => zoom(0.8) }
    ];
    openMenu(e, items);
  }

  // ---------- The last take (kept in memory while the app is open) ----------
  const take = $derived(takeFor(track.id));

  // Transcribes the take again with the settings now in Settings → Transcription (e.g.
  // after changing note detection or expression). Undoable.
  function redoTake() {
    if (!take) return;
    checkpoint(track, 'Redo transcription');
    const clip = takeToClip(take.take, take.bpm, take.timeSignature, $state.snapshot(recordingSettings.take));
    applyShifts(clip, take.shifts, take.bpm);
    recordIntoClip(track.id, clip); // into the clip being edited
    select([]);
  }

  // The recording itself on a voice track, to hear under (or instead of) the notes.
  function voiceAsTrack() {
    if (!take) return;
    const id = track.id;
    const voice = addVoiceTrack(`${track.name} (voice)`);
    addVoiceClip(voice.id, { id: crypto.randomUUID(), start: 0, audio: take.take.audio, sampleRate: take.take.sampleRate, recordedBpm: take.bpm });
    selection.trackId = id; // stay here
  }

  // The take as a file, to replay as a transcription test (transcription/takes/).
  function saveTake() {
    if (!take) return;
    const file = encodeTake(take.take.audio, take.take.sampleRate, take.bpm, take.timeSignature);
    downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `take-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  }

  function exportMidi() {
    const placedClips = expandPlacements($state.snapshot(track.clips), $state.snapshot(track.placements), bar);
    downloadBlob(tracksToMidi([{ name: track.name, clips: placedClips }], project.bpm, project.timeSignature), `${track.name}.mid`);
  }

  // ---------- Pitch lines of what was heard ----------
  // The take's pitch as transcription heard it, frame by frame: a line broken at gaps.
  const GAP_TICKS = 60;
  function heardLines(ticks: number[], midi: number[], offset: number): string[] {
    const lines: string[] = [];
    let points: string[] = [];
    for (let i = 0; i < ticks.length; i++) {
      if (i > 0 && ticks[i] - ticks[i - 1] > GAP_TICKS) {
        if (points.length > 1) lines.push(points.join(' '));
        points = [];
      }
      points.push(`${x(offset + ticks[i]).toFixed(1)},${((HIGH - midi[i]) * ROW + ROW / 2).toFixed(1)}`);
    }
    if (points.length > 1) lines.push(points.join(' '));
    return lines;
  }
  const heard = $derived(
    showPitch ? clipList.flatMap((c) => (c.pitchTrack ? heardLines(c.pitchTrack.ticks, c.pitchTrack.midi, c.start) : [])) : []
  );
  // While recording into this track: the pitch being heard, live.
  const live = $derived.by(() => {
    if (!recorder.recording || selection.trackId !== track.id || !recorder.live) return [];
    const { times, hz, prob } = recorder.live.track;
    const ticks: number[] = [];
    const midi: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (hz[i] <= 0 || prob[i] < 0.5) continue;
      ticks.push(secondsToTicks(times[i], project.bpm));
      midi.push(69 + 12 * Math.log2(hz[i] / 440));
    }
    return heardLines(ticks, midi, 0);
  });

  // Adds a note where the pointer is and starts sizing it.
  function drawAt(e: PointerEvent | MouseEvent, sizing: boolean) {
    const { px, py } = point(e);
    const step = g(e);
    const start = Math.max(0, step > 1 ? Math.floor(ticksAt(px) / step) * step : Math.round(ticksAt(px)));
    checkpoint(track, 'Add note');
    const note = addNote(clipList, { pitch: pitchAt(py), start, duration: noteLength, velocity: 0.8 });
    const p = placedNotes(clipList).find((q) => q.note.id === note.id)!;
    edited([p.clip]);
    select([note.id]);
    preview(note.pitch);
    if (sizing) startDrag({ kind: 'draw', p, start, px, moved: false });
  }

  // Empty space: a click adds a note; Shift-drag draws a selection box.
  function onBackgroundDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault(); // no focus change (which can scroll the page)
    if (!e.shiftKey) return drawAt(e, true);
    const { px, py } = point(e);
    // Adds to what's already selected (Esc deselects).
    startDrag({ kind: 'box', px, py, x2: px, y2: py, base: [...selection.noteIds] });
    box = { x1: px, y1: py, x2: px, y2: py };
  }

  // ---------- Ruler: move the playhead ----------

  function onRulerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const to = (ev: PointerEvent) => seek(originTicks + snapTo(ticksAt(point(ev, ruler).px), grid || beatLen));
    to(e);
    const up = () => window.removeEventListener('pointermove', to);
    window.addEventListener('pointermove', to);
    window.addEventListener('pointerup', up, { once: true });
  }

  // Bar numbers along the ruler.
  const bars = $derived(Array.from({ length: Math.ceil(ticksAt(width) / bar) + 1 }, (_, i) => i));

  function onMove(e: PointerEvent) {
    if (!drag) return;
    if (drag.kind === 'velocity') return paintVelocity(e);
    const { px, py } = point(e);

    if (drag.kind === 'box') {
      drag.x2 = px;
      drag.y2 = py;
      box = { x1: drag.px, y1: drag.py, x2: px, y2: py };
      const [x1, x2] = [Math.min(drag.px, px), Math.max(drag.px, px)];
      const [y1, y2] = [Math.min(drag.py, py), Math.max(drag.py, py)];
      const inside = placed
        .filter((p) => x(absEnd(p)) >= x1 && x(absStart(p)) <= x2 && y(p.note.pitch) + ROW >= y1 && y(p.note.pitch) <= y2)
        .map((p) => p.note.id);
      select([...new Set([...drag.base, ...inside])]);
      return;
    }

    // Placing a note: its end follows the pointer (covering the grid cell under it). A
    // click without dragging keeps the last length used.
    if (drag.kind === 'draw') {
      if (!drag.moved && Math.abs(px - drag.px) < 3) return;
      drag.moved = true;
      const step = g(e);
      const end = step > 1 ? Math.ceil(ticksAt(px) / step) * step : Math.round(ticksAt(px));
      drag.p.note.duration = Math.max(minLength(e), end - drag.start);
      noteLength = drag.p.note.duration;
      return;
    }

    const dTicks = ticksAt(px - drag.px);
    const grabId = drag.grab.note.id;
    if (drag.kind === 'move') {
      if (!drag.changed && Math.abs(px - drag.px) < 3 && Math.abs(py - drag.py) < 3) return; // not a drag yet
      if (drag.copy && !drag.changed) {
        // Ctrl-drag: leave copies where the notes were, and move these.
        pasteNotes(clipList, copyNotes(drag.orig.map((o) => o.p)), Math.min(...drag.orig.map((o) => o.start)));
      }
      const grabbed = drag.orig.find((o) => o.p.note.id === grabId)!;
      let delta = snapTo(grabbed.start + dTicks, g(e)) - grabbed.start;
      delta = Math.max(delta, -Math.min(...drag.orig.map((o) => o.start)));
      let dPitch = -Math.round((py - drag.py) / ROW);
      dPitch = Math.min(dPitch, HIGH - Math.max(...drag.orig.map((o) => o.pitch)));
      dPitch = Math.max(dPitch, LOW - Math.min(...drag.orig.map((o) => o.pitch)));
      for (const o of drag.orig) {
        setAbsStart(o.p, o.start + delta);
        o.p.note.pitch = o.pitch + dPitch;
      }
      drag.changed = true;
      if (drag.grab.note.pitch !== drag.pitch) {
        drag.pitch = drag.grab.note.pitch;
        preview(drag.pitch);
      }
    } else {
      const grabbed = drag.orig.find((o) => o.p.note.id === grabId)!;
      const min = minLength(e);
      if (drag.kind === 'end') {
        const delta = snapTo(grabbed.start + grabbed.dur + dTicks, g(e)) - (grabbed.start + grabbed.dur);
        for (const o of drag.orig) o.p.note.duration = Math.max(min, o.dur + delta);
        noteLength = drag.grab.note.duration;
      } else {
        const delta = snapTo(grabbed.start + dTicks, g(e)) - grabbed.start;
        for (const o of drag.orig) {
          const end = o.start + o.dur;
          const start = Math.max(0, Math.min(end - min, o.start + delta));
          setAbsStart(o.p, start);
          o.p.note.duration = end - start;
        }
      }
      drag.changed = true;
    }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    const d = drag;
    drag = null;
    box = null;
    if (!d) return;
    if (d.kind === 'box') return; // the selection was updated while dragging
    if (d.kind === 'draw') {
      edited([d.p.clip]); // the clip grows to fit the new length
      return;
    }
    if (!d.changed) {
      dropCheckpoint();
      // Ctrl-click without dragging on a note that was selected: take it out.
      if (d.kind === 'move' && d.copy && d.wasSelected) select(selection.noteIds.filter((n) => n !== d.grab.note.id));
      return;
    }
    // (Velocity too: re-quantizing rebuilds notes from the take, which would undo it.)
    edited(d.kind === 'velocity' ? clipList : new Set(d.orig.map((o) => o.p.clip)));
  }

  // ---------- Controller lanes: pitch bend, mod wheel ----------
  let laneMode = $state<'velocity' | 'bend' | 'mod'>('velocity');
  const CTL_STEP = 30; // ticks between drawn points
  const ctlRange = (mode: 'bend' | 'mod') => (mode === 'bend' ? { min: -12, max: 12 } : { min: 0, max: 1 });
  const ctlY = (mode: 'bend' | 'mod', v: number) => {
    const r = ctlRange(mode);
    return 2 + (1 - (v - r.min) / (r.max - r.min)) * (VEL_H - 4);
  };
  const ctlLine = $derived.by(() => {
    if (laneMode === 'velocity') return '';
    const pts = clip?.controllers?.[laneMode] ?? [];
    if (!pts.length) return '';
    const mode = laneMode;
    return [`0,${ctlY(mode, pts[0].value)}`, ...pts.map((p) => `${x(p.tick)},${ctlY(mode, p.value)}`), `${width},${ctlY(mode, pts[pts.length - 1].value)}`].join(' ');
  });

  // Drawing a controller lane: each move writes the value under the pointer, replacing the
  // points it passes over.
  function onControllerDown(e: PointerEvent, mode: 'bend' | 'mod') {
    if (e.button !== 0 || !clip) return;
    checkpoint(track, mode === 'bend' ? 'Pitch bend' : 'Mod wheel');
    const target = clip;
    const r = ctlRange(mode);
    let last: number | null = null;
    const write = (ev: PointerEvent) => {
      const { px, py } = point(ev, lane);
      const tick = Math.max(0, Math.round(ticksAt(px) / CTL_STEP) * CTL_STEP);
      const raw = r.max - ((py - 2) / (VEL_H - 4)) * (r.max - r.min);
      const value = Math.round(Math.max(r.min, Math.min(r.max, raw)) * (mode === 'bend' ? 10 : 100)) / (mode === 'bend' ? 10 : 100);
      target.controllers ??= {};
      const pts = target.controllers[mode] ?? [];
      // Replace what lies between the last point written (kept) and this one.
      const lo = Math.min(last ?? tick, tick);
      const hi = Math.max(last ?? tick, tick);
      const between = (t: number) => t === tick || (t > lo && t < hi);
      target.controllers[mode] = [...pts.filter((p) => !between(p.tick)), { tick, value }].sort((a, b) => a.tick - b.tick);
      last = tick;
    };
    write(e);
    window.addEventListener('pointermove', write);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', write), { once: true });
  }

  function controllerMenu(e: MouseEvent, mode: 'bend' | 'mod') {
    openMenu(e, [
      {
        label: mode === 'bend' ? 'Clear the pitch bend' : 'Clear the mod wheel',
        disabled: !clip?.controllers?.[mode]?.length,
        action: () => {
          if (!clip?.controllers) return;
          checkpoint(track, 'Clear controller');
          clip.controllers[mode] = [];
        }
      }
    ]);
  }

  // ---------- Velocity lane ----------

  function onLaneDown(e: PointerEvent) {
    if (e.button !== 0) return;
    checkpoint(track, 'Velocity');
    startDrag({ kind: 'velocity', changed: false });
    paintVelocity(e);
  }

  // Sets the velocity of the notes under the pointer (only selected ones, if any are).
  function paintVelocity(e: PointerEvent) {
    if (drag?.kind !== 'velocity') return;
    const { px, py } = point(e, lane);
    const t = ticksAt(px);
    const tolerance = ticksAt(4);
    const velocity = Math.max(0.05, Math.min(1, 1 - py / VEL_H));
    for (const p of placed) {
      if (selected.size && !selected.has(p.note.id)) continue;
      if (t >= absStart(p) - tolerance && t <= Math.max(absEnd(p), absStart(p) + tolerance)) {
        p.note.velocity = Math.round(velocity * 100) / 100;
        drag.changed = true;
      }
    }
  }

  // The selected notes' velocity (their average), for the knob.
  const chosenVelocity = $derived(chosen.length ? chosen.reduce((s, p) => s + p.note.velocity, 0) / chosen.length : 0);
  function setChosenVelocity(v: number) {
    checkpoint(track, 'Velocity', 'velocity-knob');
    for (const p of chosen) p.note.velocity = v;
    edited(new Set(chosen.map((p) => p.clip)));
  }

  // ---------- Keyboard shortcuts ----------

  function deleteSelected(label = 'Delete notes') {
    if (!chosen.length) return;
    checkpoint(track, label);
    removeNotes(clipList, selected);
    select([]);
  }

  function copySelected() {
    clipboard = copyNotes(chosen);
  }

  function paste(at: number) {
    if (!clipboard.length) return;
    checkpoint(track, 'Paste');
    const notes = pasteNotes(clipList, clipboard, at);
    edited();
    select(notes.map((n) => n.id));
    seek(originTicks + at + copiedLength(clipboard)); // pasting again continues after it
  }

  function duplicate() {
    if (!chosen.length) return;
    const first = Math.min(...chosen.map(absStart));
    const span = Math.max(...chosen.map(absEnd)) - first;
    const unit = grid || beatTicks(project.timeSignature);
    clipboard = copyNotes(chosen);
    paste(first + Math.ceil(span / unit) * unit);
  }

  function transpose(by: number) {
    const targets = chosen;
    if (!targets.length) return;
    const top = Math.max(...targets.map((p) => p.note.pitch));
    const bottom = Math.min(...targets.map((p) => p.note.pitch));
    if (top + by > HIGH || bottom + by < LOW) return;
    checkpoint(track, 'Transpose', 'transpose');
    for (const p of targets) p.note.pitch += by;
    edited(new Set(targets.map((p) => p.clip)));
    preview(targets[0].note.pitch);
  }

  function nudge(by: number) {
    if (!chosen.length || Math.min(...chosen.map(absStart)) + by < 0) return;
    checkpoint(track, 'Move notes', 'nudge');
    for (const p of chosen) setAbsStart(p, absStart(p) + by);
    edited(new Set(chosen.map((p) => p.clip)));
  }

  function quantizeSelection() {
    const targets = chosen.length ? chosen : placed;
    if (!targets.length || grid <= 0) return;
    checkpoint(track, 'Quantize');
    quantizePlaced(targets, grid);
    edited(new Set(targets.map((p) => p.clip)));
  }

  function alternatives() {
    const targets = chosen.filter((p) => p.note.alternatives?.length);
    if (!targets.length) return;
    checkpoint(track, 'Swap pitch');
    for (const p of targets) nextAlternative(p.note);
    edited(new Set(targets.map((p) => p.clip)));
    preview(targets[0].note.pitch);
  }

  function zoom(factor: number) {
    pxPerBeat = Math.max(15, Math.min(400, pxPerBeat * factor));
  }

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    // Not while typing, turning a knob (arrow keys), on a wheel, or in a window.
    if (target.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="slider"], [role="listbox"]')) return;
    if (!keysFor('editor')) return; // another panel on screen was clicked last
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    // Ctrl+Z / Ctrl+Y: the app-wide undo (Menubar.svelte), for everything, not just notes.
    if (mod && key === 'a') select(placed.map((p) => p.note.id));
    else if (mod && key === 'c') copySelected();
    else if (mod && key === 'x') {
      copySelected();
      deleteSelected('Cut');
    } else if (mod && key === 'v') paste(Math.max(0, cursor));
    else if (mod && key === 'd') duplicate();
    else if (mod) handled = false;
    else if (key === 'delete' || key === 'backspace') deleteSelected();
    else if (key === 'escape') select([]);
    else if (key === 'arrowup') transpose(e.shiftKey ? 12 : 1);
    else if (key === 'arrowdown') transpose(e.shiftKey ? -12 : -1);
    else if (key === 'arrowright') nudge(e.shiftKey ? bar : grid || beatLen);
    else if (key === 'arrowleft') nudge(-(e.shiftKey ? bar : grid || beatLen));
    else if (key === 'q') quantizeSelection();
    else if (key === 'a') alternatives();
    else if (key === 'home') seek(0);
    else if (key === 'p') showPitch = !showPitch;
    else if (key === '=' || key === '+') zoom(1.25);
    else if (key === '-') zoom(0.8);
    else handled = false;
    if (handled) e.preventDefault();
  }

  // ---------- Scrolling ----------

  // Hold the middle button (wheel) and drag to pan around, like grabbing the page.
  let panning = $state(false);
  function onScrollerDown(e: PointerEvent) {
    if (e.button !== 1) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture(e.pointerId);
    panning = true;
    const move = (ev: PointerEvent) => {
      scroller.scrollLeft = start.left - (ev.clientX - start.x);
      scroller.scrollTop = start.top - (ev.clientY - start.y);
    };
    scroller.addEventListener('pointermove', move);
    scroller.addEventListener(
      'pointerup',
      () => {
        scroller.removeEventListener('pointermove', move);
        panning = false;
      },
      { once: true }
    );
  }

  onMount(() => {
    // Start with the notes (or middle C) in view.
    const pitchesInUse = placed.map((p) => p.note.pitch);
    const centre = pitchesInUse.length ? (Math.max(...pitchesInUse) + Math.min(...pitchesInUse)) / 2 : 60;
    scroller.scrollTop = y(centre) - scroller.clientHeight / 2;

    // Ctrl + wheel zooms (added by hand: it must be able to cancel the page's own zoom).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  });

  // While playing, keep the playhead in view.
  $effect(() => {
    if (localPlayhead < 0) return;
    const px = x(localPlayhead) + KEYS_W;
    if (px > scroller.scrollLeft + scroller.clientWidth - 40 || px < scroller.scrollLeft + KEYS_W) {
      scroller.scrollLeft = px - KEYS_W - 40;
    }
  });

  const single = $derived(chosen.length === 1 ? chosen[0] : null);
  const position = (ticks: number) => {
    const beat = beatTicks(project.timeSignature);
    return `${Math.floor(ticks / bar) + 1}.${Math.floor((ticks % bar) / beat) + 1}`;
  };
</script>

<svelte:window onkeydown={onKey} />

<div class="flex h-full flex-col">
  <!-- ---------- Toolbar ---------- -->
  <!-- One row that never changes height, so the notes below never jump. -->
  <div class="flex h-11 shrink-0 items-center gap-x-4 overflow-x-auto border-b px-3 text-xs whitespace-nowrap" data-guide="roll.toolbar">
    <!-- The clip being edited: pick, new, copy (make unique), rename, delete. -->
    <span class="flex items-center gap-1">
      <span class="font-semibold">Clip</span>
      <Dropdown
        class="max-w-40"
        bind:value={() => track.current ?? '', (v) => (track.current = v)}
        ariaLabel="Clip"
        title="The clip this piano roll edits (the Playlist places clips in the song)"
        options={track.clips.map((c) => ({ value: c.id, label: c.name ?? 'Clip' }))}
      />
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => newContent(track)} title="A new empty clip (place it in the Playlist)">+</Button>
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => clip && cloneContent(track, clip.id)} title="A copy of this clip, to change on its own">⧉</Button>
      <Button
        size="sm"
        variant="outline"
        class="h-7 px-2"
        onclick={() => {
          const name = clip && window.prompt('Clip name', clip.name ?? '');
          if (clip && name?.trim()) clip.name = name.trim();
        }}
        title="Rename this clip">✎</Button
      >
      <Button size="sm" variant="outline" class="h-7 px-2" disabled={track.clips.length <= 1} onclick={() => clip && deleteContent(track, clip.id)} title="Delete this clip (and its places in the Playlist)">✕</Button>
    </span>

    <button
      class="rounded-md border px-2 py-1"
      data-guide="roll.sheet"
      onclick={() => (view.sheet = true)}
      title="Show these notes as sheet music"
    >
      Sheet
    </button>

    <button
      class="rounded-md border px-2 py-1 {showPitch ? 'bg-primary text-primary-foreground' : ''}"
      onclick={() => (showPitch = !showPitch)}
      title="Show how each note bends (slides, vibrato) as a line (P)"
    >
      Pitch
    </button>

    <label class="flex items-center gap-1">
      Snap
      <Dropdown bind:value={grid} ariaLabel="Snap" options={SNAPS.map((s) => ({ value: s.ticks, label: s.label }))} />
    </label>

    <div class="flex items-center gap-1">
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => zoom(0.8)} title="Zoom out (−)">−</Button>
      <Button size="sm" variant="outline" class="h-7 px-2" onclick={() => zoom(1.25)} title="Zoom in (=)">+</Button>
    </div>

    <div class="flex items-center gap-1">
      <Button size="sm" variant="outline" class="h-7" disabled={!history.undoLabel} onclick={undo} title="Undo (Ctrl+Z)">
        ↶ {history.undoLabel ?? 'Undo'}
      </Button>
      <Button size="sm" variant="outline" class="h-7" disabled={!history.redoLabel} onclick={redo} title="Redo (Ctrl+Shift+Z)">
        ↷ {history.redoLabel ?? 'Redo'}
      </Button>
    </div>

    <div class="flex items-center gap-3">
      <span class="text-muted-foreground">
        {#if single}
          {@const it = single.note.interpretation}
          {name(single.note.pitch)} · bar {position(absStart(single))} · {single.note.duration} ticks
          {#if it && Math.abs(it.offsetCents) >= 15}· sung {it.offsetCents > 0 ? '+' : ''}{Math.round(it.offsetCents)}¢{/if}
          {#if it?.scoop}· scoop {it.scoop.cents > 0 ? '+' : ''}{it.scoop.cents}¢{/if}
          {#if it?.fall}· fall {it.fall.cents > 0 ? '+' : ''}{it.fall.cents}¢{/if}
          {#if it && Math.abs(it.driftCents) >= 30}· drift {it.driftCents > 0 ? '+' : ''}{Math.round(it.driftCents)}¢{/if}
          {#if single.note.alternatives?.length}· could be {single.note.alternatives.map(name).join(', ')} (A){/if}
        {:else if chosen.length}
          {chosen.length} notes
        {:else}
          Click to add a note · Shift-drag to select
        {/if}
      </span>
      {#if chosen.length}
        <Knob size={22} bind:value={() => chosenVelocity, setChosenVelocity} min={0.05} max={1} step={0.01} format={(v) => `vel ${Math.round(v * 100)}`} automate={false} />
      {/if}
    </div>

    <div class="relative ml-auto">
      <!-- The last take (this session): redo, keep the voice, save it. And MIDI. -->
      <span class="inline-flex gap-1">
        <Button size="sm" variant="outline" class="h-7" disabled={!take} onclick={redoTake} title="Transcribe the last take again with the settings in Settings → Transcription">↻ Redo take</Button>
        <Button size="sm" variant="outline" class="h-7" disabled={!take} onclick={voiceAsTrack} title="Put the recording itself on a voice track, to hear your voice too">+ Voice track</Button>
        <Button size="sm" variant="outline" class="h-7" disabled={!take} onclick={saveTake} title="Download the take (for transcription tests)">Save take</Button>
        <Button size="sm" variant="outline" class="h-7" disabled={!placed.length} onclick={exportMidi} title="Download this track's notes as a MIDI file">MIDI</Button>
      </span>
      <Button size="sm" variant="ghost" class="h-7" onclick={() => (showKeys = !showKeys)}>Keys</Button>
      {#if showKeys}
        <div class="bg-popover absolute top-8 right-0 z-30 w-80 rounded-md border p-3 shadow-lg">
          <table class="w-full">
            <tbody>
              {#each SHORTCUTS as [keys, what] (keys)}
                <tr><td class="py-0.5 pr-3 font-mono whitespace-nowrap">{keys}</td><td class="text-muted-foreground">{what}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>

  <div data-guide="roll.expression"><ExpressionPanel {track} placed={chosen} /></div>
  <div data-guide="roll.quantize"><QuantizePanel {track} /></div>

  <!-- ---------- Keyboard, notes and velocity, in one scrolling area ---------- -->
  <!-- Middle button: pan (and no browser autoscroll: its mousedown is cancelled). -->
  <div
    bind:this={scroller}
    class="relative min-h-0 flex-1 overflow-auto {panning ? 'cursor-grabbing' : ''}"
    role="presentation"
    onpointerdown={onScrollerDown}
    onmousedown={(e) => e.button === 1 && e.preventDefault()}
    onauxclick={(e) => e.button === 1 && e.preventDefault()}
  >
    <!-- Ruler: bar numbers, stuck to the top. Click or drag to move the playhead. -->
    <div class="bg-background sticky top-0 z-20 flex border-b" style="width: {KEYS_W + width}px">
      <div class="bg-background sticky left-0 z-10 shrink-0 border-r" style="width: {KEYS_W}px"></div>
      <svg bind:this={ruler} {width} height={RULER_H} class="block shrink-0 cursor-pointer touch-none select-none" role="presentation" onpointerdown={onRulerDown} oncontextmenu={(e) => onBackgroundContext(e, ruler)}>
        {#each lines as l (l.x)}
          {#if l.kind !== 'sub'}
            <line x1={l.x} x2={l.x} y1={l.kind === 'bar' ? 0 : RULER_H - 6} y2={RULER_H} class="stroke-foreground/40" />
          {/if}
        {/each}
        {#each bars as b (b)}
          <text x={x(b * bar) + 3} y="12" class="fill-muted-foreground pointer-events-none text-[10px]">{b + 1}</text>
        {/each}
        <!-- Where Play starts: a marker you drag. -->
        {#if cursor >= 0}
          <polygon points="{x(cursor) - 6},0 {x(cursor) + 6},0 {x(cursor)},9" class="pointer-events-none fill-sky-500" />
        {/if}
        {#if localPlayhead >= 0}
          <line x1={x(localPlayhead)} x2={x(localPlayhead)} y1="0" y2={RULER_H} class="pointer-events-none stroke-red-500" stroke-width="2" />
        {/if}
      </svg>
    </div>

    <div class="flex" style="width: {KEYS_W + width}px">
      <!-- The keyboard: sticks to the left while scrolling. Click a key to hear it. -->
      <svg width={KEYS_W} {height} class="bg-background sticky left-0 z-10 shrink-0 border-r select-none">
        {#each pitches as p (p)}
          <rect
            x="0"
            y={y(p)}
            width={BLACK.includes(p % 12) ? KEYS_W * 0.65 : KEYS_W}
            height={ROW}
            class="{liveKeys.sounding.includes(p) ? 'fill-sky-500' : BLACK.includes(p % 12) ? 'fill-foreground' : 'fill-background stroke-border'} cursor-pointer hover:opacity-70"
            role="button"
            tabindex="-1"
            aria-label="Play {name(p)}"
            onpointerdown={() => preview(p)}
          />
          {#if p % 12 === 0}
            <text x={KEYS_W - 3} y={y(p) + ROW - 2} text-anchor="end" class="fill-muted-foreground pointer-events-none text-[9px]">{name(p)}</text>
          {/if}
        {/each}
      </svg>

      <svg
        bind:this={roll}
        {width}
        {height}
        class="block shrink-0 cursor-crosshair touch-none select-none"
        role="application"
        aria-label="Piano roll for {track.name}"
        oncontextmenu={(e) => onBackgroundContext(e, roll)}
      >
        <!-- Background: a stripe per semitone (out-of-key rows shaded), grid lines. -->
        <g onpointerdown={onBackgroundDown} role="presentation">
          {#each pitches as p (p)}
            <rect x="0" y={y(p)} {width} height={ROW} class={inKey.includes(p % 12) ? 'fill-background' : 'fill-muted'} />
            {#if p % 12 === 0}
              <line x1="0" x2={width} y1={y(p) + ROW} y2={y(p) + ROW} class="stroke-border" />
            {/if}
          {/each}
          {#each lines as l (l.x)}
            <line
              x1={l.x}
              x2={l.x}
              y1="0"
              y2={height}
              class={l.kind === 'bar' ? 'stroke-foreground/40' : l.kind === 'beat' ? 'stroke-border' : 'stroke-border/40'}
            />
          {/each}
        </g>

        <!-- Where Play starts and Paste goes (move it on the ruler). -->
        {#if cursor >= 0}
          <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={height} class="pointer-events-none stroke-sky-400" stroke-dasharray="4 4" />
        {/if}

        <!-- Notes: body to move, edges to change length. -->
        {#each placed as p (p.note.id)}
          {@const nx = x(absStart(p))}
          {@const nw = Math.max(4, x(p.note.duration))}
          {@const edge = Math.min(6, nw / 3)}
          {@const isSelected = selected.has(p.note.id)}
          <g style="opacity: {0.45 + 0.55 * p.note.velocity}">
            <rect
              x={nx}
              y={y(p.note.pitch) + 0.5}
              width={nw}
              height={ROW - 1}
              rx="2"
              class="{isSelected ? 'fill-amber-500 stroke-amber-700' : 'fill-sky-600 stroke-sky-800'} cursor-grab"
              role="button"
              tabindex="-1"
              aria-label="{name(p.note.pitch)} note"
              onpointerdown={(e) => onNoteDown(e, p, 'body')}
              oncontextmenu={(e) => {
                e.stopPropagation();
                onNoteContext(e, p);
              }}
            />
            {#if nw > 26}
              <text x={nx + 3} y={y(p.note.pitch) + ROW - 3} class="pointer-events-none fill-white text-[8px]">{name(p.note.pitch)}</text>
            {/if}
            {#if p.note.alternatives?.length}
              <circle cx={nx + nw - 3} cy={y(p.note.pitch) + 3} r="2" class="pointer-events-none fill-white">
                <title>Could also be {p.note.alternatives.map(name).join(', ')}: select and press A</title>
              </circle>
            {/if}
            <rect x={nx} y={y(p.note.pitch)} width={edge} height={ROW} class="cursor-ew-resize fill-transparent" role="presentation" onpointerdown={(e) => onNoteDown(e, p, 'start')} oncontextmenu={(e) => { e.stopPropagation(); onNoteContext(e, p); }} />
            <rect x={nx + nw - edge} y={y(p.note.pitch)} width={edge} height={ROW} class="cursor-ew-resize fill-transparent" role="presentation" onpointerdown={(e) => onNoteDown(e, p, 'end')} oncontextmenu={(e) => { e.stopPropagation(); onNoteContext(e, p); }} />
          </g>
        {/each}

        <!-- What transcription heard (the take's pitch, frame by frame), and live while recording. -->
        {#each heard as points, i (i)}
          <polyline {points} fill="none" stroke-width="1.5" class="pointer-events-none stroke-violet-500/60" />
        {/each}
        {#each live as points, i (i)}
          <polyline {points} fill="none" stroke-width="2" class="pointer-events-none stroke-rose-500" />
        {/each}

        <!-- Pitch lines: where each note bends (drawn over it, not clickable). -->
        {#each pitchLines as line (line.id)}
          <polyline
            points={line.points}
            fill="none"
            stroke-width="1.5"
            class="pointer-events-none {selected.has(line.id) ? 'stroke-amber-900' : 'stroke-sky-950'} dark:stroke-white"
          />
        {/each}

        {#if box}
          <rect
            x={Math.min(box.x1, box.x2)}
            y={Math.min(box.y1, box.y2)}
            width={Math.abs(box.x2 - box.x1)}
            height={Math.abs(box.y2 - box.y1)}
            class="pointer-events-none fill-sky-400/15 stroke-sky-400"
          />
        {/if}

        {#if localPlayhead >= 0}
          <line x1={x(localPlayhead)} x2={x(localPlayhead)} y1="0" y2={height} class="pointer-events-none stroke-red-500" stroke-width="2" />
        {/if}
      </svg>
    </div>

    <!-- Velocity lane: sticks to the bottom. Drag over the bars to set how hard notes play. -->
    <div class="bg-background sticky bottom-0 z-10 flex border-t" style="width: {KEYS_W + width}px" data-guide="roll.lanes">
      <!-- Which lane: velocity, or a controller lane (pitch bend, mod wheel). -->
      <div class="bg-background sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r px-0.5 text-[9px]" style="width: {KEYS_W}px" role="tablist">
        {#each [['velocity', 'Velocity'], ['bend', 'Bend'], ['mod', 'Mod']] as [mode, name] (mode)}
          <button
            role="tab"
            aria-selected={laneMode === mode}
            class="rounded px-0.5 {laneMode === mode ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (laneMode = mode as typeof laneMode)}
            title={mode === 'velocity' ? 'How hard each note plays' : mode === 'bend' ? 'Pitch bend: ±12 semitones over every note playing' : 'Mod wheel: a vibrato that deepens'}>{name}</button
          >
        {/each}
      </div>
      {#if laneMode === 'velocity'}
        <svg bind:this={lane} {width} height={VEL_H} class="block shrink-0 cursor-ns-resize touch-none select-none" role="application" aria-label="Velocity" onpointerdown={onLaneDown}>
          {#each placed as p (p.note.id)}
            {@const h = p.note.velocity * (VEL_H - 4)}
            <rect
              x={x(absStart(p))}
              y={VEL_H - h}
              width={Math.max(3, Math.min(8, x(p.note.duration)))}
              height={h}
              class={selected.has(p.note.id) ? 'fill-amber-500' : 'fill-sky-600'}
            />
          {/each}
        </svg>
      {:else}
        {@const mode = laneMode}
        <svg
          bind:this={lane}
          {width}
          height={VEL_H}
          class="block shrink-0 cursor-crosshair touch-none select-none"
          role="application"
          aria-label={mode === 'bend' ? 'Pitch bend' : 'Mod wheel'}
          onpointerdown={(e) => onControllerDown(e, mode)}
          oncontextmenu={(e) => controllerMenu(e, mode)}
        >
          <!-- The notes, faint, to draw against; the zero line for bends. -->
          {#each placed as p (p.note.id)}
            <rect x={x(absStart(p))} y="0" width={Math.max(2, x(p.note.duration))} height={VEL_H} class="fill-sky-600/10" />
          {/each}
          {#if mode === 'bend'}
            <line x1="0" x2={width} y1={ctlY('bend', 0)} y2={ctlY('bend', 0)} class="stroke-foreground/25" stroke-dasharray="3 3" />
          {/if}
          {#if ctlLine}
            <polyline points={ctlLine} class="fill-none stroke-violet-500" stroke-width="2" />
          {:else}
            <text x="8" y={VEL_H / 2 + 3} class="fill-muted-foreground text-[10px]">Drag to draw the {mode === 'bend' ? 'pitch bend' : 'mod wheel'}</text>
          {/if}
        </svg>
      {/if}
    </div>
  </div>
</div>
