// A take saved to a file: the raw audio, so the whole analysis can be replayed (e.g. as a
// regression test). Audio is stored as 16-bit PCM in base64 to keep files small.
import type { TimeSignature } from '$lib/music/time';

export interface TakeFile {
  version: 1;
  sampleRate: number;
  bpm: number;
  timeSignature?: TimeSignature; // missing in older takes: 4/4
  audio: string;       // base64 of little-endian 16-bit PCM, mono
  expected?: string[]; // what was actually sung, e.g. ["C3", "D3", "E3"]: fill in by hand
  note?: string;       // anything worth knowing about the take
}

export function encodeTake(
  audio: Float32Array,
  sampleRate: number,
  bpm: number,
  timeSignature: TimeSignature = [4, 4]
): TakeFile {
  const pcm = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    pcm[i] = Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767);
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode can't take millions of arguments at once
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { version: 1, sampleRate, bpm, timeSignature, audio: btoa(binary), expected: [] };
}

export function decodeTakeAudio(take: TakeFile): Float32Array {
  const binary = atob(take.audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const audio = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) audio[i] = pcm[i] / 32767;
  return audio;
}
