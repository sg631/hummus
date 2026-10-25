<!--
  The slicer (like FL Studio's Slicex): cut a recording into hits, each a drum sound.
  1. Open an audio file, or pick a voice recording from this song.
  2. The hits are found (a jump in loudness starts one); Sensitivity finds more or fewer.
     Click a marker to remove it, click the waveform to add one; click a slice's number
     to hear it.
  3. "Add N sounds": each slice is kept in Your sounds (this browser) and, if ticked,
     added to the drum track as a row.
-->
<script lang="ts">
  import * as Tone from 'tone';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Knob } from '$lib/components/ui/knob/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { initAudio } from '$lib/audio/engine';
  import { findOnsets, slices } from '$lib/music/slice';
  import type { DrumSound } from '$lib/music/drums';
  import type { DrumTrack } from '$lib/music/types';
  import { addDrumRow, project } from '$lib/state/project.svelte';
  import { addUserSample, decodeFile } from '$lib/state/user-samples.svelte';

  // `ondone`: after the slices are added (e.g. the sound browser closes too).
  let { open = $bindable(false), track, ondone }: { open?: boolean; track: DrumTrack; ondone?: () => void } = $props();

  const W = 640;
  const H = 120;
  const MAX_SLICES = 32;
  const FADE_SEC = 0.005; // a tiny fade at each slice's end, so it doesn't click

  let audio = $state.raw<Float32Array | null>(null);
  let sampleRate = $state(44100);
  let name = $state('Slice');
  let sensitivity = $state(0.5);
  let onsets = $state<number[]>([]);
  let addRows = $state(true);
  let fileInput = $state<HTMLInputElement>();
  let busy = $state(false);

  // Voice recordings in this song, to slice.
  const recordings = $derived(
    project.tracks.flatMap((t) => (t.kind === 'voice' ? t.clips.map((c, i) => ({ id: c.id, label: `${t.name} ${i + 1}`, clip: c })) : []))
  );

  function use(a: Float32Array, sr: number, label: string) {
    audio = a;
    sampleRate = sr;
    name = label;
    onsets = findOnsets(a, sr, sensitivity).slice(0, MAX_SLICES);
  }

  async function openFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const decoded = await decodeFile(file);
      use(decoded.audio, decoded.sampleRate, file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      window.alert(`That file couldn't be read as audio: ${e instanceof Error ? e.message : e}`);
    }
  }

  function detect() {
    if (audio) onsets = findOnsets(audio, sampleRate, sensitivity).slice(0, MAX_SLICES);
  }

  const pieces = $derived(audio ? slices(onsets, audio.length) : []);

  // The waveform: the loudest sample in each pixel column.
  const wave = $derived.by(() => {
    if (!audio) return '';
    const per = Math.max(1, Math.floor(audio.length / W));
    const top: string[] = [];
    const bottom: string[] = [];
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let j = x * per, end = Math.min(audio.length, j + per); j < end; j++) m = Math.max(m, Math.abs(audio[j]));
      const h = Math.min(1, m) * (H / 2 - 2);
      top.push(`${x},${(H / 2 - h).toFixed(1)}`);
      bottom.push(`${x},${(H / 2 + h).toFixed(1)}`);
    }
    return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`;
  });
  const xOf = (i: number) => (audio ? (i / audio.length) * W : 0);

  function onWaveClick(e: MouseEvent) {
    if (!audio || onsets.length >= MAX_SLICES) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const at = Math.round(((e.clientX - r.left) / r.width) * audio.length);
    onsets = [...onsets, at].sort((a, b) => a - b);
  }

  // A slice's audio, with a short fade at its end.
  function sliceAudio(p: { start: number; end: number }): Float32Array {
    const out = audio!.slice(p.start, p.end);
    const fade = Math.min(out.length, Math.round(FADE_SEC * sampleRate));
    for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
    return out;
  }

  async function hear(p: { start: number; end: number }) {
    await initAudio();
    const buffer = new AudioBuffer({ length: Math.max(1, p.end - p.start), sampleRate, numberOfChannels: 1 });
    buffer.copyToChannel(sliceAudio(p) as Float32Array<ArrayBuffer>, 0);
    const src = new Tone.ToneBufferSource(buffer).toDestination();
    src.onended = () => src.dispose();
    src.start();
  }

  async function addAll() {
    if (!audio || !pieces.length) return;
    busy = true;
    try {
      for (const [i, p] of pieces.entries()) {
        const id = await addUserSample(`${name} ${i + 1}`, sliceAudio(p), sampleRate);
        if (addRows) addDrumRow(track, id as DrumSound);
      }
      open = false;
      audio = null;
      ondone?.();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>Slice a recording</Dialog.Title>
      <Dialog.Description>Cut a recording into hits; each becomes a drum sound.</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <input bind:this={fileInput} type="file" accept="audio/*" class="hidden" onchange={(e) => openFile(e.currentTarget.files)} />
      <Button size="sm" variant="outline" onclick={() => fileInput?.click()}>Open audio file…</Button>
      {#each recordings as r (r.id)}
        <Button size="sm" variant="outline" onclick={() => use(r.clip.audio, r.clip.sampleRate, r.label)}>{r.label}</Button>
      {/each}
    </div>

    {#if audio}
      <div class="flex flex-wrap items-end gap-4">
        <Knob label="Sensitivity" size={36} bind:value={() => sensitivity, (v) => ((sensitivity = v), detect())} min={0} max={1} step={0.05} defaultValue={0.5} format={(v) => `${Math.round(v * 100)}%`} />
        <label class="flex flex-col gap-1 text-xs">
          Name
          <input bind:value={name} class="bg-background w-40 rounded border px-2 py-1 text-sm" />
        </label>
        <label class="flex items-center gap-2 text-xs">
          <Switch size="sm" bind:checked={addRows} />
          Add each as a drum row
        </label>
        <span class="text-muted-foreground text-xs">{pieces.length} slice{pieces.length === 1 ? '' : 's'} · click a marker to remove it, the waveform to add one</span>
      </div>

      <svg viewBox="0 0 {W} {H + 18}" class="w-full rounded border" role="application" aria-label="Recording to slice">
        <rect x="0" y="0" width={W} height={H} class="fill-muted/40" role="presentation" onclick={onWaveClick} />
        <path d={wave} class="pointer-events-none fill-sky-600" />
        {#each pieces as p, i (p.start)}
          <!-- The marker (click: remove), and the slice's number (click: hear it). -->
          <line x1={xOf(p.start)} x2={xOf(p.start)} y1="0" y2={H} class="stroke-amber-500" stroke-width="2" />
          <rect
            x={xOf(p.start) - 4}
            y="0"
            width="8"
            height={H}
            class="cursor-pointer fill-transparent hover:fill-amber-500/30"
            role="button"
            tabindex="-1"
            aria-label="Remove marker {i + 1}"
            onpointerdown={() => (onsets = onsets.filter((o) => o !== p.start))}
          />
          <text
            x={(xOf(p.start) + xOf(p.end)) / 2}
            y={H + 13}
            text-anchor="middle"
            class="fill-foreground cursor-pointer text-[10px] hover:underline"
            role="button"
            tabindex="-1"
            onpointerdown={() => hear(p)}>▶{i + 1}</text
          >
        {/each}
      </svg>

      <div class="flex justify-end gap-2">
        <Button variant="outline" onclick={() => (audio = null)}>Clear</Button>
        <Button disabled={!pieces.length || busy} onclick={addAll}>{busy ? 'Adding…' : `Add ${pieces.length} sound${pieces.length === 1 ? '' : 's'}`}</Button>
      </div>
    {:else}
      <p class="text-muted-foreground py-6 text-center text-sm">Open a file (a drum loop works well), or pick a recording from this song.</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
