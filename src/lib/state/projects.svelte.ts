// Your projects: kept in this browser's database, or in a projects folder you choose
// (state/project-store.ts), voice recordings included, and saved automatically a moment
// after each change. The File menu and the project name in the middle of the menu bar use
// these.
//
//   await initProjects()          // when the app opens: the last project you had open
//   newProject(); openProject(id); saveNow(); saveAs('Song 2'); deleteProject(id)
//   chooseProjectsFolder(); allowFolder(); stopUsingFolder()
//   exportProjectFile(); importProjectFile(file)   // a .humproj file: share or back up a song
//
// The projects folder: browsers let a page keep a folder's location, but ask you again for
// access on a later visit. Until you allow it, `library.folder.state` is 'needs-permission'
// and nothing is saved (FolderAccessDialog shows the folder and how to allow it).
import type { Project } from '$lib/music/types';
import { downloadBlob } from '$lib/download';
import { cloneDeep } from './clone';
import type { StoredProject } from './db';
import { clearHistory, commit, onProjectChange } from './history.svelte';
import { applyProject, blankProject, project } from './project.svelte';
import { ui } from './ui.svelte';
import { browserStore, folderAccess, folderStore, pickFolder, rememberFolder, savedFolder, type ProjectStore } from './project-store';

const CURRENT_KEY = 'hum-daw:current-project';
const LEGACY_KEY = 'hum-daw:project'; // where older versions saved (localStorage, no audio)
const AUTOSAVE_MS = 1500;

export const library = $state({
  list: [] as StoredProject[], // newest first
  currentId: '',
  status: 'saved' as 'saved' | 'unsaved' | 'saving' | 'error' | 'paused',
  savedAt: 0,
  autosave: true,
  ready: false,
  canOpen: false, // a place to open projects from is available (a folder may be waiting for access)
  where: 'this browser', // the store's label: "this browser" or the folder's name
  folder: {
    state: 'none' as 'none' | 'granted' | 'needs-permission' | 'denied',
    name: '' // the folder's name (browsers don't tell pages its full path)
  }
});

let store: ProjectStore | null = browserStore;
let pendingFolder: FileSystemDirectoryHandle | null = null; // remembered, waiting for access
let timer: ReturnType<typeof setTimeout> | undefined;
let quiet = false; // while a project is being put in place: that isn't an edit

function useStore(next: ProjectStore | null) {
  store = next;
  library.where = next?.label ?? '';
  library.canOpen = !!next;
}

async function refreshList() {
  library.list = store ? await store.list() : [];
}

// Saves the open project now (Ctrl+S, the Save button; autosave calls it too).
export async function saveNow(): Promise<boolean> {
  clearTimeout(timer);
  if (!library.currentId || !store) return false;
  library.status = 'saving';
  try {
    commit(); // the last edit becomes an undo step, too
    await store.save(library.currentId, project);
    library.status = 'saved';
    library.savedAt = Date.now();
    await refreshList();
    return true;
  } catch (e) {
    console.warn('Saving failed:', e);
    library.status = 'error';
    return false;
  }
}

// Puts a project in place as the open one.
function open(id: string, data: Project) {
  quiet = true;
  library.currentId = id;
  localStorage.setItem(CURRENT_KEY, id);
  const fixed = applyProject(cloneDeep(data));
  if (fixed.length) {
    console.warn('Repaired in this project:', fixed);
    ui.message = `Repaired ${fixed.length} broken setting${fixed.length > 1 ? 's' : ''} in this project (details in the console)`;
    setTimeout(() => (ui.message = ''), 5000);
  }
  clearHistory();
  library.status = 'saved';
  setTimeout(() => (quiet = false), 0);
}

// Saves what's open, then starts an empty song.
export async function newProject(name = nextName()) {
  if (library.status === 'unsaved') await saveNow();
  open(crypto.randomUUID(), blankProject(name));
  await saveNow();
}

