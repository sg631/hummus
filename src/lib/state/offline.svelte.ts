// Working offline: the app is saved by the service worker (src/service-worker.ts), and so
// is every sample the first time it's used. This saves all of them up front, so every
// instrument and drum sound works with no internet, and tells you what's saved.
//
//   await checkOffline()          // how many samples are saved, storage used
//   await makeAvailableOffline()  // download every sample (progress in `offline`)
//   await clearOfflineSamples()
//
// Your projects, recordings and your own sounds are in this browser's database (or your
// projects folder) already: they never needed the internet.
import { DRUM_SAMPLES } from '$lib/music/drum-samples';
import { SAMPLE_SETS, sampleUrls } from '$lib/music/samples';

const SAMPLES = 'hum-samples'; // the service worker's sample cache (the same name)
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Smooch+Sans:wght@800&display=swap';

export const offline = $state({
  supported: typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  saved: 0, // samples saved
  total: 0, // samples there are
  downloading: false,
  done: 0, // this download: files fetched so far
  failed: 0,
  usedMB: 0, // this site's storage
  quotaMB: 0,
  persisted: false // the browser promised not to clear it when space runs low
});

// Every sample URL the app can use.
export function allSampleUrls(): string[] {
  const urls = new Set<string>();
  for (const set of SAMPLE_SETS) for (const u of Object.values(sampleUrls(set.id))) urls.add(u);
  for (const d of DRUM_SAMPLES) urls.add(d.url);
  return [...urls];
}

async function storage() {
  try {
    const est = await navigator.storage.estimate();
    offline.usedMB = Math.round((est.usage ?? 0) / 1e6);
    offline.quotaMB = Math.round((est.quota ?? 0) / 1e6);
    offline.persisted = (await navigator.storage.persisted?.()) ?? false;
  } catch {
    // not available: leave the numbers at 0
  }
}

export async function checkOffline() {
  if (!offline.supported) return;
  const urls = allSampleUrls();
  const cache = await caches.open(SAMPLES);
  const saved = new Set((await cache.keys()).map((r) => r.url));
  offline.total = urls.length;
  offline.saved = urls.filter((u) => saved.has(u)).length;
  await storage();
}

// Saves every sample not saved yet (six at a time), the logo font too. Asks the browser to
// keep the storage (persist) so it isn't cleared when the disk runs low.
export async function makeAvailableOffline() {
  if (!offline.supported || offline.downloading) return;
  offline.downloading = true;
  offline.done = 0;
  offline.failed = 0;
  try {
    await navigator.storage.persist?.().catch(() => false);
    const cache = await caches.open(SAMPLES);
    const saved = new Set((await cache.keys()).map((r) => r.url));
    const todo = allSampleUrls().filter((u) => !saved.has(u));
    // The font's stylesheet, and the font files it points at.
    try {
      const css = await fetch(FONT_CSS);
      if (css.ok) {
        await cache.put(FONT_CSS, css.clone());
        for (const m of (await css.text()).matchAll(/url\((https:[^)]+)\)/g)) todo.push(m[1]);
      }
    } catch {
      // offline already: the font may be saved from before
    }
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const url = todo[next++];
        try {
          const response = await fetch(url, { mode: 'cors' });
          if (!response.ok) throw new Error(String(response.status));
          await cache.put(url, response);
        } catch {
          offline.failed++;
        }
        offline.done++;
        if (offline.done % 10 === 0) offline.saved = Math.min(offline.total, offline.saved + 10);
      }
    };
    offline.total = allSampleUrls().length;
    await Promise.all(Array.from({ length: 6 }, worker));
  } finally {
    offline.downloading = false;
    await checkOffline();
  }
}

export async function clearOfflineSamples() {
  if (!offline.supported) return;
  await caches.delete(SAMPLES);
  await checkOffline();
}

// Keeps `offline.online` up to date.
export function watchOnline() {
  const update = () => (offline.online = navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  void checkOffline();
}
