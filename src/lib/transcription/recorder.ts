// Growing mono sample buffer for one take.
export class AudioRecorder {
  private data = new Float32Array(48000 * 10);
  private length = 0;

  constructor(readonly sampleRate: number) {}

  get duration(): number {
    return this.length / this.sampleRate;
  }

  append(block: Float32Array) {
    if (this.length + block.length > this.data.length) {
      const grown = new Float32Array(Math.max(this.data.length * 2, this.length + block.length));
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    this.data.set(block, this.length);
    this.length += block.length;
  }

  // The samples so far without copying; only valid until the next append.
  view(): Float32Array {
    return this.data.subarray(0, this.length);
  }

  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}
