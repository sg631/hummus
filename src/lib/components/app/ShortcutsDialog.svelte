<!--
  Input → Keyboard layout and shortcuts: the note keys drawn as a keyboard, what the
  other keys do on one-note and polyphonic tracks, and the app's shortcuts.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { COMPACT_KEYS, PIANO_KEYS, keyLabel } from '$lib/music/keyboard';
  import { liveKeys, setComputerKeys, setKeyLayout } from '$lib/state/live-keys.svelte';
  import { ui } from '$lib/state/ui.svelte';

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const keys = Object.entries(PIANO_KEYS);
  const compact = Object.entries(COMPACT_KEYS);
  const white = keys.filter(([, s]) => !NAMES[s % 12].includes('#'));
  const black = keys.filter(([, s]) => NAMES[s % 12].includes('#'));
  // A black key sits between the white keys either side of it.
  const blackLeft = (s: number) => white.findIndex(([, w]) => w === s - 1) + 1;

  const MONO: [string, string][] = [
    ['Z  X  C  V (hold)', 'octaves: −2, −1, +1, +2'],
    ['1 … 9, 0 (hold)', 'up that many semitones (0 = 10)'],
    ['− with a number', 'down instead'],
    ['` (hold)', 'slide into the next note (no new attack)'],
    ['two keys at once', 'the last one sounds; let go and the other comes back']
  ];
  const POLY: [string, string][] = [
    ['Z  /  X', 'octave down / up'],
    ['C  /  V', 'softer / louder'],
    ['several keys', 'a chord']
  ];
  const APP: [string, string][] = [
    ['Ctrl+K', 'computer keyboard: notes ↔ shortcuts'],
    ['Ctrl+drag a knob', 'onto an automation lane (playlist → + Lane first)'],
    ['Space', 'play / stop'],
    ['Ctrl+Z, Ctrl+Y', 'undo, redo (anything)'],
    ['Ctrl+S, Ctrl+O', 'save, open a project'],
    ['Piano roll', 'Delete, arrows, Ctrl+C / V / D / A, Q quantize… (its Keys list)']
  ];
</script>

<Dialog.Root bind:open={ui.shortcutsOpen}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Playing from the keyboard</Dialog.Title>
      <Dialog.Description>
        Turn it on with <kbd class="bg-muted rounded border px-1 font-mono text-xs">Ctrl+K</kbd> (or ⌨ in the menu bar); it plays the selected track. While it's on, letter
        keys play notes instead of shortcuts. Drum tracks: the keys play the rows in order.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Which layout, and its keys. -->
    <div class="flex items-center justify-center gap-1 text-sm">
      <span class="text-muted-foreground mr-1">Layout</span>
      <Button size="sm" variant={liveKeys.layout === 'compact' ? 'default' : 'outline'} onclick={() => setKeyLayout('compact')}>Compact</Button>
      <Button size="sm" variant={liveKeys.layout === 'piano' ? 'default' : 'outline'} onclick={() => setKeyLayout('piano')}>Piano</Button>
    </div>
    {#if liveKeys.layout === 'compact'}
      <!-- One octave: a semitone per key, home row then top row. -->
      <div class="mx-auto flex flex-col gap-1 select-none">
        {#each [compact.slice(6), compact.slice(0, 6)] as row, r (r)}
          <div class="flex gap-1" style="margin-left: {r === 0 ? 0 : 14}px">
            {#each row as [code, s] (code)}
              <div class="flex h-12 w-12 flex-col items-center justify-center rounded border {NAMES[s % 12].includes('#') ? 'bg-gray-900 text-white' : 'bg-white text-black'}">
                <span class="font-mono text-sm font-bold">{keyLabel(code)}</span>
                <span class="text-[9px] opacity-60">{NAMES[s % 12]}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
      <p class="text-muted-foreground text-center text-xs">A plays middle C, then up a semitone per key: A S D F G H, then Q W E R T Y. One octave; use Z X C V for others.</p>
    {:else}
    <!-- The note keys as a little piano. -->
    <div class="relative mx-auto h-28 select-none" style="width: {white.length * 40}px">
      {#each white as [code, s], i (code)}
        <div class="absolute bottom-0 flex h-28 w-10 flex-col items-center justify-end rounded-b border bg-white pb-1 text-black" style="left: {i * 40}px">
          <span class="font-mono text-sm font-bold">{keyLabel(code)}</span>
          <span class="text-[9px] text-gray-500">{NAMES[s % 12]}</span>
        </div>
      {/each}
      {#each black as [code, s] (code)}
        <div class="absolute top-0 z-10 flex h-16 w-7 flex-col items-center justify-end rounded-b bg-gray-900 pb-1 text-white" style="left: {blackLeft(s) * 40 - 14}px">
          <span class="font-mono text-xs font-bold">{keyLabel(code)}</span>
          <span class="text-[8px] text-gray-400">{NAMES[s % 12]}</span>
        </div>
      {/each}
    </div>
    <p class="text-muted-foreground text-center text-xs">A plays middle C. Every key is its own semitone.</p>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2">
      {#each [['One note at a time (most tracks)', MONO], ['Polyphonic tracks (Allow Polyphony on)', POLY]] as [title, rows] (title)}
        <div>
          <h3 class="mb-1 text-sm font-semibold">{title}</h3>
          <table class="w-full text-xs">
            <tbody>
              {#each rows as [k, what] (k)}
                <tr><td class="py-0.5 pr-3 whitespace-nowrap"><kbd class="bg-muted rounded border px-1 font-mono">{k}</kbd></td><td class="text-muted-foreground">{what}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
    </div>
    <div>
      <h3 class="mb-1 text-sm font-semibold">Shortcuts</h3>
      <table class="w-full text-xs">
        <tbody>
          {#each APP as [k, what] (k)}
            <tr><td class="py-0.5 pr-3 whitespace-nowrap"><kbd class="bg-muted rounded border px-1 font-mono">{k}</kbd></td><td class="text-muted-foreground">{what}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-muted-foreground text-xs">
      Some keyboards can't report every combination of keys held at once: if a key seems ignored while holding others, that's the keyboard ("ghosting"). A MIDI keyboard
      (Input menu) has no such limit.
    </p>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => setComputerKeys(!liveKeys.computer)}>{liveKeys.computer ? 'Turn keyboard notes off' : 'Turn keyboard notes on'}</Button>
      <Button onclick={() => (ui.shortcutsOpen = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
