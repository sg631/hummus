// This browser's database (IndexedDB, through Dexie): your sounds (state/user-samples) and
// your projects (state/projects), voice recordings included. Unlike localStorage it holds
// audio and hundreds of megabytes.
import Dexie, { type Table } from 'dexie';
import type { Project } from '$lib/music/types';

export interface StoredSample {
  id: string;
  name: string;
  sampleRate: number;
  audio: Float32Array; // mono
  createdAt: number;
}

// The project list: names only, so listing doesn't load every song's audio.
export interface StoredProject {
  id: string;
  name: string;
  updated: number; // when it was last saved (ms since 1970)
  summary?: string; // e.g. "3 tracks · 100 BPM · 1:24", for the home page
}

// A project's contents, by the same id. Recordings' audio isn't in it (it would be
// rewritten on every save): each clip's `audio` holds an AudioRef, the samples are in `audio`.
export interface StoredProjectData {
  id: string;
  project: Project;
}

// One recording's samples, stored once: id `<project id>/<audio id>`.
export interface StoredAudio {
  id: string;
  data: Float32Array;
}

// Small things to remember, e.g. the projects folder (a FileSystemDirectoryHandle).
export interface StoredSetting {
  key: string;
  value: unknown;
}

class HumDb extends Dexie {
  samples!: Table<StoredSample, string>;
  projects!: Table<StoredProject, string>;
  projectData!: Table<StoredProjectData, string>;
  audio!: Table<StoredAudio, string>;
  settings!: Table<StoredSetting, string>;
  constructor() {
    super('hum-daw');
    this.version(1).stores({ samples: 'id, name, createdAt' });
    this.version(2).stores({ samples: 'id, name, createdAt', projects: 'id, name, updated', projectData: 'id' });
    this.version(3).stores({ samples: 'id, name, createdAt', projects: 'id, name, updated', projectData: 'id', audio: 'id', settings: 'key' });
  }
}

let db: HumDb | null = null;
export const database = () => (db ??= new HumDb());
