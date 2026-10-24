import { canChooseOutput, setOutputDevice } from '$lib/audio/engine';
import { latency } from './latency.svelte';
import { liveInput } from './live-input.svelte';

export interface DeviceOption {
  id: string;     // '' = the system default
  label: string;
  connected: boolean;
}

interface Saved {
  inputId: string;
  outputId: string;
}

const STORAGE_KEY = 'hum-daw:devices';

// Which microphone and output the app uses, remembered in this browser. A remembered
// device that's unplugged stays chosen (and shows as not connected) rather than the app
// quietly switching to another one.
export class AudioDevices {
  inputs = $state.raw<DeviceOption[]>([]);
  outputs = $state.raw<DeviceOption[]>([]);
  inputId = $state('');
  outputId = $state('');
  error = $state('');
  readonly canChooseOutput = canChooseOutput;

  constructor() {
    this.load();
    liveInput.deviceId = this.inputId;
    latency.useDevices(this.inputId, this.outputId);
    if (this.outputId) setOutputDevice(this.outputId).catch((e) => this.fail(e));
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => this.refresh());
      this.refresh();
    }
  }

  // Re-read the device list. Browsers only give names once the mic has been allowed.
  async refresh() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.inputs = this.options(all, 'audioinput', this.inputId, 'Microphone');
      this.outputs = this.options(all, 'audiooutput', this.outputId, 'Output');
    } catch (e) {
      this.fail(e);
    }
  }

  // Don't call while recording: the mic restarts.
  async setInput(id: string) {
    this.error = '';
    this.inputId = id;
    this.save();
    latency.useDevices(this.inputId, this.outputId);
    await liveInput.useDevice(id);
    await this.refresh();
  }

  async setOutput(id: string) {
    this.error = '';
    this.outputId = id;
    this.save();
    latency.useDevices(this.inputId, this.outputId);
    try {
      await setOutputDevice(id);
    } catch (e) {
      this.fail(e);
    }
    await this.refresh();
  }

  private options(
    all: MediaDeviceInfo[],
    kind: MediaDeviceKind,
    chosen: string,
    noun: string
  ): DeviceOption[] {
    // Chrome lists the defaults again as 'default' and 'communications'; '' stands for them.
    const devices = all.filter(
      (d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'
    );
    const options: DeviceOption[] = [
      { id: '', label: 'System default', connected: true },
      ...devices.map((d, i) => ({ id: d.deviceId, label: d.label || `${noun} ${i + 1}`, connected: true }))
    ];
    if (chosen && !devices.some((d) => d.deviceId === chosen)) {
      options.push({ id: chosen, label: `Chosen ${noun.toLowerCase()} (not connected)`, connected: false });
    }
    return options;
  }

  private fail(e: unknown) {
    this.error =
      e instanceof DOMException && e.name === 'NotFoundError'
        ? 'The chosen output is not connected. Pick another one.'
        : e instanceof Error
          ? e.message
          : String(e);
  }

  private save() {
    const saved: Saved = { inputId: this.inputId, outputId: this.outputId };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // storage unavailable: the choice just won't persist
    }
  }

  private load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null;
      if (typeof saved?.inputId === 'string') this.inputId = saved.inputId;
      if (typeof saved?.outputId === 'string') this.outputId = saved.outputId;
    } catch {
      // missing or corrupt: system defaults
    }
  }
}

// One per app, like the mic.
export const audioDevices = new AudioDevices();
