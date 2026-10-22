// The members-area app (installed to the home screen): keeps the app's own files so it opens fast, and shows a
// friendly page when there's no internet. Never stores lessons, videos or anything from /api.
const CACHE = 'ff-learn-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  // the app's own files have content hashes in their names: safe to keep
  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(r)) || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; })));
    return;
  }
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f6f6fa;color:#14152a;text-align:center;padding:24px"><div><div style="font-size:42px">📶</div><h1 style="font-size:22px;margin:8px 0">You’re offline</h1><p style="color:#6b7088;margin:0 0 16px">Connect to the internet to keep learning.</p><button onclick="location.reload()" style="font:600 15px system-ui;border:0;border-radius:12px;padding:11px 18px;background:#6366f1;color:#fff">Try again</button></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));
  }
});
