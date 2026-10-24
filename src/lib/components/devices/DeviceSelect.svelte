<script lang="ts">
  import * as Select from '$lib/components/ui/select/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { audioDevices, type AudioDevices, type DeviceOption } from '$lib/state/audio-devices.svelte';
  import { latency } from '$lib/state/latency.svelte';
  import { liveInput } from '$lib/state/live-input.svelte';

  interface Props {
    devices?: AudioDevices;
    disabled?: boolean; // e.g. while recording: switching restarts the mic
  }

  let { devices = audioDevices, disabled = false }: Props = $props();

  // bits-ui treats '' as "nothing selected", so the system default is 'default' here.
  const DEFAULT = 'default';
  const toUi = (id: string) => id || DEFAULT;
  const fromUi = (v: string) => (v === DEFAULT ? '' : v);
  const labelOf = (options: DeviceOption[], id: string) =>
    options.find((o) => o.id === id)?.label ?? 'System default';
  // Names only become readable once the mic is allowed.
  $effect(() => {
    if (liveInput.listening) devices.refresh();
  });

  const unnamed = $derived(devices.inputs.length > 1 && devices.inputs.every((o) => !o.id || /^Microphone \d+$/.test(o.label)));
</script>

<section class="flex w-full flex-col gap-4 rounded-lg border p-4">
  <h2 class="text-sm font-semibold">Devices</h2>

  <div class="flex flex-wrap gap-x-6 gap-y-3">
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <Label>Microphone</Label>
      <Select.Root
        type="single"
        {disabled}
        value={toUi(devices.inputId)}
        onValueChange={(v) => devices.setInput(fromUi(v))}
      >
        <Select.Trigger class="w-full">{labelOf(devices.inputs, devices.inputId)}</Select.Trigger>
        <Select.Content>
          {#each devices.inputs as o (o.id)}
            <Select.Item value={toUi(o.id)} label={o.label} disabled={!o.connected} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <Label>Output</Label>
      {#if devices.canChooseOutput}
        <Select.Root
          type="single"
          {disabled}
          value={toUi(devices.outputId)}
          onValueChange={(v) => devices.setOutput(fromUi(v))}
        >
          <Select.Trigger class="w-full">{labelOf(devices.outputs, devices.outputId)}</Select.Trigger>
          <Select.Content>
            {#each devices.outputs as o (o.id)}
              <Select.Item value={toUi(o.id)} label={o.label} disabled={!o.connected} />
            {/each}
          </Select.Content>
        </Select.Root>
      {:else}
        <p class="text-muted-foreground text-sm">
          This browser plays through the system output only. Choose it in your OS sound settings.
        </p>
      {/if}
    </div>
  </div>

  {#if unnamed}
    <p class="text-muted-foreground text-xs">Device names appear once the microphone is allowed.</p>
  {/if}
  {#if devices.error}
    <p class="text-destructive text-sm">{devices.error}</p>
  {/if}
  <p class="text-muted-foreground text-xs">
    Latency is kept per microphone and output pair:
    {latency.source === 'estimate' ? 'these are not calibrated yet.' : 'using the one measured for these.'}
  </p>
</section>
