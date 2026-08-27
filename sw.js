const CACHE_NAME = 'birds-hub-v182';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo.png',
  './tailwind.min.css',
  './css/app.css',
  './fonts/fonts.css',
  './html2canvas.min.js',
  './papaparse.min.js',
  './jspdf.umd.min.js',
  './jspdf.plugin.autotable.min.js',
  './xlsx.full.min.js',
  './jszip.min.js',
  './chart.js',
  './AuditQuestions.json',
  './tracker_defaults.json',
  './users.json',
  './js/db.js',
  './js/auth.js',
  './js/graph.js',
  './js/utils.js',
  './js/data.js',
  './js/charts.js',
  './js/scorecards.js',
  './js/reports.js',
  './js/complaints.js',
  './js/documents.js',
  './js/users.js',
  './js/projects.js',
  './js/template-builder.js',
  './js/audits.js',
  './js/tracker_defaults.js',
  './js/tracker.js',
  './js/awards.js',
  './js/audit-perform.js',
  './js/overview.js',
  './js/shop.js',
  './js/activity.js',
  './js/app.js',
  './fonts/inter-v20-latin-regular.woff2',
  './fonts/inter-v20-latin-600.woff2',
  './fonts/inter-v20-latin-700.woff2',
  './fonts/inter-v20-latin-800.woff2',
  './fonts/outfit-v15-latin-regular.woff2',
  './fonts/outfit-v15-latin-700.woff2',
  './fonts/outfit-v15-latin-800.woff2',
  './fonts/merriweather-v33-latin-regular.woff2',
  './fonts/merriweather-v33-latin-700.woff2',
  './fonts/merriweather-v33-latin-900.woff2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache failed for some assets:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (event.request.url.startsWith(self.location.origin) &&
            event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
