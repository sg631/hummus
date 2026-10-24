import { estimateRoundTripLatency } from '$lib/audio/engine';

export type LatencySource = 'estimate' | 'measured' | 'manual';

interface Saved {
  seconds: number;
  source: LatencySource;
  spread: number | null;
  updatedAt: number;
}

const STORAGE_PREFIX = 'hum-daw:latency';

// How late the mic hears what the singer does in time with the app's clicks.
// Recordings are shifted back by this much. It depends on the devices, so it's saved
// per microphone + output pair (in this browser); see useDevices().
export class LatencySetting {
  seconds = $state<number | null>(null); // null: not set, use the browser's estimate
  source = $state<LatencySource>('estimate');
  spread = $state<number | null>(null);  // measurement consistency, seconds
  updatedAt = $state<number | null>(null);

  private storageKey = STORAGE_PREFIX; // the system defaults' key

  constructor() {
    this.load();
  }

  // Switch to the setting for these devices ('' = system default), loading what was
  // measured for them before, or the estimate if they've never been calibrated.
  useDevices(inputId: string, outputId: string) {
    const key = inputId || outputId ? `${STORAGE_PREFIX}:${inputId}|${outputId}` : STORAGE_PREFIX;
    if (key === this.storageKey) return;
    this.storageKey = key;
    this.seconds = null;
    this.source = 'estimate';
    this.spread = null;
    this.updatedAt = null;
    this.load();
  }

  // The value to use. The estimate needs the audio context, so call after audio starts.
  get value(): number {
    return this.seconds ?? estimateRoundTripLatency();
  }

  setMeasured(seconds: number, spread: number) {
    this.set(seconds, 'measured', spread);
  }

  setManual(seconds: number) {
    this.set(seconds, 'manual', null);
  }

  reset() {
    this.seconds = null;
    this.source = 'estimate';
    this.spread = null;
    this.updatedAt = null;
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // storage unavailable: the setting just won't persist
    }
  }

  private set(seconds: number, source: LatencySource, spread: number | null) {
    this.seconds = seconds;
    this.source = source;
    this.spread = spread;
    this.updatedAt = Date.now();
    const saved: Saved = { seconds, source, spread, updatedAt: this.updatedAt };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(saved));
    } catch {
      // storage unavailable: the setting just won't persist
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved;
      if (typeof saved.seconds !== 'number' || !Number.isFinite(saved.seconds)) return;
      this.seconds = saved.seconds;
      this.source = saved.source;
      this.spread = saved.spread;
      this.updatedAt = saved.updatedAt;
    } catch {
      // missing or corrupt: keep the estimate
    }
  }
}

// One per app, like the mic.
export const latency = new LatencySetting();
