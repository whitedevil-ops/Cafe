// Minimal service worker — exists only so Chrome's automatic install
// promotion (the proactive "install app" prompt) is offered; a manifest
// alone is enough for a user to install manually via Chrome's menu, but the
// automatic banner specifically requires a fetch-handling service worker.
// No caching strategy — this is not an offline-support feature, just the
// smallest thing that satisfies that one installability criterion.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
