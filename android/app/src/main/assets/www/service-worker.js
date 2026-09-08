// service-worker.js — cachea toda la app para que funcione sin conexión
// una vez instalada. Estrategia: cache-first con actualización en segundo
// plano (stale-while-revalidate) para los archivos propios de la app.

const CACHE_VERSION = 'pilo-presupuestos-v2';

const PRECACHE_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/app.js',
  './js/catalog.js',
  './js/catalog-match.js',
  './js/db.js',
  './js/pdf-export.js',
  './js/pdf-fonts.js',
  './js/calculos.js',
  './js/plano-canvas.js',
  './js/plano-pdf.js',
  './data/aaieric-precios.json',
  './data/estado-aaieric.json',
  './vendor/jspdf.umd.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/fonts/jetbrains-mono-latin-400-normal.woff2',
  './vendor/fonts/jetbrains-mono-latin-600-normal.woff2',
  './vendor/fonts/space-grotesk-latin-500-normal.woff2',
  './vendor/fonts/space-grotesk-latin-600-normal.woff2',
  './vendor/fonts/space-grotesk-latin-700-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);

      // Navegación (recargar la app): si no hay red, servir el index cacheado.
      if (req.mode === 'navigate') {
        return network.catch(() => caches.match('./index.html'));
      }

      return cached || network;
    })
  );
});
