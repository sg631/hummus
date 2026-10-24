import * as Tone from 'tone';
import { PPQ } from '$lib/music/time';

let outputDeviceId = ''; // '' = the system default
let started = false;

export async function initAudio() {
  await Tone.start();      // unlock audio; must run inside a click handler
  // Tone counts 192 ticks per beat by default; the app's notes use PPQ.
  Tone.getTransport().PPQ = PPQ;
  if (!started) {
    started = true;
    if (outputDeviceId) await applyOutput();
  }
  return Tone.getContext();
}

// Whether the browser can send audio to a chosen device (Chrome/Edge 110+; not Firefox or Safari yet).
export const canChooseOutput =
  typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

// Where everything the app plays goes. Applies now if audio has started, else when it does.
// Rejects (e.g. NotFoundError) if the device can't be used.
export async function setOutputDevice(deviceId: string) {
  outputDeviceId = deviceId;
  if (started) await applyOutput();
}

async function applyOutput() {
  const raw = Tone.getContext().rawContext as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!raw.setSinkId) throw new Error('This browser can only play through the system default output.');
  await raw.setSinkId(outputDeviceId);
}

// Seconds from a sound being scheduled to the mic hearing a reply to it: the click's
// trip to the speakers plus the voice's trip back in. Browsers report only part of
// it (output side), so this underestimates; latency calibration will replace it.
export function estimateRoundTripLatency(): number {
  const raw = Tone.getContext().rawContext as AudioContext;
  return (raw.outputLatency || 0) + (raw.baseLatency || 0);
}
