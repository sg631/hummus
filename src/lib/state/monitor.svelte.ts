// Hearing yourself (Input → Hear the mic): the microphone, live, through the selected voice
// track's effects (reverb on your voice while you sing), or straight through for any other
// track. Use headphones: through speakers the mic hears itself and howls.
//
//   await startMonitor(); stopMonitor()
import * as Tone from 'tone';
import { initAudio } from '$lib/audio/engine';
import { createEffect, type EffectNode } from '$lib/audio/effects';
import { liveInput } from './live-input.svelte';
import { project, selectedTrack } from './project.svelte';

export const monitor = $state({ on: false, error: '', trackName: '' });

let mic: Tone.UserMedia | null = null;
let chain: { nodes: EffectNode[]; channel: Tone.Channel; key: string } | null = null;

// The chain the mic plays through: the selected voice track's effects, volume and pan.
function rebuild() {
  const t = selectedTrack();
  const voice = t?.kind === 'voice' ? t : undefined;
  const key = JSON.stringify(voice ? [voice.id, voice.effects, voice.volume, voice.pan] : 'none');
  if (chain?.key === key || !mic) return;
  mic.disconnect();
  if (chain) for (const n of [...chain.nodes.map((x) => x.node), chain.channel]) n.dispose();
  const nodes = (voice?.effects ?? []).filter((e) => e.enabled).map((e) => createEffect(e));
  const channel = new Tone.Channel({ volume: voice?.volume ?? 0, pan: voice?.pan ?? 0, channelCount: 2 }).toDestination();
  let last: Tone.ToneAudioNode = mic;
  for (const n of nodes) {
    last.connect(n.node);
    last = n.node;
  }
  last.connect(channel);
  chain = { nodes, channel, key };
  monitor.trackName = voice?.name ?? '';
}

let watcher: (() => void) | null = null;

export async function startMonitor(): Promise<boolean> {
  monitor.error = '';
  try {
    await initAudio();
    mic = new Tone.UserMedia();
    await mic.open(liveInput.deviceId || undefined);
    monitor.on = true;
    rebuild();
    // Follow the selected track and its effects while on.
    watcher = $effect.root(() => {
      $effect(() => {
        void JSON.stringify([selectedTrack()?.id, project.tracks.map((t) => (t.kind === 'voice' ? [t.effects, t.volume, t.pan] : 0))]);
        rebuild();
      });
    });
    return true;
  } catch {
    monitor.error = 'The microphone is blocked: allow it in the browser.';
    stopMonitor();
    return false;
  }
}

export function stopMonitor() {
  watcher?.();
  watcher = null;
  mic?.close();
  mic?.dispose();
  mic = null;
  if (chain) for (const n of [...chain.nodes.map((x) => x.node), chain.channel]) n.dispose();
  chain = null;
  monitor.on = false;
  monitor.trackName = '';
}
