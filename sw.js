// Offline cache for the app shell. It only ever caches this site's own
// static files; user files never pass through here (they're never fetched).
const VERSION = 'dokujaga-v1';
const ASSETS = [
  './',
  'index.html',
  'palang/',
  'palang/index.html',
  'gambar-pdf/',
  'gambar-pdf/index.html',
  'css/style.css',
  'js/home.js',
  'js/page.js',
  'js/pwa.js',
  'js/palang.js',
  'js/img2pdf.js',
  'js/watermark.js',
  'js/image-loader.js',
  'js/pdf.js',
  'js/i18n.js',
  'js/storage.js',
  'js/theme.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for same-origin GETs so updates land quickly, falling back
// to the cache when offline. Anything else is left alone.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
