// Where projects are kept: this browser's database, or a projects folder on your computer
// (File System Access API: Chrome and Edge). state/projects.svelte.ts uses whichever is on.
//
// Recordings are big and never change once made, so both keep them apart from the rest of
// the project and write each one only once: saving a song after a note edit writes a few
// kilobytes, not every recording again.
//
// In the projects folder, each song is a folder you can see, back up or copy:
//
//   <your projects folder>/
//     My song/
//       project.json        everything but the audio
//       audio/<id>.wav       each recording (32-bit float WAV: any audio editor opens it)
import type { Project } from '$lib/music/types';
import { decodeWav, encodeWav } from '$lib/music/wav';
import { songLength } from '$lib/music/arrange';
import { ticksToSeconds } from '$lib/music/time';
import { cloneDeep } from './clone';
import { database, type StoredProject } from './db';

// What a stored voice clip has in place of its audio.
interface AudioRef {
  audioRef: string;
}

// Each recording's id (made the first time it's saved, kept while the app is open), so it
// isn't written again.
const audioIds = new WeakMap<Float32Array, string>();
function audioId(a: Float32Array): string {
  let id = audioIds.get(a);
  if (!id) audioIds.set(a, (id = crypto.randomUUID()));
  return id;
}

// The project with its recordings swapped for references, and the recordings by id.
function splitAudio(project: Project): { stored: Project; audio: Map<string, { data: Float32Array; sampleRate: number }> } {
  const stored = cloneDeep(project);
  const audio = new Map<string, { data: Float32Array; sampleRate: number }>();
  for (const t of stored.tracks) {
    if (t.kind !== 'voice') continue;
    for (const c of t.clips) {
      const id = audioId(c.audio);
      audio.set(id, { data: c.audio, sampleRate: c.sampleRate });
      (c as unknown as { audio: AudioRef }).audio = { audioRef: id };
    }
  }
  return { stored, audio };
}

// Back again: each reference replaced by its recording (`read` fetches one).
async function joinAudio(stored: Project, read: (id: string) => Promise<Float32Array | undefined>): Promise<Project> {
  for (const t of stored.tracks ?? []) {
    if (t.kind !== 'voice') continue;
    for (const c of t.clips) {
      const ref = (c.audio as unknown as Partial<AudioRef>)?.audioRef;
      if (!ref) continue; // saved with its audio inside (older saves)
      const data = (await read(ref).catch(() => undefined)) ?? new Float32Array(0);
      audioIds.set(data, ref);
      c.audio = data;
    }
  }
  return stored;
}

