// Sounds you added: uploaded audio files and slices of recordings. Kept in this browser's
// database (IndexedDB, with Dexie): they're too big for the project save, and stay
// available to every project here. Drum rows use them as 'u:<id>', sampled instruments
// as their `sample`.
//
//   await loadUserSamples()                      // the list, when the app starts
//   const id = await addUserSample(name, audio, sampleRate)
//   const id = await addUserFile(file)           // decodes an uploaded audio file
//   const buffer = await userSampleBuffer(id)
import Dexie, { type Table } from 'dexie';

interface StoredSample {
  id: string;
  name: string;
  sampleRate: number;
  audio: Float32Array; // mono
  createdAt: number;
}

class SampleDb extends Dexie {
  samples!: Table<StoredSample, string>;
  constructor() {
    super('hum-daw');
    this.version(1).stores({ samples: 'id, name, createdAt' });
  }
}

let db: SampleDb | null = null;
const database = () => (db ??= new SampleDb());

export interface UserSample {
  id: string; // 'u:…'
  name: string;
  seconds: number;
}

// The list (names and lengths only), for the sound and instrument browsers.
export const userSamples = $state({ list: [] as UserSample[], loaded: false });

export async function loadUserSamples() {
  try {
    const all = await database().samples.orderBy('createdAt').toArray();
    userSamples.list = all.map((s) => ({ id: s.id, name: s.name, seconds: s.audio.length / s.sampleRate }));
  } catch (e) {
    console.warn('Your sounds could not be loaded (is this a private window?):', e);
  }
  userSamples.loaded = true;
}

export async function addUserSample(name: string, audio: Float32Array, sampleRate: number): Promise<string> {
  const id = `u:${crypto.randomUUID()}`;
  await database().samples.put({ id, name, sampleRate, audio: new Float32Array(audio), createdAt: Date.now() });
  userSamples.list = [...userSamples.list, { id, name, seconds: audio.length / sampleRate }];
  return id;
}

// Decodes an audio file (wav, mp3, ogg, flac…) to mono and keeps it.
export async function addUserFile(file: File): Promise<string> {
  const { audio, sampleRate } = await decodeFile(file);
  return addUserSample(file.name.replace(/\.[^.]+$/, ''), audio, sampleRate);
}

export async function decodeFile(file: File | Blob): Promise<{ audio: Float32Array; sampleRate: number }> {
  const context = new OfflineAudioContext(1, 1, 44100);
  const decoded = await context.decodeAudioData(await file.arrayBuffer());
  const audio = new Float32Array(decoded.length);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < data.length; i++) audio[i] += data[i] / decoded.numberOfChannels;
  }
  return { audio, sampleRate: decoded.sampleRate };
}

export async function renameUserSample(id: string, name: string) {
  await database().samples.update(id, { name });
  userSamples.list = userSamples.list.map((s) => (s.id === id ? { ...s, name } : s));
}

export async function deleteUserSample(id: string) {
  await database().samples.delete(id);
  userSamples.list = userSamples.list.filter((s) => s.id !== id);
  buffers.delete(id);
}

// ---------- As audio ----------
const buffers = new Map<string, Promise<AudioBuffer | null>>();

// The sound as an AudioBuffer (cached), or null if it's not in this browser.
export function userSampleBuffer(id: string): Promise<AudioBuffer | null> {
  let loading = buffers.get(id);
  if (!loading) {
    loading = database()
      .samples.get(id)
      .then((s) => {
        if (!s) return null;
        const buffer = new AudioBuffer({ length: Math.max(1, s.audio.length), sampleRate: s.sampleRate, numberOfChannels: 1 });
        buffer.copyToChannel(s.audio as Float32Array<ArrayBuffer>, 0);
        return buffer;
      });
    buffers.set(id, loading);
  }
  return loading;
}

export function userSampleName(id: string): string | undefined {
  return userSamples.list.find((s) => s.id === id)?.name;
}
