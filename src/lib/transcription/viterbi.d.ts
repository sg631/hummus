// Types for viterbi.js (copied from @audio/pitch-pyin).
export interface ViterbiModel {
  S: number;
  init(delta: Float64Array, obs: Float64Array): void;
  step(delta: Float64Array, next: Float64Array, psi: Uint16Array | Int32Array, obs: Float64Array): void;
}

export interface ViterbiDecoder {
  (obs: Float64Array): void;
  end(): void;
}

export default function viterbi(
  model: ViterbiModel,
  emit: (state: number, frame: number) => void,
  lag?: number
): ViterbiDecoder;
