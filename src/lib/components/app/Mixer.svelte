<!--
  The mixer: every track side by side, the master on the right.
  Each strip (ChannelStrip) has the track's effects, pan, a fader with a level meter, and
  mute / solo; they're the same settings as the track cards, just all in view at once.
  - drum tracks: "Rows" shows a strip for each drum sound (each is an instrument of its own)
  - the master: effects on the whole song (e.g. a limiter or reverb), and the master volume
  - right-click a strip, fader or knob: automate it (a lane in the playlist)
  The meters move while playing: they read the playing chains (audio/mixer.ts `level`).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { level } from '$lib/audio/mixer';
  import { drumName, type DrumSound } from '$lib/music/drums';
  import { drumSample } from '$lib/music/drum-samples';
  import type { Track } from '$lib/music/types';
  import { addBus, project, removeBus, selection } from '$lib/state/project.svelte';
  import { userSampleName } from '$lib/state/user-samples.svelte';
  import { view } from '$lib/state/view.svelte';
  import { playhead } from '$lib/state/playhead.svelte';
  import ChannelStrip from './ChannelStrip.svelte';
  import Spectrum from './Spectrum.svelte';

  const COLOR: Record<Track['kind'], string> = { midi: 'bg-sky-600', drums: 'bg-emerald-600', voice: 'bg-violet-600' };
  const KIND: Record<Track['kind'], string> = { midi: 'melody', drums: 'drums', voice: 'voice' };

  let openRows = $state<Record<string, boolean>>({}); // drum tracks showing their rows

  // The master as a strip: its volume is the project's master volume.
  const master = {
    id: 'master',
    name: 'Master',
    get volume() {
      return project.masterVolume;
    },
    set volume(v: number) {
      project.masterVolume = v;
    },
    get effects() {
      return project.masterEffects;
    }
  };

  const soundName = (sound: string) =>
    drumName(sound as DrumSound, (id) => {
      const s = drumSample(id);
      return s ? `${s.kit.replace('Acoustic kit: ', '')} ${s.name}` : userSampleName(id);
    });

  // Every channel's level, read each screen frame.
  let levels = $state<Record<string, number>>({});
  onMount(() => {
    let frame = 0;
    let idle = false;
    const read = () => {
      frame = requestAnimationFrame(read);
      // Stopped: the meters are silent; draw that once and wait.
      if (!playhead.running) {
        if (!idle) levels = {};
        idle = true;
        return;
      }
      idle = false;
      const next: Record<string, number> = { master: level('master') };
      for (const b of project.buses) next[b.id] = level(b.id);
      for (const t of project.tracks) {
        next[t.id] = level(t.id);
        if (t.kind === 'drums') for (const r of t.rows) next[r.id] = level(r.id);
      }
      levels = next;
    };
    read();
    return () => cancelAnimationFrame(frame);
  });

  function open(track: Track) {
    selection.trackId = track.id;
    view.main = 'editor';
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex h-11 shrink-0 items-center gap-3 border-b px-3 text-xs whitespace-nowrap">
    <span class="font-semibold">Mixer</span>
    <span class="text-muted-foreground">Drag a fader (Shift: finer), double-click to reset · right-click to automate · meters move while playing</span>
    <button class="hover:bg-muted ml-auto rounded border px-2 py-0.5" onclick={() => addBus()} title="A bus: send a little of several tracks into it (one reverb for all), or route tracks into it (a group)">+ Bus</button>
  </div>

  <div class="flex min-h-0 flex-1 items-start gap-2 overflow-auto p-3">
    {#each project.tracks as track (track.id)}
      <ChannelStrip
        owner={track}
        kind={KIND[track.kind]}
        color={COLOR[track.kind]}
        level={levels[track.id]}
        selected={selection.trackId === track.id}
        routable
        onselect={() => (selection.trackId = track.id)}
        menu={() => [{ label: 'Open in editor', action: () => open(track) }]}
      >
        {#if track.kind === 'drums'}
          <button
            class="text-muted-foreground hover:text-foreground h-6 rounded border px-1.5 text-[10px]"
            aria-expanded={!!openRows[track.id]}
            title="A strip for each drum sound"
            onclick={() => (openRows[track.id] = !openRows[track.id])}>Rows {openRows[track.id] ? '◂' : '▸'}</button
          >
        {/if}
      </ChannelStrip>
      {#if track.kind === 'drums' && openRows[track.id]}
        {#each track.rows as row (row.id)}
          <ChannelStrip
            owner={{
              get id() { return row.id; },
              get name() { return soundName(row.sound); },
              get volume() { return row.volume; },
              set volume(v) { row.volume = v; },
              get pan() { return row.pan; },
              set pan(v) { row.pan = v; },
              get mute() { return row.mute; },
              set mute(v) { row.mute = v; },
              get effects() { return row.effects; }
            }}
            kind="{track.name} row"
            color="bg-emerald-600/40"
            level={levels[row.id]}
          />
        {/each}
      {/if}
    {:else}
      <p class="text-muted-foreground p-3 text-sm">Add tracks to mix them here.</p>
    {/each}

    <!-- Buses: shared effects and groups. -->
    {#each project.buses as bus (bus.id)}
      <ChannelStrip
        owner={bus}
        kind="bus"
        color="bg-amber-500"
        level={levels[bus.id]}
        menu={() => [
          { label: 'Rename…', action: () => { const n = window.prompt('Bus name', bus.name)?.trim(); if (n) bus.name = n; } },
          { label: 'Delete bus', danger: true, action: () => removeBus(bus.id) }
        ]}
      />
    {/each}

    <!-- The master, stuck to the right edge. -->
    <div class="bg-background sticky right-0 ml-auto flex shrink-0 flex-col gap-2 border-l pl-2">
      <ChannelStrip owner={master} kind="everything" color="bg-foreground" level={levels.master} />
      <div class="flex flex-col gap-0.5" title="The whole song's frequencies, low to high (100 Hz, 1 kHz, 10 kHz lines)">
        <span class="text-muted-foreground text-[10px]">Spectrum</span>
        <Spectrum id="master" width={144} height={56} />
      </div>
    </div>
  </div>
</div>
