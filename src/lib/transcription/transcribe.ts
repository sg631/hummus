import { analyzeAudio } from './analyze';
import type { Transcription } from './types';

// Analyse a whole recording (e.g. an imported file).
export function transcribeAudio(audio: Float32Array, sampleRate: number): Transcription {
  return { ...analyzeAudio(audio, sampleRate), audio, sampleRate, duration: audio.length / sampleRate };
}
