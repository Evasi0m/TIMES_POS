/// <reference lib="webworker" />
// TIMES POS service worker — keeps the front counter running when WiFi
// flickers. Strategy:
//
//   App shell (index.html, JS, CSS) → cache-first (instant boot offline)
//   Icons + manifest                 → cache-first
//   Supabase reads (GET)             → network-first, fall back to cache
//   Supabase writes (POST/PATCH/...) → network only (queued in IDB by app)
//   Google Fonts                     → cache-first (rarely change)
//
// Builds via vite-plugin-pwa with the `injectManifest` strategy. Workbox
// injects `self.__WB_MANIFEST` at build time with the hashed precache list.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, setDefaultHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Bump when the SW logic itself changes (not just the precache manifest —
// Workbox already revisions that). Use this to correlate client behavior
// with a specific SW build: cashier reads the version from console and we
// know exactly which code is running on their device.
const SW_VERSION = '2025-05-13-hardened';

self.addEventListener('install', () => {
  // eslint-disable-next-line no-console
  console.info('[sw] install v' + SW_VERSION);
});
self.skipWaiting();
self.addEventListener('activate', (e) => {
  // eslint-disable-next-line no-console
  console.info('[sw] activate v' + SW_VERSION);
  e.waitUntil(self.clients.claim());
});

// Expose version to clients so the self-heal hook in main.jsx can compare
// against what it expected and force-unregister a stale SW that's been
// running for too long without an update reaching the device.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'GET_VERSION' && e.ports?.[0]) {
    e.ports[0].postMessage({ version: SW_VERSION });
  }
});

cleanupOutdatedCaches();

// === 1. App shell precache (HTML + JS + CSS bundled by Vite) ============
// Workbox injects the real, hashed asset list here at build time. Do NOT
// add extra hardcoded entries like { url: '/' } — those assume the app is
// served at the origin root and 404 on any subpath deploy (GitHub Pages
// project sites, Netlify previews, etc.), which aborts SW install with
// `bad-precaching-response` and silently breaks the whole offline layer.
precacheAndRoute(self.__WB_MANIFEST || []);

// === 2. Icons / manifest — cache-first, change rarely =================
registerRoute(
  ({ request }) =>
    request.destination === 'image' ||
    request.destination === 'manifest',
  new CacheFirst({
    cacheName: 'static-assets-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// === 3. Google Fonts — Workbox's standard recipe =========================
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({ cacheName: 'google-fonts-stylesheets-v1' })
);
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
    ],
  })
);

// === 4. Supabase reads — network-first, cache fallback ==================
//   GET /rest/v1/products?...  → return cache if network fails (POS can
//   still search the products it saw last time it was online).
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    /\.supabase\.co\/rest\/v1\//.test(url.href),
  new NetworkFirst({
    cacheName: 'supabase-reads-v1',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 }),
    ],
  })
);

// === 5. Supabase writes — never cache, never queue here =================
//   The app handles the offline-write queue in IndexedDB explicitly so
//   it can attach a "queued at" timestamp and surface "บันทึกในคิว" toast.
registerRoute(
  ({ url, request }) =>
    request.method !== 'GET' &&
    /\.supabase\.co\//.test(url.href),
  new NetworkOnly()
);

// Anything else: try the network, no caching.
setDefaultHandler(new NetworkOnly());
