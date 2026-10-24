import type { BaseContext } from 'tone';
import { PitchDetector } from 'pitchy';
import processorUrl from './analysis-processor.ts?worker&url';
import type { PitchFrame } from '$lib/music/types';

export interface PitchTrackerCallbacks {
  onFrame: (frame: PitchFrame) => void;
  // Every raw mic block, with the time of its first sample. All times are on the
  // AudioContext clock (context.currentTime), the same clock Tone schedules on.
  onBlock?: (block: Float32Array, time: number) => void;
}

export interface PitchTracker {
  stop(): void;
}

const WINDOW = 2048;
const HOP = 512; // must match analysis-processor.ts

let processorLoaded = false;

// `deviceId`: the microphone to use; '' = the system default.
export async function startPitchTracking(
  context: BaseContext,
  { onFrame, onBlock }: PitchTrackerCallbacks,
  deviceId = ''
): Promise<PitchTracker> {
  // Load the worklet code into the audio thread (only needed once).
  if (!processorLoaded) {
    await context.addAudioWorkletModule(processorUrl);
    processorLoaded = true;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  // Graph: mic → analysis worklet → silent gain → speakers
  const source = context.createMediaStreamSource(stream);
  const node = context.createAudioWorkletNode('analysis');
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(node);
  node.connect(silent);
  silent.connect(context.rawContext.destination);

  const analysisWindow = new Float32Array(WINDOW);
  const detector = PitchDetector.forFloat32Array(WINDOW);
  let samplesSeen = 0;

  node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; frame: number }>) => {
    const { samples: block, frame } = event.data;
    const blockTime = frame / context.sampleRate;

    // Slide the window: drop the oldest HOP samples, append the new block.
    analysisWindow.copyWithin(0, HOP);
    analysisWindow.set(block, WINDOW - HOP);
    samplesSeen += HOP;
    onBlock?.(block, blockTime);

    // Wait until the window has been completely filled once.
    if (samplesSeen < WINDOW) return;

    let sum = 0;
    for (let i = 0; i < WINDOW; i++) sum += analysisWindow[i] * analysisWindow[i];
    const rms = Math.sqrt(sum / WINDOW);

    const [hz, clarity] = detector.findPitch(analysisWindow, context.sampleRate);

    // The reading describes the whole window (ending with this block), so timestamp its center.
    const time = blockTime + (HOP - WINDOW / 2) / context.sampleRate;

    onFrame({ time, hz, clarity, rms });
  };

  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    }
  };
}