<!--
  File → Export audio: the song (or the loop region) as a WAV or MP3 file. Rendered faster
  than it plays, with everything Play has: instruments, recordings, effects, automation, the
  master. A couple of seconds are added at the end so reverb and echoes ring out.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import Dropdown from './Dropdown.svelte';
  import { onlyTrack, renderSong, toMp3, toWav } from '$lib/audio/export';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { songLength } from '$lib/music/arrange';
  import { barTicks } from '$lib/music/time';
  import { secondsBetween } from '$lib/music/automation';
  import { downloadBlob } from '$lib/download';
  import { project } from '$lib/state/project.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { cloneDeep } from '$lib/state/clone';

  let format = $state<'wav' | 'mp3'>('wav');
  let kbps = $state('192');
  let range = $state<'song' | 'loop'>('song');
  let stems = $state(false); // each track as its own file
  let busy = $state('');

  const length = $derived(songLength(project));
  const span = $derived(range === 'loop' && project.loop ? { from: project.loop.start, to: project.loop.end } : { from: 0, to: length });
  const seconds = $derived(secondsBetween(project, span.from, Math.max(span.from, span.to)));
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  async function go() {
    if (span.to <= span.from) return;
    busy = 'Rendering…';
    try {
      const still = cloneDeep(project); // a still copy (recordings shared)
      const base = `${project.name || 'song'}${range === 'loop' ? ' (loop)' : ''}`;
      // Stems: one file per track (the others muted), each through the same buses and master.
      const jobs = stems ? still.tracks.filter((t) => !t.mute).map((t) => ({ name: `${base} - ${t.name}`, project: onlyTrack(still, t.id) })) : [{ name: base, project: still }];
      for (const [i, job] of jobs.entries()) {
        busy = jobs.length > 1 ? `Rendering ${i + 1} of ${jobs.length}…` : 'Rendering…';
        const audio = await renderSong(job.project, span);
        busy = format === 'mp3' ? 'Encoding MP3…' : 'Writing WAV…';
        const blob = format === 'mp3' ? await toMp3(audio, Number(kbps)) : toWav(audio);
        downloadBlob(blob, `${job.name}.${format}`);
        if (jobs.length > 1) await new Promise((r) => setTimeout(r, 400)); // browsers dislike a burst of downloads
      }
      ui.exportOpen = false;
    } catch (e) {
      window.alert(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }
</script>

<Dialog.Root bind:open={ui.exportOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Export audio</Dialog.Title>
      <Dialog.Description>Everything you hear on Play, as a file.</Dialog.Description>
    </Dialog.Header>
    <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <span>Format</span>
      <Dropdown
        bind:value={format}
        ariaLabel="Format"
        options={[
          { value: 'wav', label: 'WAV (full quality, 16-bit)' },
          { value: 'mp3', label: 'MP3 (smaller)' }
        ]}
      />
      {#if format === 'mp3'}
        <span>Quality</span>
        <Dropdown
          bind:value={kbps}
          ariaLabel="MP3 quality"
          options={[
            { value: '128', label: '128 kbps' },
            { value: '192', label: '192 kbps' },
            { value: '320', label: '320 kbps (best)' }
          ]}
        />
      {/if}
      <span>Part</span>
      <Dropdown
        bind:value={range}
        ariaLabel="What to export"
        options={[
          { value: 'song', label: 'The whole song' },
          { value: 'loop', label: `The loop region (bars ${Math.round((project.loop?.start ?? 0) / barTicks(project.timeSignature)) + 1}–${Math.round((project.loop?.end ?? 0) / barTicks(project.timeSignature))})` }
        ]}
      />
    </div>
    <label class="flex items-center gap-2 text-sm">
      <Switch size="sm" bind:checked={stems} />
      Each track as its own file (stems)
    </label>
    <p class="text-muted-foreground text-xs">{span.to > span.from ? `${fmt(seconds)} long, plus 2 seconds to ring out.` : 'Nothing to export yet: add some notes, drums or recordings.'}</p>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (ui.exportOpen = false)} disabled={!!busy}>Cancel</Button>
      <Button onclick={go} disabled={!!busy || span.to <= span.from}>{busy || 'Export'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
