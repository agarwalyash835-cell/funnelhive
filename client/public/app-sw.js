// The seller app, installed to the home screen or opened from the Play Store app (scope /): keeps the app's own files
// (hashed names under /assets/) so it opens fast, and shows a friendly page when there's no internet. Pages are always
// fetched fresh, so a new deploy shows at once. Never stores anything from /api. /counter and /learn/ have their own
// workers (a narrower scope wins there).
const CACHE = 'ff-app-v1';
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="margin:0;min-height:100vh;background:linear-gradient(160deg,#2b2b2b,#1e1e1c);color:#ede8e0;font:16px/1.6 system-ui,sans-serif;display:flex;align-items:flex-end;padding:32px 24px 64px;box-sizing:border-box"><div><h1 style="font-size:30px;line-height:1.1;margin:0 0 8px;font-weight:800">You’re offline</h1><p style="margin:0 0 20px;color:#d8cbb5">Your chats, leads and orders will be here as soon as you’re back online.</p><button onclick="location.reload()" style="font:700 16px system-ui;border:0;border-radius:12px;padding:12px 20px;background:#c9a13b;color:#1e1e1c">Try again</button></div>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('ff-app-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/assets/')) {
    // each deploy brings new hashed files: the oldest are dropped past 150, so the cache doesn't grow forever
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(r)) || fetch(r).then((res) => {
      if (res.ok) e.waitUntil(c.put(r, res.clone()).then(() => c.keys()).then((ks) => Promise.all(ks.slice(0, Math.max(0, ks.length - 150)).map((k) => c.delete(k)))).catch(() => {}));
      return res;
    })));
    return;
  }
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
  }
});
