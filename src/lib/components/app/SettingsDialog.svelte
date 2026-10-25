<!--
  The Settings window (a modal: it sits over the app until closed). Four tabs:
  - Song: tempo, time signature, key and scale (saved with the project)
  - Recording: count-in, metronome, play-along (saved in this browser)
  - Devices: microphone, speakers, latency calibration (saved in this browser)
  - Transcription: how a sung take becomes notes (saved in this browser)
  Recording and transcription settings apply to the next recording.

  Svelte reminders:
  - bind:open={open} lets the Dialog close itself (Esc, ✕, clicking outside) and tell us.
  - bind:value={() => get, (v) => set} is a binding with your own get and set, for values
    that need converting (e.g. the time signature [3, 4] ↔ the text '3/4').
-->
<script lang="ts">
  import Dropdown from './Dropdown.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import DeviceSelect from '$lib/components/devices/DeviceSelect.svelte';
  import LatencyCalibration from '$lib/components/latency/LatencyCalibration.svelte';
  import BpmWheel from './BpmWheel.svelte';
  import TimeSignatureInput from './TimeSignatureInput.svelte';
  import { KEY_TONICS, SCALES } from '$lib/music/key';
  import { AUTO_GRID, GRID_OPTIONS } from '$lib/music/quantize';
  import { liveInput } from '$lib/state/live-input.svelte';
  import { project } from '$lib/state/project.svelte';
  import { recordingSettings as rec, resetRecordingSettings, saveRecordingSettings } from '$lib/state/settings.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const COUNT_IN_OPTIONS = [0, 1, 2]; // bars
  const take = $derived(rec.take);

  // Save whenever any setting changes (JSON.stringify reads them all, so all are watched).
  $effect(() => {
    void JSON.stringify(rec);
    saveRecordingSettings();
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Description>Song, recording, devices and transcription.</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root value="song">
      <Tabs.List>
        <Tabs.Trigger value="song">Song</Tabs.Trigger>
        <Tabs.Trigger value="recording">Recording</Tabs.Trigger>
        <Tabs.Trigger value="devices">Devices</Tabs.Trigger>
        <Tabs.Trigger value="transcription">Transcription</Tabs.Trigger>
      </Tabs.List>

      <!-- ---------- Song ---------- -->
      <Tabs.Content value="song" class="flex flex-col gap-5 pt-4">
        <div class="flex items-center gap-3">
          <Label>Tempo <span class="text-muted-foreground font-normal">(quarter notes per minute)</span></Label>
          <BpmWheel />
        </div>

        <div class="flex flex-col gap-2">
          <Label>Time signature</Label>
          <TimeSignatureInput />
          <p class="text-muted-foreground text-xs">
            Moves the bar lines, beats and the metronome's accent; notes stay where they are.
            Drum loops become one bar of the new signature, and recorded takes are re-quantized
            in it.
          </p>
        </div>

        <div class="flex flex-wrap items-end gap-4">
          <label class="flex flex-col gap-2 text-sm font-medium">
            Key
            <Dropdown size="default" class="w-28" bind:value={project.key} ariaLabel="Key" options={KEY_TONICS.map((k) => ({ value: k, label: k }))} />
          </label>
          <label class="flex flex-col gap-2 text-sm font-medium">
            Scale
            <Dropdown size="default" class="w-44" bind:value={project.scale} ariaLabel="Scale" options={SCALES.map((k) => ({ value: k, label: k }))} />
          </label>
        </div>
        <p class="text-muted-foreground text-xs">
          The piano roll highlights the notes in this key. Transcription never uses it: what you
          sing is what you get.
        </p>
      </Tabs.Content>

      <!-- ---------- Recording ---------- -->
      <Tabs.Content value="recording" class="flex flex-col gap-5 pt-4">
        <div class="flex flex-col gap-2">
          <Label>Count-in</Label>
          <ToggleGroup.Root
            type="single"
            class="justify-start"
            bind:value={
              () => String(rec.countInBars),
              (v) => {
                if (v) rec.countInBars = Number(v);
              }
            }
          >
            {#each COUNT_IN_OPTIONS as n (n)}
              <ToggleGroup.Item value={String(n)}>{n === 0 ? 'Off' : `${n} bar${n > 1 ? 's' : ''}`}</ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
        </div>

        <div class="flex items-center gap-2">
          <Switch id="metronome" bind:checked={rec.metronome} />
          <Label for="metronome">Metronome (also the metronome button in the top bar)</Label>
        </div>

        <div class="flex items-center gap-2">
          <Switch id="play-along" bind:checked={rec.playAlong} />
          <Label for="play-along">Hear the other tracks while recording</Label>
        </div>
        <p class="text-muted-foreground text-xs">Use headphones, or the mic will hear the other tracks too.</p>
      </Tabs.Content>

      <!-- ---------- Devices ---------- -->
      <Tabs.Content value="devices" class="flex flex-col gap-4 pt-4">
        <DeviceSelect />
        <LatencyCalibration input={liveInput} />
        {#if liveInput.error}
          <p class="text-destructive text-sm">{liveInput.error}</p>
        {/if}
      </Tabs.Content>

      <!-- ---------- Transcription ---------- -->
      <Tabs.Content value="transcription" class="flex flex-col gap-4 pt-4">
        <h3 class="text-sm font-semibold">Note detection</h3>

        <div class="flex flex-col gap-2">
          <Label>Minimum note: {Math.round(take.notes.minNoteSec * 1000)} ms</Label>
          <Slider type="single" bind:value={take.notes.minNoteSec} min={0.03} max={0.4} step={0.005} />
        </div>

        <div class="flex items-center gap-2">
          <Switch id="relative" bind:checked={take.notes.relativeTuning} />
          <Label for="relative">Name notes against your own tuning (not A440)</Label>
        </div>

        {#if take.notes.relativeTuning}
          <div class="flex flex-col gap-2">
            <Label>Tuning follows drift over: {take.notes.referenceSec} s</Label>
            <Slider type="single" bind:value={take.notes.referenceSec} min={2} max={60} step={1} />
          </div>
        {/if}

        <h3 class="mt-2 text-sm font-semibold">Expression</h3>

        <div class="flex flex-col gap-2">
          <Label>Pitch correction: {Math.round(take.expression.correction * 100)}%</Label>
          <Slider type="single" bind:value={take.expression.correction} min={0} max={1} step={0.05} />
        </div>
        <div class="flex flex-col gap-2">
          <Label>Vibrato kept: {Math.round(take.expression.vibrato * 100)}%</Label>
          <Slider type="single" bind:value={take.expression.vibrato} min={0} max={1} step={0.05} />
        </div>
        <div class="flex flex-col gap-2">
          <Label>Drift inside notes kept: {Math.round(take.expression.drift * 100)}%</Label>
          <Slider type="single" bind:value={take.expression.drift} min={0} max={1} step={0.05} />
        </div>
        <div class="flex flex-col gap-2">
          <Label>Scoops, slides and falls kept: {Math.round(take.expression.gestures * 100)}%</Label>
          <Slider type="single" bind:value={take.expression.gestures} min={0} max={1} step={0.05} />
        </div>
        <div class="flex flex-col gap-2">
          <Label>
            Counts as a scoop or fall from {Math.round(take.expression.gestureCents)}¢ and
            {Math.round(take.expression.gestureSec * 1000)} ms
          </Label>
          <Slider type="single" bind:value={take.expression.gestureCents} min={50} max={400} step={10} />
          <Slider type="single" bind:value={take.expression.gestureSec} min={0.05} max={0.4} step={0.01} />
        </div>

        <h3 class="mt-2 text-sm font-semibold">Quantize (new recordings)</h3>
        <p class="text-muted-foreground -mt-2 text-xs">
          Where new takes start. To change a recorded take's quantize and swing, use the
          Quantize bar above the piano roll.
        </p>

        <ToggleGroup.Root
          type="single"
          class="flex-wrap justify-start"
          bind:value={
            () => String(take.quantize.grid),
            (v) => {
              if (v) take.quantize.grid = Number(v);
            }
          }
        >
          {#each GRID_OPTIONS as option (option.ticks)}
            <ToggleGroup.Item value={String(option.ticks)}>{option.label}</ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>

        <div class="flex flex-col gap-2">
          <Label>Strength: {Math.round(take.quantize.strength * 100)}%</Label>
          <Slider type="single" bind:value={take.quantize.strength} min={0} max={1} step={0.05} />
        </div>

        <div class="flex items-center gap-2">
          <Switch id="durations" bind:checked={take.quantize.durations} />
          <Label for="durations">Quantize note lengths</Label>
        </div>

        {#if take.quantize.grid === AUTO_GRID}
          <div class="flex items-center gap-2">
            <Switch
              id="swing-auto"
              bind:checked={
                () => take.quantize.swing === 'auto',
                (on) => (take.quantize.swing = on ? 'auto' : 0.5)
              }
            />
            <Label for="swing-auto">Measure swing from the take</Label>
          </div>
          {#if take.quantize.swing !== 'auto'}
            <div class="flex flex-col gap-2">
              <Label>Swing: {Math.round((take.quantize.swing ?? 0.5) * 100)}% (50 straight, 67 triplet swing)</Label>
              <Slider
                type="single"
                bind:value={
                  () => (typeof take.quantize.swing === 'number' ? take.quantize.swing : 0.5),
                  (v) => (take.quantize.swing = v)
                }
                min={0.5}
                max={0.75}
                step={0.01}
              />
            </div>
          {/if}
        {/if}

        <p class="text-muted-foreground text-xs">
          Applies to the next recording. To see exactly what each setting does to a take, use the
          test bench (/bench).
        </p>
      </Tabs.Content>
    </Tabs.Root>

    <Dialog.Footer>
      <Button variant="outline" onclick={resetRecordingSettings}>Reset recording settings</Button>
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
