<!--
  The instrument browser: pick a melody track's sound from everything there is.
  - search; ▶ plays a note; click a name to use it
  - Synths, Sampled instruments (real recordings), Your presets, Your sounds (an uploaded
    recording played at every pitch)
  - "+ New synth preset": your own preset, opened in the instrument editor
  - "Upload a sample…": an audio file (a note, a hit, a voice…) becomes an instrument
  - "Edit…": the instrument editor for the track's current sound
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { previewNote } from '$lib/audio/instruments';
  import { BUILT_IN_PRESETS, engine, isSampled, presetById, type InstrumentPreset } from '$lib/music/instruments';
  import { addPreset, project } from '$lib/state/project.svelte';
  import { addUserFile, userSamples } from '$lib/state/user-samples.svelte';

  let {
    open = $bindable(false),
    trackId,
    onedit
  }: { open?: boolean; trackId: string | null; onedit: () => void } = $props();

  const track = $derived(project.tracks.find((t) => t.id === trackId && t.kind === 'midi'));
  const current = $derived(track?.kind === 'midi' ? track.instrument : '');
  let query = $state('');
  let uploading = $state(false);
  let fileInput = $state<HTMLInputElement>();

  // Your sounds as instruments: the preset that plays each (made the first time it's used).
  const soundPreset = (id: string, name: string): InstrumentPreset =>
    project.instruments.find((p) => p.engine === 'sampler' && p.params.sample === id) ?? { id: `sound:${id}`, name, engine: 'sampler', params: { sample: id, root: 'C4' } };

  interface Item {
    preset: InstrumentPreset;
    group: string;
    detail: string;
  }
  const all = $derived<Item[]>([
    ...BUILT_IN_PRESETS.filter((p) => !isSampled(p)).map((p) => ({ preset: p, group: 'Synths', detail: engine(p.engine).name })),
    ...BUILT_IN_PRESETS.filter(isSampled).map((p) => ({ preset: p, group: 'Sampled instruments', detail: 'recorded' })),
    ...project.instruments
      .filter((p) => !(p.engine === 'sampler' && String(p.params.sample).startsWith('u:')))
      .map((p) => ({ preset: p, group: 'Your presets', detail: engine(p.engine).name })),
    ...userSamples.list.map((u) => ({ preset: soundPreset(u.id, u.name), group: 'Your sounds', detail: `${u.seconds.toFixed(1)} s` }))
  ]);
  const results = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((i) => words.every((w) => `${i.preset.name} ${i.group} ${i.detail}`.toLowerCase().includes(w)));
  });
  const groups = $derived([...new Set(results.map((i) => i.group))]);

  // Use it: a preset made for one of your sounds is added to the project first.
  function choose(preset: InstrumentPreset) {
    if (track?.kind !== 'midi') return;
    if (preset.id.startsWith('sound:')) {
      const made = addPreset(preset);
      made.name = preset.name;
      track.instrument = made.id;
    } else track.instrument = preset.id;
  }

  function pick(preset: InstrumentPreset) {
    choose(preset);
    open = false;
    query = '';
  }

  function newSynth() {
    if (track?.kind !== 'midi') return;
    const made = addPreset(presetById(project.instruments, 'synth'));
    made.name = 'My synth';
    track.instrument = made.id;
    open = false;
    setTimeout(onedit, 150); // into the editor once this window has closed
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file || track?.kind !== 'midi') return;
    uploading = true;
    try {
      const id = await addUserFile(file);
      choose(soundPreset(id, file.name.replace(/\.[^.]+$/, '')));
      open = false;
      setTimeout(onedit, 150); // set the note it plays at, fades…
    } catch (e) {
      window.alert(`That file couldn't be read as audio: ${e instanceof Error ? e.message : e}`);
    } finally {
      uploading = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Instrument{track ? `: ${track.name}` : ''}</Dialog.Title>
      <Dialog.Description>Search, ▶ to listen, click a name to use it.</Dialog.Description>
    </Dialog.Header>

    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="search"
      placeholder="Search: piano, bass, strings, sax, bell…"
      bind:value={query}
      autofocus
      onkeydown={(e) => {
        if (e.key === 'Enter' && results.length) {
          e.preventDefault();
          const preset = results[0].preset;
          setTimeout(() => pick(preset), 0);
        }
      }}
      class="bg-background rounded-md border px-3 py-2 text-sm"
    />

    <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
      {#each groups as group (group)}
        <h3 class="text-muted-foreground mt-3 mb-1 text-xs font-semibold tracking-wide uppercase">{group}</h3>
        <div class="grid grid-cols-2 gap-x-2">
          {#each results.filter((i) => i.group === group) as item (item.preset.id)}
            <div class="hover:bg-muted flex items-center gap-1 rounded-md px-1 {item.preset.id === current ? 'bg-muted' : ''}">
              <button class="text-muted-foreground hover:text-foreground px-1 text-xs" onclick={() => previewNote($state.snapshot(item.preset), 60)} aria-label="Listen to {item.preset.name}">▶</button>
              <button class="min-w-0 flex-1 py-1 text-left" onclick={() => pick(item.preset)}>
                <span class="block truncate text-sm">{item.preset.name}{item.preset.id === current ? ' ✓' : ''}</span>
                <span class="text-muted-foreground block truncate text-[10px]">{item.detail}</span>
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted-foreground py-6 text-center text-sm">No instrument matches "{query}".</p>
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onclick={newSynth}>+ New synth preset</Button>
      <input bind:this={fileInput} type="file" accept="audio/*" class="hidden" onchange={(e) => upload(e.currentTarget.files)} />
      <Button size="sm" variant="outline" disabled={uploading} onclick={() => fileInput?.click()}>{uploading ? 'Adding…' : 'Upload a sample…'}</Button>
      <Button
        size="sm"
        variant="ghost"
        class="ml-auto"
        onclick={() => {
          open = false;
          setTimeout(onedit, 150);
        }}>Edit current…</Button
      >
    </div>
  </Dialog.Content>
</Dialog.Root>
