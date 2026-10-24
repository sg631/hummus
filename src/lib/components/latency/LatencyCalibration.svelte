<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import {
    DEFAULT_CALIBRATION,
    measureLatency,
    type CalibrationMode,
    type CalibrationOptions
  } from '$lib/audio/latency-calibration';
  import { latency as sharedLatency, type LatencySetting } from '$lib/state/latency.svelte';
  import type { LatencyResult } from '$lib/music/latency';
  import type { AudioSource } from '$lib/music/types';

  interface Props {
    // The mic. Must be startable from a click (LiveInput is).
    input: AudioSource & { start(): Promise<void>; readonly listening: boolean };
    setting?: LatencySetting;
    modes?: CalibrationMode[];            // which methods to offer, first is the default
    options?: Partial<Record<CalibrationMode, Partial<CalibrationOptions>>>;
    maxManualMs?: number;                 // range of the manual slider
    disabled?: boolean;                   // e.g. while recording
    onapply?: (seconds: number) => void;
  }

  let {
    input,
    setting = sharedLatency,
    modes = ['loopback', 'clap'],
    options = {},
    maxManualMs = 400,
    disabled = false,
    onapply
  }: Props = $props();

  const MODE_LABELS: Record<CalibrationMode, { name: string; help: string }> = {
    loopback: {
      name: 'Speakers',
      help: 'Turn your speakers up and keep the room quiet. The mic listens for the clicks.'
    },
    clap: {
      name: 'Headphones',
      help: 'Clap (or say "ta") exactly on each beep. Small timing errors average out.'
    }
  };

  // Spread below which a measurement is trustworthy.
  const GOOD_SPREAD: Record<CalibrationMode, number> = { loopback: 0.003, clap: 0.025 };

  // Props seed the initial mode and click counts; after that the user's choices win.
  // svelte-ignore state_referenced_locally
  let mode = $state<CalibrationMode>(modes[0]);
  const initialClicks = (m: CalibrationMode) => options[m]?.clicks ?? DEFAULT_CALIBRATION[m].clicks;
  let clickCounts = $state<Record<CalibrationMode, number>>({
    loopback: initialClicks('loopback'),
    clap: initialClicks('clap')
  });

  let running = $state(false);
  let played = $state(-1); // index of the last click heard
  let result = $state.raw<LatencyResult | null>(null);
  let resultMode = $state<CalibrationMode>('loopback');
  let error = $state('');
  let abort: AbortController | null = null;

  const ms = (s: number) => `${(s * 1000).toFixed(s < 0.1 ? 1 : 0)} ms`;
  const total = $derived(result ? result.hits.length : clickCounts[mode]);
  const good = $derived(
    result?.latency != null &&
      result.spread <= GOOD_SPREAD[resultMode] &&
      result.kept >= result.hits.length * 0.6
  );

  async function measure() {
    error = '';
    result = null;
    played = -1;
    await input.start();
    if (!input.listening) {
      error = 'The microphone is not available.';
      return;
    }
    const chosen: CalibrationOptions = {
      ...DEFAULT_CALIBRATION[mode],
      ...options[mode],
      mode,
      clicks: clickCounts[mode]
    };
    abort = new AbortController();
    running = true;
    try {
      result = await measureLatency(input, chosen, (i) => (played = i), abort.signal);
      resultMode = mode;
      if (result.latency === null) {
        error =
          mode === 'loopback'
            ? 'Could not hear the clicks. Turn the speakers up, or use Headphones mode.'
            : 'Could not hear enough claps. Clap louder, closer to the mic.';
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      running = false;
      abort = null;
    }
  }

  function apply() {
    if (result?.latency == null) return;
    setting.setMeasured(result.latency, result.spread);
    onapply?.(result.latency);
    result = null;
  }

  function hitClass(i: number): string {
    if (!result) return i <= played ? 'bg-primary' : 'bg-muted';
    const hit = result.hits[i];
    if (hit.delay === null) return 'bg-destructive/60';
    if (hit.outlier) return 'bg-amber-500';
    return 'bg-emerald-500';
  }
</script>

<section class="flex w-full flex-col gap-4 rounded-lg border p-4">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-sm font-semibold">Latency</h2>
    <p class="text-muted-foreground font-mono text-sm">
      {#if setting.seconds === null}
        estimate (not calibrated)
      {:else}
        {ms(setting.seconds)} · {setting.source}{#if setting.spread !== null}
          (±{ms(setting.spread)}){/if}
      {/if}
    </p>
  </div>

  {#if modes.length > 1}
    <ToggleGroup.Root
      type="single"
      disabled={running || disabled}
      bind:value={
        () => mode,
        (v) => {
          if (v) mode = v as CalibrationMode;
        }
      }
    >
      {#each modes as m (m)}
        <ToggleGroup.Item value={m}>{MODE_LABELS[m].name}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  {/if}
  <p class="text-muted-foreground text-sm">{MODE_LABELS[mode].help}</p>

  <div class="flex flex-col gap-2">
    <Label>Clicks: {clickCounts[mode]}</Label>
    <Slider
      type="single"
      bind:value={clickCounts[mode]}
      min={4}
      max={24}
      step={1}
      disabled={running || disabled}
    />
  </div>

  <div class="flex flex-wrap items-center gap-3">
    {#if running}
      <Button variant="outline" onclick={() => abort?.abort()}>Cancel</Button>
    {:else}
      <Button onclick={measure} {disabled}>Measure</Button>
    {/if}
    <div class="flex flex-wrap gap-1" aria-label="Clicks">
      {#each Array.from({ length: total }, (_, i) => i) as i (i)}
        <span class="size-2.5 rounded-full transition-colors {hitClass(i)}"></span>
      {/each}
    </div>
  </div>

  {#if error}
    <p class="text-destructive text-sm">{error}</p>
  {/if}

  {#if result?.latency != null}
    <div class="bg-muted/40 flex flex-col gap-3 rounded-md p-3">
      <p class="font-mono text-sm">
        {ms(result.latency)}
        <span class="text-muted-foreground">
          · ±{ms(result.spread)} · {result.kept}/{result.hits.length} clicks used
        </span>
      </p>
      {#if !good}
        <p class="text-sm text-amber-600">
          The measurements disagree. It may still be close; measuring again in a quieter room
          (or clapping more steadily) gives a better figure.
        </p>
      {/if}
      <div class="flex gap-2">
        <Button size="sm" onclick={apply}>Use {ms(result.latency)}</Button>
        <Button size="sm" variant="ghost" onclick={() => (result = null)}>Discard</Button>
      </div>
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <Label>Adjust by hand: {ms(setting.seconds ?? 0)}</Label>
    <Slider
      type="single"
      min={0}
      max={maxManualMs}
      step={1}
      disabled={running || disabled}
      bind:value={
        () => Math.round((setting.seconds ?? 0) * 1000),
        (v) => setting.setManual(v / 1000)
      }
    />
    <p class="text-muted-foreground text-xs">
      Notes land late? Increase it. Early? Decrease it.
      {#if setting.seconds !== null}
        <button class="underline" onclick={() => setting.reset()} disabled={running || disabled}>
          Reset to estimate
        </button>
      {/if}
    </p>
  </div>
</section>
