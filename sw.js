const CACHE_NAME = 'birds-hub-v91';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './tailwind.min.css',
  './css/app.css',
  './html2canvas.min.js',
  './papaparse.min.js',
  './jspdf.umd.min.js',
  './jspdf.plugin.autotable.min.js',
  './xlsx.full.min.js',
  './jszip.min.js',
  './chart.js',
  './fonts/fonts.css',
  './fonts/inter-v20-latin-regular.woff2',
  './fonts/inter-v20-latin-600.woff2',
  './fonts/inter-v20-latin-700.woff2',
  './fonts/inter-v20-latin-800.woff2',
  './fonts/outfit-v15-latin-regular.woff2',
  './fonts/outfit-v15-latin-700.woff2',
  './fonts/outfit-v15-latin-800.woff2',
  './AuditQuestions.json',
  './tracker_defaults.json',
  './EHO_Ratings.csv',
  './js/db.js',
  './js/utils.js',
  './js/sharepoint.js',
  './js/graph.js',
  './js/data.js',
  './js/charts.js',
  './js/scorecards.js',
  './js/reports.js',
  './js/complaints.js',
  './js/documents.js',
  './js/audits.js',
  './js/tracker.js',
  './js/awards.js',
  './js/audit-perform.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('SW: Failed to cache', asset, err);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const cleanPath = url.pathname.replace(/\/+$/, '') || './';

  // Strip query params for cache lookup (handles ?v=84 cache-busting)
  const cleanRequest = new Request(cleanPath, {
    method: event.request.method,
    headers: event.request.headers
  });

  event.respondWith(
    caches.match(cleanRequest).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(cleanRequest, clone);
          });
        }
        return response;
      }).catch(() => {
        // Navigation fallback: serve index.html for any route
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
