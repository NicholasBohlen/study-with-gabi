// Offline support. Network first (always asking the server, never the browser's
// HTTP cache, so files from two versions never mix), the saved copy when there's
// no signal or the network takes too long.
const CACHE = 'study-with-gabi-v5';
const SHELL = [
  './', './index.html', './app.js', './features.js', './styles.css', './manifest.webmanifest',
  './content.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    // A page load's own request can't take options, so ask for its URL fresh.
    const net = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(res => {
      if (res.ok) { cache.put(req, res.clone()); return res; }
      return cached || res;   // a server error never replaces a good saved copy
    });
    if (!cached) return net;
    // Slow or no signal: use the saved copy after 4 seconds (the download still finishes and is saved).
    const slow = new Promise(r => setTimeout(() => r(cached), 4000));
    return Promise.race([net.catch(() => cached), slow]);
  })());
});

// The app sends the pictures in the classes she's studying, so they work offline too.
self.addEventListener('message', e => {
  if (e.data?.type !== 'precache') return;
  e.waitUntil(caches.open(CACHE).then(async cache => {
    for (const url of e.data.urls) {
      if (await cache.match(url)) continue;
      try { const res = await fetch(url, { cache: 'no-cache' }); if (res.ok) await cache.put(url, res); } catch (err) { /* offline: next time */ }
    }
  }));
});