// Opens a project by id (the studio's URL says which). False if there's no such project.
export async function openProject(id: string): Promise<boolean> {
  if (!store) return false;
  if (id === library.currentId) return true;
  if (library.status === 'unsaved') await saveNow();
  const loaded = await store.load(id).catch(() => undefined);
  if (!loaded) return false;
  open(id, loaded);
  return true;
}

// A copy of the open song under a new name, which stays open.
export async function saveAs(name: string) {
  library.currentId = crypto.randomUUID();
  localStorage.setItem(CURRENT_KEY, library.currentId);
  project.name = name;
  await saveNow();
}

export async function deleteProject(id: string) {
  if (!store) return;
  await store.remove(id);
  await refreshList();
  if (id !== library.currentId) return;
  library.currentId = ''; // nothing open now (the studio goes home)
}

// Renames any project (the open one: straight away, then autosaved).
export async function renameProject(id: string, name: string) {
  if (id === library.currentId) {
    project.name = name;
    await saveNow();
    return;
  }
  const loaded = await store?.load(id);
  if (!loaded || !store) return;
  await store.save(id, { ...loaded, name });
  await refreshList();
}

// A copy of any project, under a new name (doesn't open it).
export async function duplicateProject(id: string) {
  if (!store) return;
  if (id === library.currentId && library.status === 'unsaved') await saveNow();
  const loaded = id === library.currentId ? (cloneDeep(project) as Project) : await store.load(id);
  if (!loaded) return;
  const names = new Set(library.list.map((p) => p.name));
  let name = `${loaded.name} copy`;
  for (let i = 2; names.has(name); i++) name = `${loaded.name} copy ${i}`;
  await store.save(crypto.randomUUID(), { ...loaded, name });
  await refreshList();
}

// Downloads any project as a .humproj file.
export async function exportProjectById(id: string) {
  if (id === library.currentId) return exportProjectFile();
  const loaded = await store?.load(id);
  if (loaded) exportProjectFile(loaded);
}

function nextName(): string {
  const names = new Set(library.list.map((p) => p.name));
  for (let i = 1; ; i++) if (!names.has(`Song ${i}`)) return `Song ${i}`;
}

// Opens the last project you had open (or the newest, or a new one). Returns its id.
export async function openLastOrNew(): Promise<string> {
  await refreshList();
  const want = localStorage.getItem(CURRENT_KEY);
  const id = library.list.find((p) => p.id === want)?.id ?? library.list[0]?.id;
  if (id && (await openProject(id))) return id;
  await newProject('Untitled');
  return library.currentId;
}

// After switching where projects are kept: the same project if it's there too, else the last.
async function reopen() {
  const id = library.currentId;
  library.currentId = '';
  await refreshList();
  if (!id || !(await openProject(id))) await openLastOrNew();
}

// ---------- The projects folder ----------

// Pick a folder for your projects (from a click). The projects in this browser are copied
// into it (the browser keeps its copies as a backup), then the folder is used from now on.
// Returns how many were copied, or null if cancelled.
export async function chooseProjectsFolder(): Promise<number | null> {
  const dir = await pickFolder();
  if (!dir) return null;
  if ((await folderAccess(dir, true)) !== 'granted') return null;
  if (library.status === 'unsaved') await saveNow();
  const target = folderStore(dir);
  const there = new Set((await target.list()).map((p) => p.id));
  let copied = 0;
  for (const p of await browserStore.list()) {
    if (there.has(p.id)) continue;
    const data = await browserStore.load(p.id);
    if (data) {
      await target.save(p.id, { ...data, name: p.name });
      copied++;
    }
  }
  await rememberFolder(dir);
  pendingFolder = null;
  library.folder = { state: 'granted', name: dir.name };
  useStore(target);
  await reopen();
  return copied;
}

