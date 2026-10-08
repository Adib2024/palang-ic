// Offline cache for the app shell. It only ever caches this site's own
// static files; user files never pass through here (they're never fetched).
const VERSION = 'dokujaga-v6';
const ASSETS = [
  'isi-borang/',
  'isi-borang/index.html',
  'hitamkan-pdf/',
  'hitamkan-pdf/index.html',
  'edit-pdf/',
  'edit-pdf/index.html',
  './',
  'index.html',
  'palang/',
  'palang/index.html',
  'gambar-pdf/',
  'gambar-pdf/index.html',
  'susun-pdf/',
  'susun-pdf/index.html',
  'kecilkan-pdf/',
  'kecilkan-pdf/index.html',
  'pdf-gambar/',
  'pdf-gambar/index.html',
  'kecil-gambar/',
  'kecil-gambar/index.html',
  'tandatangan-pdf/',
  'tandatangan-pdf/index.html',
  'imbas/',
  'imbas/index.html',
  'gabung-pdf/',
  'gabung-pdf/index.html',
  'pisah-pdf/',
  'pisah-pdf/index.html',
  'putar-pdf/',
  'putar-pdf/index.html',
  'watermark-pdf/',
  'watermark-pdf/index.html',
  'nombor-pdf/',
  'nombor-pdf/index.html',
  'potong-pdf/',
  'potong-pdf/index.html',
  'css/style.css',
  'js/home.js',
  'js/page.js',
  'js/pwa.js',
  'js/palang.js',
  'js/img2pdf.js',
  'js/organize.js',
  'js/compress.js',
  'js/pdf-kit.js',
  'js/zip.js',
  'js/pdf2img.js',
  'js/imgsmall.js',
  'js/sign.js',
  'js/scan.js',
  'js/scan-core.js',
  'js/pdf-pages.js',
  'js/merge.js',
  'js/split.js',
  'js/rotate.js',
  'js/watermark-pdf.js',
  'js/pagenum.js',
  'js/crop.js',
  'js/watermark.js',
  'js/image-loader.js',
  'js/pdf.js',
  'js/i18n.js',
  'js/forms.js',
  'js/redact.js',
  'js/edit.js',
  'js/page-viewer.js',
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

// The PDF libraries under vendor/ are big, so they're cached the first time a
// PDF tool is used rather than up front.
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
