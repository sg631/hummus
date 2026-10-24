// Minimal type declarations for the worklet environment.
// (These exist only for TypeScript; they produce no code.)
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}
declare const currentFrame: number; // sample index (on the context clock) of this call's first sample
declare function registerProcessor(
  name: string,
  processorClass: new () => AudioWorkletProcessor
): void;

const HOP = 512; // samples per block sent to the main thread

interface AnalysisBlock {
  samples: Float32Array;
  frame: number;
}

class AnalysisProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(HOP);
  private filled = 0;

  // Called by the browser for every 128 samples.
  // inputs[0] is the first input; inputs[0][0] is its first channel.
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.block[this.filled++] = channel[i];
        if (this.filled === HOP) {
          // Send a copy, with the context-clock sample index of its first sample.
          const message: AnalysisBlock = { samples: this.block.slice(), frame: currentFrame + i + 1 - HOP };
          this.port.postMessage(message);
          this.filled = 0;
        }
      }
    }
    return true; // keep this processor alive
  }
}

registerProcessor('analysis', AnalysisProcessor);
