<!--
  The selected notes' expression, under the piano roll's toolbar: how they bend.
  - Sung: how much of the pitch curve you sang plays (slides, scoops, vibrato kept)
  - Slide in / Slide out: start (or end) this many semitones away, over this long
  - Glide: slide in from the previous note's pitch
  - Vibrato: a steady wobble, depth and speed
  - Legato: no new attack into the next note
  Changes apply to every selected note, and the piano roll draws the result as a line on
  each note (music/note-expression.ts). Each change can be undone.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { isSampled } from '$lib/music/instruments';
  import type { NoteExpression } from '$lib/music/note-expression';
  import type { Placed } from '$lib/music/note-edit';
  import type { MidiTrack, Note } from '$lib/music/types';
  import { checkpoint } from '$lib/state/history.svelte';
  import { trackPreset } from '$lib/state/project.svelte';

  let { track, placed }: { track: MidiTrack; placed: Placed[] } = $props();

  // Always shown (so the piano roll below never jumps); with nothing selected it's greyed out.
  const off = $derived(!placed.length);

  // The controls show the first selected note's values.
  const e = $derived(placed[0]?.note.expression ?? {});
  const legato = $derived(placed[0]?.note.articulation?.kind === 'legato');
  const sampled = $derived(isSampled(trackPreset(track)));
  const hasSung = $derived(placed.some((p) => p.note.interpretation?.curve?.length));

  // Changes every selected note. Hand-edited notes stop re-quantizing from the take
  // (re-quantizing rebuilds them from the singing, which would lose this).
  function change(key: string, edit: (expr: NoteExpression, note: Note) => void) {
    checkpoint(track, 'Expression', `expression-${key}`);
    for (const p of placed) {
      p.note.expression ??= {};
      edit(p.note.expression, p.note);
      p.clip.source = undefined;
    }
  }

  const DEFAULT_SLIDE_SEC = 0.15;
  const ms = (sec: number) => `${Math.round(sec * 1000)} ms`;
  const st = (v: number) => (v === 0 ? 'off' : `${v > 0 ? '+' : ''}${v} st`);

  function setLegato(on: boolean) {
    change('legato', (_, note) => {
      note.articulation = { accent: false, accentDb: 0, ...note.articulation, kind: on ? 'legato' : 'normal' };
    });
  }
</script>

<div class="flex items-end gap-x-4 overflow-x-auto border-b px-3 py-2 text-xs whitespace-nowrap {off ? 'opacity-60' : ''}">
  <span class="self-center font-semibold" title={off ? 'Select notes to shape them' : sampled ? "This track's sampled instrument plays notes as written: bends are drawn but not heard" : ''}>
    Expression{off ? ' (select notes)' : sampled ? ' (not heard on samples)' : ''}
  </span>

  <Knob
    label="Sung"
    size={30}
    bind:value={() => (e.bend ?? 1) * 100, (v) => change('bend', (x) => (x.bend = v / 100))}
    min={0}
    max={150}
    step={5}
    defaultValue={100}
    disabled={off || !hasSung}
    format={(v) => `${Math.round(v)}%`}
  />

  <div class="flex gap-2 rounded border px-2 pt-1">
    <Knob
      label="Slide in"
      size={30}
      bind:value={() => e.slideIn?.semitones ?? 0, (v) => change('slideIn', (x) => (x.slideIn = v ? { semitones: v, sec: x.slideIn?.sec ?? DEFAULT_SLIDE_SEC } : undefined))}
      min={-12}
      max={12}
      step={1}
      defaultValue={0}
      format={st}
      disabled={off}
    />
    <Knob
      label="Time"
      size={30}
      bind:value={() => e.slideIn?.sec ?? DEFAULT_SLIDE_SEC, (v) => change('slideInSec', (x) => (x.slideIn = { semitones: x.slideIn?.semitones ?? 0, sec: v }))}
      min={0.02}
      max={1}
      step={0.01}
      defaultValue={DEFAULT_SLIDE_SEC}
      disabled={off || !e.slideIn?.semitones}
      format={ms}
    />
  </div>

  <div class="flex gap-2 rounded border px-2 pt-1">
    <Knob
      label="Slide out"
      size={30}
      bind:value={() => e.slideOut?.semitones ?? 0, (v) => change('slideOut', (x) => (x.slideOut = v ? { semitones: v, sec: x.slideOut?.sec ?? DEFAULT_SLIDE_SEC } : undefined))}
      min={-12}
      max={12}
      step={1}
      defaultValue={0}
      format={st}
      disabled={off}
    />
    <Knob
      label="Time"
      size={30}
      bind:value={() => e.slideOut?.sec ?? DEFAULT_SLIDE_SEC, (v) => change('slideOutSec', (x) => (x.slideOut = { semitones: x.slideOut?.semitones ?? 0, sec: v }))}
      min={0.02}
      max={1}
      step={0.01}
      defaultValue={DEFAULT_SLIDE_SEC}
      disabled={off || !e.slideOut?.semitones}
      format={ms}
    />
  </div>

  <Knob
    label="Glide"
    size={30}
    bind:value={() => e.glide ?? 0, (v) => change('glide', (x) => (x.glide = v || undefined))}
    min={0}
    max={1}
    step={0.01}
    defaultValue={0}
    format={(v) => (v === 0 ? 'off' : ms(v))}
    disabled={off}
    />

  <div class="flex gap-2 rounded border px-2 pt-1">
    <Knob
      label="Vibrato"
      size={30}
      bind:value={() => e.vibrato?.cents ?? 0, (v) => change('vibrato', (x) => (x.vibrato = v ? { cents: v, hz: x.vibrato?.hz ?? 5.5 } : undefined))}
      min={0}
      max={100}
      step={1}
      defaultValue={0}
      format={(v) => (v === 0 ? 'off' : `${v}¢`)}
      disabled={off}
    />
    <Knob
      label="Rate"
      size={30}
      bind:value={() => e.vibrato?.hz ?? 5.5, (v) => change('vibratoHz', (x) => (x.vibrato = { cents: x.vibrato?.cents ?? 0, hz: v }))}
      min={3}
      max={9}
      step={0.1}
      defaultValue={5.5}
      disabled={off || !e.vibrato?.cents}
      format={(v) => `${v.toFixed(1)} Hz`}
    />
  </div>

  <label class="flex flex-col items-center gap-2 self-center">
    <span class="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">Legato</span>
    <Switch size="sm" checked={legato} onCheckedChange={setLegato} disabled={off} />
  </label>

  <div class="flex gap-1 self-center">
    <Button
      size="sm"
      variant="outline"
      class="h-7"
      disabled={off}
      title="No bends at all: the sung curve off, and no slides, glide or vibrato"
      onclick={() => change('flatten', (x) => Object.assign(x, { bend: 0, slideIn: undefined, slideOut: undefined, glide: undefined, vibrato: undefined }))}
    >
      Flatten
    </Button>
    <Button
      size="sm"
      variant="outline"
      class="h-7"
      disabled={off}
      title="Back to how it was sung"
      onclick={() => change('reset', (_, note) => (note.expression = undefined))}
    >
      Reset
    </Button>
  </div>

</div>
