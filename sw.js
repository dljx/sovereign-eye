const CACHE = 'sovereign-mobile-v2';
const SHELL = ['/mobile.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;
  if (url.pathname.startsWith('/api/')) return;

  // HTML shell: network-first. Cache-first served a one-deploy-stale shell
  // after every deploy — and since JS filenames are content-hashed, a stale
  // shell whose hashed assets were evicted 404'd against the new deploy.
  const isNav = request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
  if (isNav) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.open(CACHE).then(c => c.match(request))
            .then(hit => hit || new Response('Offline', { status: 503 }))
        )
    );
    return;
  }

  // Hashed/static assets: cache-first (immutable by construction), refreshed
  // in the background.
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
        .catch(() => null);
      return cached || await networkFetch || new Response('Offline', { status: 503 });
    })
  );
});
