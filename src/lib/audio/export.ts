// Exporting the song as audio (File → Export audio): rendered offline, faster than it plays,
// through exactly what Play uses (audio/mixer.ts), then written as WAV or MP3.
//
//   const audio = await renderSong(project, { from, to })   // an AudioBuffer (stereo)
//   downloadBlob(toWav(audio), 'song.wav')
//   downloadBlob(await toMp3(audio, 192), 'song.mp3')
import * as Tone from 'tone';
import { initAudio } from './engine';
import { effectsReady, loadProjectSamples, releaseExport, scheduleProject, stopProject } from './mixer';
import { encodeWav } from '$lib/music/wav';
import { secondsBetween } from '$lib/music/automation';
import { PPQ } from '$lib/music/time';
import type { Project } from '$lib/music/types';

const SAMPLE_RATE = 44100;
const TAIL_SEC = 2; // after the last note: reverb and echoes ring out

// Renders `from`–`to` (ticks) of the song. Stops anything playing first.
export async function renderSong(project: Project, { from = 0, to }: { from?: number; to: number }): Promise<AudioBuffer> {
  await initAudio();
  await loadProjectSamples(project);
  stopProject();
  const seconds = secondsBetween(project, from, Math.max(from, to)) + TAIL_SEC; // follows a tempo lane
  const rendered = await Tone.Offline(async ({ transport }) => {
    // An offline transport starts at Tone's 192 ticks per beat; the song's ticks are PPQ (480)
    // per beat, as on the live transport (audio/engine.ts). Without this it plays 2.5× slower.
    transport.PPQ = PPQ;
    transport.bpm.value = project.bpm;
    transport.timeSignature = project.timeSignature;
    transport.ticks = from;
    Tone.getDestination().volume.value = project.masterVolume;
    scheduleProject(project);
    await effectsReady();
    transport.start(0);
  }, seconds, 2, SAMPLE_RATE);
  releaseExport();
  return rendered.get()!;
}

// Gently brings anything louder than 0 dB down to just under it (no clipping in the file).
function channels(buffer: AudioBuffer): Float32Array[] {
  const out = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let peak = 0;
  for (const ch of out) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak <= 0.999) return out;
  const gain = 0.999 / peak;
  return out.map((ch) => ch.map((s) => s * gain));
}

export function toWav(buffer: AudioBuffer): Blob {
  return new Blob([encodeWav(channels(buffer), buffer.sampleRate, 16)], { type: 'audio/wav' });
}

// MP3 at `kbps` (128, 192, 320). The encoder (lamejs) loads the first time.
export async function toMp3(buffer: AudioBuffer, kbps = 192): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const [left, right = left] = channels(buffer);
  const toInt16 = (ch: Float32Array) => Int16Array.from(ch, (s) => Math.max(-1, Math.min(1, s)) * 0x7fff);
  const l = toInt16(left);
  const r = toInt16(right);
  const encoder = new Mp3Encoder(2, buffer.sampleRate, kbps);
  const parts: Uint8Array[] = [];
  const BLOCK = 1152 * 20;
  for (let i = 0; i < l.length; i += BLOCK) {
    const chunk = encoder.encodeBuffer(l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK));
    if (chunk.length) parts.push(new Uint8Array(chunk));
    if (i % (BLOCK * 50) === 0) await new Promise((res) => setTimeout(res, 0)); // let the page breathe
  }
  const end = encoder.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

// The song with only `trackId` heard (every other track muted; buses and automation as
// they are). For stems and bouncing.
export function onlyTrack(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, mute: t.id !== trackId, solo: false })) };
}

// A track rendered to audio, mono (as voice recordings are), without the master's effects
// and volume (they'd be applied twice when it plays as a new track).
export async function bounceTrack(project: Project, trackId: string, to: number): Promise<{ audio: Float32Array; sampleRate: number }> {
  const buffer = await renderSong({ ...onlyTrack(project, trackId), masterEffects: [], masterVolume: 0, automation: project.automation.filter((l) => l.target?.ownerId !== 'master') }, { from: 0, to });
  const l = buffer.getChannelData(0);
  const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  const audio = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) audio[i] = (l[i] + r[i]) / 2;
  return { audio, sampleRate: buffer.sampleRate };
}