// The remembered folder needs access again: ask (from a click on "Allow").
export async function allowFolder(): Promise<boolean> {
  if (!pendingFolder) return false;
  const state = await folderAccess(pendingFolder, true);
  if (state !== 'granted') {
    library.folder.state = 'denied';
    return false;
  }
  library.folder.state = 'granted';
  useStore(folderStore(pendingFolder));
  pendingFolder = null;
  library.status = 'saved';
  await refreshList(); // the studio opens the project in its address
  return true;
}

// Back to keeping projects in this browser; the folder and its files are left as they are.
export async function stopUsingFolder() {
  if (library.status === 'unsaved' && library.folder.state === 'granted') await saveNow();
  await rememberFolder(null);
  pendingFolder = null;
  library.folder = { state: 'none', name: '' };
  useStore(browserStore);
  await reopen();
}

// ---------- Project files (.humproj) ----------
// JSON, with each recording's audio as base64 (its 32-bit samples), so one file carries the
// whole song. Your sounds (uploads, slices) aren't in it: they stay in this browser.

interface ProjectFile {
  format: 'hum-daw-project';
  version: 1;
  project: Project;
  audio: string[]; // base64; voice clips' `audio` holds { file: index } instead
}

function toBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(s: string): Float32Array {
  const text = atob(s);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function exportProjectFile(from: Project = project) {
  const copy = cloneDeep(from) as Project;
  const audio: string[] = [];
  for (const t of copy.tracks) {
    if (t.kind !== 'voice') continue;
    for (const c of t.clips) {
      audio.push(toBase64(c.audio));
      (c as unknown as { audio: { file: number } }).audio = { file: audio.length - 1 };
    }
  }
  const file: ProjectFile = { format: 'hum-daw-project', version: 1, project: copy, audio };
  downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${copy.name || 'song'}.humproj`);
}

// Opens a .humproj file as a new project (the open one is saved first).
export async function importProjectFile(file: File) {
  const parsed = JSON.parse(await file.text()) as ProjectFile;
  if (parsed.format !== 'hum-daw-project') throw new Error('not a hum-daw project file');
  for (const t of parsed.project.tracks) {
    if (t.kind !== 'voice') continue;
    for (const c of t.clips) c.audio = fromBase64(parsed.audio[(c.audio as unknown as { file: number }).file]);
  }
  if (library.status === 'unsaved') await saveNow();
  open(crypto.randomUUID(), parsed.project);
  await saveNow();
}

// ---------- Starting up ----------

// When the app starts: where projects are kept, and the list (nothing is opened: the studio
// opens the project in its address). With a projects folder: if the browser still allows it;
// otherwise it waits for you to allow it (library.folder.state). Projects saved by older
// versions (localStorage, without recordings) are moved into the database.
export async function initProjects() {
  try {
    const dir = await savedFolder();
    if (dir) {
      library.folder.name = dir.name;
      if ((await folderAccess(dir)) === 'granted') {
        library.folder.state = 'granted';
        useStore(folderStore(dir));
        await refreshList();
      } else {
        // Can't ask without a click: wait (nothing saved meanwhile, so nothing diverges).
        library.folder.state = 'needs-permission';
        pendingFolder = dir;
        useStore(null);
        library.status = 'paused';
      }
    } else {
      useStore(browserStore);
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && !(await browserStore.list()).length) {
        open(crypto.randomUUID(), JSON.parse(legacy) as Project);
        await saveNow();
        localStorage.removeItem(LEGACY_KEY);
      }
      await refreshList();
    }
  } catch (e) {
    // No database (private window…): work without saving.
    console.warn('Projects could not be loaded; changes will not be saved:', e);
    library.status = 'error';
  }
  library.ready = true;

  // Autosave: a moment after each change.
  onProjectChange(() => {
    if (quiet || !library.ready || !library.currentId || !store) return;
    library.status = 'unsaved';
    if (!library.autosave) return;
    clearTimeout(timer);
    timer = setTimeout(saveNow, AUTOSAVE_MS);
  });
}
