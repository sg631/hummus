<!--
  The menu bar, above the top bar: File, Edit, View, Track, Transport, Input, Help on the
  left; the project bar in the middle (the song's name, click to rename; whether it's
  saved, and where; undo / redo); live input on the right (computer keyboard, MIDI).
  It also handles the app-wide shortcuts: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo
  anything, Ctrl+S saves, Ctrl+O opens a project, Ctrl+K switches the computer keyboard
  between shortcuts and playing notes.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as M from '$lib/components/ui/menubar/index.js';
  import { history, redo, undo } from '$lib/state/history.svelte';
  import { PANELS, PANEL_NAMES, PRESETS, applyLayoutPreset, floatPanel, hiddenPanels, hidePanel, resetLayout, showPanel, type PresetName } from '$lib/state/layout.svelte';
  import { liveKeys, connectMidi, disconnectMidi, setComputerKeys, setKeyLayout } from '$lib/state/live-keys.svelte';
  import { addDrumTrack, addMarker, addMidiTrack, bounceToAudio, importMidi, addVoiceTrack, duplicateTrack, project, removeTrack, selectedTrack } from '$lib/state/project.svelte';
  import { playhead, seek } from '$lib/state/playhead.svelte';
  import { chooseProjectsFolder, exportProjectFile, importProjectFile, library, newProject, saveAs, saveNow } from '$lib/state/projects.svelte';
  import { folderSupported } from '$lib/state/project-store';
  import { recorder } from '$lib/state/recorder.svelte';
  import { recordingSettings, saveRecordingSettings } from '$lib/state/settings.svelte';
  import { openIntro } from '$lib/guide/guide.svelte';
  import { goHome, transportActions, ui } from '$lib/state/ui.svelte';
  import Logo from './Logo.svelte';
  import { offline } from '$lib/state/offline.svelte';
  import { automationWrite } from '$lib/state/automation.svelte';
  import { monitor, startMonitor, stopMonitor } from '$lib/state/monitor.svelte';
  import { view } from '$lib/state/view.svelte';
  import { formatShift } from '$lib/music/shift-keys';

  let importInput = $state<HTMLInputElement>();
  let midiInput = $state<HTMLInputElement>();
  let renaming = $state(false);
  let nameInput = $state<HTMLInputElement>();

  function say(text: string) {
    ui.message = text;
    setTimeout(() => ui.message === text && (ui.message = ''), 2500);
  }

  async function doUndo() {
    const label = undo();
    say(label ? `Undid: ${label}` : 'Nothing to undo');
  }
  async function doRedo() {
    const label = redo();
    say(label ? `Redid: ${label}` : 'Nothing to redo');
  }
  async function doSave() {
    say((await saveNow()) ? `Saved to ${library.where}` : library.folder.state === 'needs-permission' ? 'Allow access to your projects folder first' : 'Could not save');
  }
  async function doSaveAs() {
    const name = window.prompt('Save a copy as', `${project.name} copy`);
    if (name?.trim()) {
      await saveAs(name.trim());
      say(`Saved as “${name.trim()}”`);
    }
  }
  async function doImport(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      await importProjectFile(file);
      say(`Opened “${project.name}”`);
    } catch (e) {
      window.alert(`That file couldn't be opened: ${e instanceof Error ? e.message : e}`);
    }
  }
  async function doChooseFolder() {
    const copied = await chooseProjectsFolder();
    if (copied !== null) say(`Projects folder: ${library.folder.name}${copied ? ` (${copied} project${copied > 1 ? 's' : ''} copied in)` : ''}`);
  }
  async function startRename() {
    renaming = true;
    await tick();
    nameInput?.select();
  }

  const trackKind = $derived(selectedTrack()?.kind);
  const selectedPoly = $derived.by(() => {
    const t = selectedTrack();
    return t?.kind === 'midi' && !!t.poly;
  });
  const status = $derived(
    library.folder.state === 'needs-permission' || library.folder.state === 'denied'
      ? 'Folder access needed'
      : library.status === 'saving'
        ? 'Saving…'
        : library.status === 'unsaved'
          ? 'Unsaved changes'
          : library.status === 'error'
            ? 'Not saved'
            : `Saved · ${library.where}`
  );

  // App-wide shortcuts.
  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const el = e.target as HTMLElement;
    const typing = !!el.closest('input, textarea, [contenteditable]');
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      void doSave();
    } else if (key === 'o') {
      e.preventDefault();
      ui.projectsOpen = true;
    } else if (key === 'k') {
      e.preventDefault();
      setComputerKeys(!liveKeys.computer);
      say(liveKeys.computer ? 'Computer keyboard plays notes (Ctrl+K: back to shortcuts)' : 'Computer keyboard: shortcuts again');
    } else if (typing || recorder.recording) return;
    else if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      void doUndo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      void doRedo();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="bg-muted/30 relative flex h-9 items-center border-b px-1 text-sm">
  <!-- The logo: back to the home page (your projects). -->
  <button class="hover:bg-muted rounded px-2 py-0.5" onclick={goHome} title="Home: your projects">
    <Logo class="text-2xl" />
  </button>
  <M.Root class="h-8 border-0 bg-transparent shadow-none">
    <M.Menu>
      <M.Trigger>File</M.Trigger>
      <M.Content>
        <M.Item onSelect={goHome}>Home (your projects)</M.Item>
        <M.Separator />
        <M.Item onSelect={() => newProject()}>New project</M.Item>
        <M.Item onSelect={() => (ui.projectsOpen = true)}>Open…<M.Shortcut>Ctrl+O</M.Shortcut></M.Item>
        <M.Separator />
        <M.Item onSelect={doSave}>Save<M.Shortcut>Ctrl+S</M.Shortcut></M.Item>
        <M.Item onSelect={doSaveAs}>Save a copy as…</M.Item>
        <M.Item onSelect={startRename}>Rename…</M.Item>
        <M.CheckboxItem bind:checked={library.autosave}>Save automatically</M.CheckboxItem>
        <M.Separator />
        <M.Item onSelect={() => (ui.exportOpen = true)}>Export audio (WAV, MP3)…</M.Item>
        <M.Item onSelect={() => transportActions.exportMidi()}>Export MIDI</M.Item>
        <M.Item onSelect={() => exportProjectFile()}>Export project file (.humproj)</M.Item>
        <M.Item onSelect={() => importInput?.click()}>Import project file…</M.Item>
        <M.Item onSelect={() => midiInput?.click()}>Import MIDI file (adds its parts as tracks)…</M.Item>
        <M.Separator />
        {#if folderSupported}
          <M.Item onSelect={doChooseFolder}>{library.folder.state === 'none' ? 'Keep projects in a folder…' : 'Change projects folder…'}</M.Item>
        {/if}
        <M.Item onSelect={() => (ui.projectsOpen = true)}>Where projects are kept…</M.Item>
        <M.Item onSelect={() => (ui.offlineOpen = true)}>Work offline…</M.Item>
      </M.Content>
    </M.Menu>

    <M.Menu>
      <M.Trigger>Edit</M.Trigger>
      <M.Content>
        <M.Item disabled={!history.undoLabel} onSelect={doUndo}>Undo {history.undoLabel ?? ''}<M.Shortcut>Ctrl+Z</M.Shortcut></M.Item>
        <M.Item disabled={!history.redoLabel} onSelect={doRedo}>Redo {history.redoLabel ?? ''}<M.Shortcut>Ctrl+Y</M.Shortcut></M.Item>
        <M.Item onSelect={() => (ui.historyOpen = true)}>History…</M.Item>
        <M.Separator />
        <M.Item onSelect={() => (ui.settingsOpen = true)}>Settings…</M.Item>
      </M.Content>
    </M.Menu>

    <M.Menu>
      <M.Trigger>View</M.Trigger>
      <M.Content>
        <M.RadioGroup value={view.main} onValueChange={(v) => (view.main = v as typeof view.main)}>
          <M.RadioItem value="editor">Editor</M.RadioItem>
          <M.RadioItem value="playlist">Playlist</M.RadioItem>
          <M.RadioItem value="mixer">Mixer</M.RadioItem>
        </M.RadioGroup>
        <M.Separator />
        <M.Label>Panels (drag a tab to move one)</M.Label>
        {#each PANELS as p (p)}
          <M.CheckboxItem checked={!hiddenPanels().includes(p)} onCheckedChange={(v) => (v ? showPanel(p) : hidePanel(p))}>{PANEL_NAMES[p]}</M.CheckboxItem>
        {/each}
        <M.Sub>
          <M.SubTrigger>Float as a window</M.SubTrigger>
          <M.SubContent>
            {#each PANELS as p, i (p)}
              <M.Item onSelect={() => floatPanel(p, { x: 160 + i * 30, y: 140 + i * 30 })}>{PANEL_NAMES[p]}</M.Item>
            {/each}
          </M.SubContent>
        </M.Sub>
        <M.Sub>
          <M.SubTrigger>Layouts</M.SubTrigger>
          <M.SubContent>
            {#each Object.entries(PRESETS) as [key, preset] (key)}
              <M.Item onSelect={() => applyLayoutPreset(key as PresetName)}>{preset.name}</M.Item>
            {/each}
          </M.SubContent>
        </M.Sub>
        <M.Item onSelect={resetLayout}>Reset layout</M.Item>
      </M.Content>
    </M.Menu>

    <M.Menu>
      <M.Trigger>Track</M.Trigger>
      <M.Content>
        <M.Item onSelect={() => addMidiTrack()}>Add melody track</M.Item>
        <M.Item onSelect={() => addVoiceTrack()}>Add voice track</M.Item>
        <M.Item onSelect={() => addDrumTrack()}>Add drum track</M.Item>
        <M.Separator />
        {@const t = selectedTrack()}
        <M.Item disabled={!t} onSelect={() => t && duplicateTrack(t.id)}>Duplicate selected</M.Item>
        <M.Item disabled={!t} onSelect={() => t && (t.mute = !t.mute)}>{t?.mute ? 'Unmute' : 'Mute'} selected</M.Item>
        <M.Item disabled={!t} onSelect={() => t && (t.solo = !t.solo)}>{t?.solo ? 'Unsolo' : 'Solo'} selected</M.Item>
        <M.Item disabled={!t} onSelect={async () => t && (await bounceToAudio(t.id)) && say(`Bounced “${t.name}” to audio`)}>Bounce selected to audio</M.Item>
        <M.Item disabled={!t} onSelect={() => t && removeTrack(t.id)}>Delete selected</M.Item>
      </M.Content>
    </M.Menu>

    <M.Menu>
      <M.Trigger>Transport</M.Trigger>
      <M.Content>
        <M.Item onSelect={() => transportActions.togglePlay()}>Play / Stop<M.Shortcut>Space</M.Shortcut></M.Item>
        <M.Item disabled={!trackKind || trackKind === 'drums'} onSelect={() => transportActions.toggleRecord()}>Record</M.Item>
        <M.Separator />
        <M.RadioGroup value={view.play} onValueChange={(v) => (view.play = v as typeof view.play)}>
          <M.RadioItem value="song">Play the song</M.RadioItem>
          <M.RadioItem value="pattern">Play the pattern (loop the selected clip)</M.RadioItem>
        </M.RadioGroup>
        <M.Separator />
        <M.CheckboxItem checked={!!project.loop?.enabled} onCheckedChange={() => transportActions.toggleLoop()}>Loop region</M.CheckboxItem>
        <M.CheckboxItem checked={recordingSettings.metronome} onCheckedChange={() => transportActions.toggleMetronome()}>Metronome</M.CheckboxItem>
        <M.CheckboxItem bind:checked={automationWrite.on}>Record automation (knob moves while playing)</M.CheckboxItem>
        <M.CheckboxItem
          checked={recordingSettings.punch}
          onCheckedChange={(v) => {
            recordingSettings.punch = v;
            saveRecordingSettings();
          }}>Punch in/out: record only inside the loop region</M.CheckboxItem
        >
        <M.Separator />
        <M.Item onSelect={() => addMarker(playhead.cursor)}>Add a marker at the playhead</M.Item>
        {#each project.markers as m (m.id)}
          <M.Item onSelect={() => seek(m.tick)}>Go to “{m.name}”</M.Item>
        {/each}
      </M.Content>
    </M.Menu>

    <M.Menu>
      <M.Trigger>Input</M.Trigger>
      <M.Content>
        <M.Label>Melody tracks record</M.Label>
        <M.RadioGroup
          value={recordingSettings.input}
          onValueChange={(v) => {
            recordingSettings.input = v as 'voice' | 'keys';
            saveRecordingSettings();
          }}
        >
          <M.RadioItem value="voice">Your voice (microphone)</M.RadioItem>
          <M.RadioItem value="keys">What you play (keyboard, MIDI)</M.RadioItem>
        </M.RadioGroup>
        <M.Separator />
        <M.CheckboxItem checked={liveKeys.computer} onCheckedChange={(v) => setComputerKeys(v)}>Computer keyboard plays notes<M.Shortcut>Ctrl+K</M.Shortcut></M.CheckboxItem>
        <M.Sub>
          <M.SubTrigger>Note key layout</M.SubTrigger>
          <M.SubContent>
            <M.RadioGroup value={liveKeys.layout} onValueChange={(v) => setKeyLayout(v as 'compact' | 'piano')}>
              <M.RadioItem value="compact">Compact: A–H, then Q–Y (one octave)</M.RadioItem>
              <M.RadioItem value="piano">Piano: A S D… white, W E T… black</M.RadioItem>
            </M.RadioGroup>
          </M.SubContent>
        </M.Sub>
        <M.CheckboxItem checked={liveKeys.midi} onCheckedChange={(v) => (v ? connectMidi() : disconnectMidi())}>MIDI keyboard</M.CheckboxItem>
        {#if liveKeys.midiInputs.length}
          <M.Label class="text-muted-foreground text-xs font-normal">Connected: {liveKeys.midiInputs.join(', ')}</M.Label>
        {/if}
        <M.Separator />
        <M.CheckboxItem
          checked={monitor.on}
          onCheckedChange={async (v) => {
            if (!v) return stopMonitor();
            if (await startMonitor()) say(monitor.trackName ? `Hearing the mic through “${monitor.trackName}” (use headphones)` : 'Hearing the mic (select a voice track for its effects; use headphones)');
            else say(monitor.error);
          }}>Hear the mic (through the selected voice track's effects)</M.CheckboxItem
        >
        <M.Separator />
        <M.Item onSelect={() => (ui.shortcutsOpen = true)}>Keyboard layout and shortcuts…</M.Item>
      </M.Content>
    </M.Menu>

    <M.Menu>
      <M.Trigger>Help</M.Trigger>
      <M.Content>
        <M.Item onSelect={openIntro}>Guide (build a first song)</M.Item>
        <M.Item onSelect={() => (ui.shortcutsOpen = true)}>Keyboard layout and shortcuts</M.Item>
        <M.Item onSelect={() => (location.href = '/bench')}>Transcription test bench</M.Item>
      </M.Content>
    </M.Menu>
  </M.Root>

  <!-- The project bar, in the middle. -->
  <div class="absolute left-1/2 flex -translate-x-1/2 items-center gap-2" id="tour-project">
    <button class="text-muted-foreground hover:text-foreground px-1 disabled:opacity-30" disabled={!history.undoLabel} onclick={doUndo} title="Undo {history.undoLabel ?? ''} (Ctrl+Z)" aria-label="Undo">↶</button>
    {#if renaming}
      <input
        bind:this={nameInput}
        class="bg-background w-48 rounded border px-2 py-0.5 text-center text-sm font-semibold"
        value={project.name}
        onblur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v) project.name = v;
          renaming = false;
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') renaming = false;
        }}
      />
    {:else}
      <button class="max-w-64 truncate rounded px-2 py-0.5 font-semibold hover:bg-muted" onclick={startRename} title="The song's name: click to rename">{project.name}</button>
    {/if}
    <button
      class="rounded px-1.5 py-0.5 text-xs {status === 'Folder access needed' || status === 'Not saved' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:bg-muted'}"
      onclick={() => (ui.projectsOpen = true)}
      title="Your projects, and where they're kept">{status}</button
    >
    <button class="text-muted-foreground hover:text-foreground px-1 disabled:opacity-30" disabled={!history.redoLabel} onclick={doRedo} title="Redo {history.redoLabel ?? ''} (Ctrl+Y)" aria-label="Redo">↷</button>
  </div>

  <!-- Live input, on the right (and "Offline" when the connection's gone). -->
  <div class="ml-auto flex items-center gap-1.5 pr-2 text-xs">
    {#if monitor.on}
      <button class="rounded bg-sky-600 px-2 py-0.5 text-white" title="Hearing the mic live. Click to stop" onclick={stopMonitor}>🎧 Mic</button>
    {/if}
    {#if automationWrite.on}
      <button class="rounded bg-red-600 px-2 py-0.5 text-white" title="Knob and fader moves while the song plays are written into automation lanes. Click to stop" onclick={() => (automationWrite.on = false)}>● Automation</button>
    {/if}
    {#if !offline.online}
      <button class="rounded bg-amber-500 px-2 py-0.5 text-white" title="No internet: everything saved still works" onclick={() => (ui.offlineOpen = true)}>Offline</button>
    {/if}
    <button
      class="rounded border px-2 py-0.5 {liveKeys.computer ? 'bg-sky-600 border-sky-600 text-white' : 'text-muted-foreground'}"
      onclick={() => setComputerKeys(!liveKeys.computer)}
      title="Computer keyboard plays notes on the selected track (Ctrl+K). Input → Keyboard layout for the keys"
    >
      ⌨ {#if liveKeys.computer}{selectedPoly ? `C${4 + liveKeys.octave} · vel ${Math.round(liveKeys.velocity * 100)}` : liveKeys.shift || liveKeys.slide ? `${formatShift(liveKeys.shift)}${liveKeys.slide ? ' slide' : ''}` : 'on'}{:else}off{/if}
    </button>
    <button
      class="rounded border px-2 py-0.5 {liveKeys.midiInputs.length ? 'bg-emerald-600 border-emerald-600 text-white' : 'text-muted-foreground'}"
      onclick={() => (liveKeys.midi ? disconnectMidi() : connectMidi())}
      title={liveKeys.midiError || (liveKeys.midiInputs.length ? `MIDI: ${liveKeys.midiInputs.join(', ')}` : liveKeys.midi ? 'MIDI on: plug in a keyboard' : 'Connect a MIDI keyboard')}
    >
      MIDI {liveKeys.midiInputs.length ? liveKeys.midiInputs.length : liveKeys.midi ? '·' : 'off'}
    </button>
  </div>

  <input bind:this={importInput} type="file" accept=".humproj,application/json" class="hidden" onchange={(e) => doImport(e.currentTarget.files)} />
  <input
    bind:this={midiInput}
    type="file"
    accept=".mid,.midi,audio/midi"
    class="hidden"
    onchange={async (e) => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = '';
      if (!file) return;
      try {
        const n = await importMidi(file);
        say(n ? `Added ${n} track${n > 1 ? 's' : ''} from ${file.name}` : 'That MIDI file has no notes');
      } catch (err) {
        window.alert(`That MIDI file couldn't be read: ${err instanceof Error ? err.message : err}`);
      }
    }}
  />


</div>