// A line about a project for the home page: "3 tracks · 100 BPM · 1:24".
export function summarize(project: Project): string {
  const n = project.tracks.length;
  const sec = Math.round(ticksToSeconds(songLength(project), project.bpm));
  const parts = [n ? `${n} track${n === 1 ? '' : 's'}` : 'empty', `${project.bpm} BPM`];
  if (sec) parts.push(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  return parts.join(' · ');
}

export interface ProjectStore {
  readonly kind: 'browser' | 'folder';
  readonly label: string; // "this browser", or the folder's name
  list(): Promise<StoredProject[]>; // newest first
  load(id: string): Promise<Project | undefined>;
  save(id: string, project: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

// ---------- This browser (IndexedDB) ----------

export const browserStore: ProjectStore = {
  kind: 'browser',
  label: 'this browser',
  async list() {
    return database().projects.orderBy('updated').reverse().toArray();
  },
  async load(id) {
    const db = database();
    const stored = await db.projectData.get(id);
    if (!stored) return;
    return joinAudio(stored.project, async (ref) => (await db.audio.get(`${id}/${ref}`))?.data);
  },
  async save(id, project) {
    const db = database();
    const { stored, audio } = splitAudio(project);
    const prefix = `${id}/`;
    const existing = new Set((await db.audio.where('id').startsWith(prefix).primaryKeys()) as string[]);
    await db.transaction('rw', db.projects, db.projectData, db.audio, async () => {
      for (const [ref, a] of audio) if (!existing.has(prefix + ref)) await db.audio.put({ id: prefix + ref, data: a.data });
      await db.audio.bulkDelete([...existing].filter((k) => !audio.has(k.slice(prefix.length)))); // recordings deleted
      await db.projects.put({ id, name: project.name, updated: Date.now(), summary: summarize(project) });
      await db.projectData.put({ id, project: stored });
    });
  },
  async remove(id) {
    const db = database();
    await db.transaction('rw', db.projects, db.projectData, db.audio, async () => {
      await db.projects.delete(id);
      await db.projectData.delete(id);
      await db.audio.where('id').startsWith(`${id}/`).delete();
    });
  }
};

// ---------- A projects folder (File System Access API) ----------
// The browser types don't all include these yet.

type Permission = 'granted' | 'denied' | 'prompt';
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Permission>;
};

export const folderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

interface FolderFile {
  format: 'hum-daw-project-folder';
  version: 1;
  id: string;
  name: string;
  updated: number;
  summary?: string;
  project: Project;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 60) || 'Untitled';

async function readJson(dir: FileSystemDirectoryHandle): Promise<FolderFile | undefined> {
  try {
    const file = await (await dir.getFileHandle('project.json')).getFile();
    const parsed = JSON.parse(await file.text()) as FolderFile;
    return parsed.format === 'hum-daw-project-folder' ? parsed : undefined;
  } catch {
    return undefined; // not one of ours
  }
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | ArrayBuffer | string) {
  const handle = await dir.getFileHandle(name, { create: true });
  const out = await handle.createWritable();
  await out.write(data);
  await out.close();
}

export function folderStore(dir: FileSystemDirectoryHandle): ProjectStore {
  const root = dir as unknown as DirHandle;
  const folders = new Map<string, string>(); // project id → its folder's name

  async function list(): Promise<StoredProject[]> {
    const out: StoredProject[] = [];
    folders.clear();
    for await (const entry of root.values()) {
      if (entry.kind !== 'directory') continue;
      const meta = await readJson(entry as FileSystemDirectoryHandle);
      if (!meta) continue;
      folders.set(meta.id, entry.name);
      out.push({ id: meta.id, name: meta.name, updated: meta.updated, summary: meta.summary });
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  // A new project's folder: its name, made unique.
  async function folderFor(id: string, name: string): Promise<string> {
    const known = folders.get(id);
    if (known) return known;
    if (!folders.size) await list();
    if (folders.get(id)) return folders.get(id)!;
    const taken = new Set(folders.values());
    let folder = safeName(name);
    for (let i = 2; taken.has(folder); i++) folder = `${safeName(name)} (${i})`;
    folders.set(id, folder);
    return folder;
  }

  return {
    kind: 'folder',
    label: root.name,
    list,
    async load(id) {
      if (!folders.has(id)) await list();
      const name = folders.get(id);
      if (!name) return;
      const sub = await root.getDirectoryHandle(name);
      const meta = await readJson(sub);
      if (!meta) return;
      const audioDir = await sub.getDirectoryHandle('audio', { create: true });
      return joinAudio(meta.project, async (ref) => {
        const file = await (await audioDir.getFileHandle(`${ref}.wav`)).getFile();
        return decodeWav(await file.arrayBuffer()).channels[0];
      });
    },
    async save(id, project) {
      const sub = await root.getDirectoryHandle(await folderFor(id, project.name), { create: true });
      const audioDir = await sub.getDirectoryHandle('audio', { create: true });
      const { stored, audio } = splitAudio(project);
      const existing = new Set<string>();
      for await (const entry of audioDir.values()) existing.add(entry.name);
      for (const [ref, a] of audio) if (!existing.has(`${ref}.wav`)) await writeFile(audioDir, `${ref}.wav`, encodeWav([a.data], a.sampleRate, 32));
      for (const name of existing) if (name.endsWith('.wav') && !audio.has(name.slice(0, -4))) await audioDir.removeEntry(name);
      const file: FolderFile = { format: 'hum-daw-project-folder', version: 1, id, name: project.name, updated: Date.now(), summary: summarize(project), project: stored };
      await writeFile(sub, 'project.json', JSON.stringify(file));
    },
    async remove(id) {
      const name = folders.get(id) ?? (await list(), folders.get(id));
      if (name) await root.removeEntry(name, { recursive: true });
      folders.delete(id);
    }
  };
}

// ---------- Remembering the folder ----------
// The folder's handle is kept in the database. Browsers ask again for access to it on a
// later visit (once per visit, after a click): see library.folder in projects.svelte.ts.

const FOLDER_KEY = 'projectsFolder';

export async function savedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!folderSupported) return;
  return (await database().settings.get(FOLDER_KEY))?.value as FileSystemDirectoryHandle | undefined;
}

export async function rememberFolder(dir: FileSystemDirectoryHandle | null) {
  if (dir) await database().settings.put({ key: FOLDER_KEY, value: dir });
  else await database().settings.delete(FOLDER_KEY);
}

// Whether we may use the folder now; `ask`: ask the browser (only works right after a click).
export async function folderAccess(dir: FileSystemDirectoryHandle, ask = false): Promise<Permission> {
  const d = dir as unknown as DirHandle;
  const state = await d.queryPermission({ mode: 'readwrite' });
  return state === 'granted' || !ask ? state : d.requestPermission({ mode: 'readwrite' });
}

// The folder picker (must be called from a click). Null if cancelled.
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    return await picker({ id: 'hum-daw-projects', mode: 'readwrite', startIn: 'documents' });
  } catch {
    return null; // cancelled
  }
}
