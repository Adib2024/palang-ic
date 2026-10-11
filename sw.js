// Offline cache for the app shell. It only ever caches this site's own
// static files; user files never pass through here (they're never fetched).
const VERSION = 'dokujaga-v13';
// Third-party libraries, the OCR engine and fonts (vendor/) change rarely and
// are big, so they live in their own cache that survives app updates.
const VENDOR_CACHE = 'dokujaga-vendor-1';
const ASSETS = [
  'ocr-pdf/',
  'ocr-pdf/index.html',
  'banding-pdf/',
  'banding-pdf/index.html',
  'lindungi-pdf/',
  'lindungi-pdf/index.html',
  'aliran-kerja/',
  'aliran-kerja/index.html',
  'buka-kunci-pdf/',
  'buka-kunci-pdf/index.html',
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
  'js/sig-maker.js',
  'js/placer.js',
  'js/workflow-ops.js',
  'js/workflow.js',
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
  'js/pdf-stamps.js',
  'js/fonts.js',
  'js/ocr.js',
  'js/compare.js',
  'js/diff.js',
  'js/protect.js',
  'js/unlock.js',
  'js/pdf-security.js',
  'js/pdf-crypto.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VENDOR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** vendor/: serve from cache at once (works offline), refresh in the background. */
function staleWhileRevalidate(event) {
  const { request } = event;
  return caches.open(VENDOR_CACHE).then((cache) => cache.match(request).then((hit) => {
    const update = fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    });
    if (hit) {
      event.waitUntil(update.catch(() => {}));
      return hit;
    }
    return update;
  }));
}

// The libraries under vendor/ are big, so they're cached the first time a tool
// uses them rather than up front. Pages and app code are network-first so
// updates land quickly, falling back to the cache when offline. Requests from
// workers (pdf.js, OCR) come through here too. Anything else is left alone.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
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
