/* Service Worker – תמלול פלוס */
const VERSION = 'tplus-v2.1.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const SHARE_CACHE = 'tplus-share';
const LIB_CACHE = 'tplus-libs';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tplus-') && k !== VERSION && k !== SHARE_CACHE && k !== LIB_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('audio').filter((f) => f && typeof f === 'object' && f.size);
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const f of files) {
      const key = './__shared/' + Date.now() + '-' + (i++);
      await cache.put(key, new Response(f, {
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'recording') }
      }));
    }
  } catch (err) { /* ignore – the app will just open */ }
  return Response.redirect('./?share=1', 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  // CDN libraries used for export – cache after first use
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // Network first for the page itself (so updates appear), cache fallback offline
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(VERSION);
        cache.put('./index.html', res.clone());
        return res;
      } catch (err) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Everything else: cache first, then network
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
