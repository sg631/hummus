// The service worker: what lets the app open and play with no internet.
//
// - The app itself (its code, styles, the page) is saved when it's installed, in a cache
//   named after this version; an update replaces it.
// - Instrument and drum samples and the logo's font come from other sites (tonejs-
//   instruments, the FluidR3 soundfont, jsDelivr, Google Fonts). Each is saved the first
//   time it's fetched, in a cache that survives app updates, and served from there after:
//   anything you've played once works offline. "Make available offline" (state/offline)
//   fetches all of them up front.
//
// SvelteKit registers this file itself (https://svelte.dev/docs/kit/service-workers).
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP = `hum-app-${version}`;
const SAMPLES = 'hum-samples'; // kept across versions (state/offline.svelte.ts uses the same name)
const APP_FILES = [...build, ...files];

// Sites whose files are samples (or the font): cache-first, kept.
const SAMPLE_HOSTS = ['nbrosowsky.github.io', 'gleitz.github.io', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP);
      await cache.addAll(APP_FILES);
      // The page itself (every address serves it: the app finds its route in the browser).
      await cache.add(`${base}/`).catch(() => {});
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('hum-app-') && key !== APP) await caches.delete(key);
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Samples and fonts: from the cache if saved, otherwise fetched and saved.
  if (SAMPLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SAMPLES);
        const hit = await cache.match(request, { ignoreVary: true });
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
        return response;
      })()
    );
    return;
  }

  if (url.origin !== sw.location.origin) return;

  // Pages: the network when online (so updates arrive), the saved page when not.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) (await caches.open(APP)).put(`${base}/`, response.clone());
          return response;
        } catch {
          return (await caches.match(`${base}/`)) ?? Response.error();
        }
      })()
    );
    return;
  }

  // The app's own files: saved ones first (they never change within a version).
  if (APP_FILES.includes(url.pathname)) {
    event.respondWith((async () => (await caches.match(url.pathname)) ?? fetch(request))());
  }
});
