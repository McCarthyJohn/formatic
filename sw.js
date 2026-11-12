/* Formatic service worker — cache the shell and the form assets for offline use. */
var CACHE_VERSION = 'formatic-v4';
var CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './mapper.js',
  './draft.js',
  './storage.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './manifest.webmanifest',
  './lib/pdf-lib.min.js',
  './forms/sale-onboarding/map.json',
  './forms/sale-onboarding/source.pdf'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then(function (c) { return c.addAll(CORE); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // page images and the source PDF are large: cache-first, then network
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        if (url.pathname.endsWith('.html') || url.pathname.endsWith('/')) return caches.match('./index.html');
      });
    })
  );
});
