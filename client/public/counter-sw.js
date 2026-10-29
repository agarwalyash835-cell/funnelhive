// Counter mode, installed on a phone (scope /counter): opens with no network. The page itself is fetched fresh when
// online (a new deploy shows at once) and a copy is kept for offline; the app's own files (hashed names under
// /assets/) are kept once fetched — including the ones the page loaded before this worker took over, which the page
// sends in a message. Never stores anything from /api: the catalog and queued bills live in the page's IndexedDB.
const CACHE = 'ff-counter-v1';
const SHELL = ['/counter', '/counter.webmanifest', '/counter-icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('ff-counter-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('message', (e) => {
  const urls = (e.data?.cache || []).filter((u) => { try { const x = new URL(u, self.location.origin); return x.origin === self.location.origin && x.pathname.startsWith('/assets/'); } catch { return false; } });
  if (urls.length) e.waitUntil(caches.open(CACHE).then(async (c) => { for (const u of urls) if (!(await c.match(u))) await c.add(u).catch(() => {}); }));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/assets/') || (SHELL.includes(u.pathname) && r.mode !== 'navigate')) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(r)) || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; })));
    return;
  }
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/counter', copy)); } return res; })
      .catch(async () => (await caches.match('/counter')) || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;padding:24px"><div><h1 style="font-size:22px">You’re offline</h1><p>Open counter mode once while online so it works without the internet.</p><button onclick="location.reload()">Try again</button></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));
  }
});
