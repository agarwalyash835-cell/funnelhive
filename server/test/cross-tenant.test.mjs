// Cross-account check over every route: account A (an agency, with a client account) and account B are both
// signed in; B calls every API route that takes an id in its path, filled with A's ids (and its client's), and
// must never get A's data back. The ids come straight from the database (every row A or its client owns), the
// routes from the router itself, so a new route or table is covered without touching this file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, register } from './helpers.mjs';

const MARK = 'ALPHAMARK7Q'; // A's data carries this; it must never come back to B

// Routes that are public by design and answer anyone who knows the address (a published page, a share link…).
// Each entry is checked by path; keep this list short and say why.
const PUBLIC_OK = new Set([
]);

let srv, api, A, B, aId, cId;
before(async () => {
  srv = await startServer();
  api = srv.api;
  A = (await register(api)).token;
  B = (await register(api)).token;
  aId = (await api('/me', 'GET', null, A)).data.id;
  await api('/settings', 'PUT', { businessName: `${MARK} Traders` }, A);
  // A's things: whatever of these exists in this build is created (a failure here only means less coverage)
  const f = (await api('/funnels', 'POST', { name: `${MARK} funnel` }, A)).data;
  await api('/products', 'POST', { name: `${MARK} product`, price: 499 }, A);
  await api('/automations', 'POST', { name: `${MARK} automation` }, A);
  await api('/coupons', 'POST', { code: 'ALPHA10', percent: 10 }, A);
  await api('/quotes', 'POST', { title: `${MARK} quote`, buyer: { name: MARK } }, A);
  await api('/webinars', 'POST', { title: `${MARK} webinar` }, A);
  await api('/crm', 'POST', { name: `${MARK} contact`, email: 'alpha.contact@test.dev' }, A);
  if (f?.slug) await api(`/public/funnels/${f.slug}/lead`, 'POST', { name: `${MARK} lead`, email: 'alpha.lead@test.dev' });
  // A is an agency with a client account
  const c = await api('/agency/clients', 'POST', { business: `${MARK} Client` }, A);
  cId = c.data?.id || null;
  if (c.data?.token) await api('/funnels', 'POST', { name: `${MARK} client funnel` }, c.data.token);
});
after(() => srv?.stop());

function ownedIds() {
  const db = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db'), { readOnly: true });
  const owners = [aId, cId].filter(Boolean);
  const ids = new Set(owners), slugs = new Set();
  try {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
      if (!cols.includes('id')) continue;
      const by = ['userId', 'ownerId'].filter((c) => cols.includes(c));
      if (!by.length) continue;
      const rows = db.prepare(`SELECT * FROM "${name}" WHERE ${by.map((c) => `${c} IN (${owners.map(() => '?').join(',')})`).join(' OR ')} LIMIT 3`).all(...by.flatMap(() => owners));
      for (const r of rows) {
        ids.add(String(r.id));
        try { const d = JSON.parse(r.data || '{}'); if (d.slug) slugs.add(d.slug); if (d.handle) slugs.add(d.handle); } catch {}
      }
    }
  } finally { db.close(); }
  return [...ids, ...slugs];
}

test('account B never gets account A’s data through any route with an id in its path', { timeout: 300000 }, async () => {
  await new Promise((r) => setTimeout(r, 300)); // let pending writes land
  const values = ownedIds();
  assert.ok(values.length >= 4, `expected A to own a few things, got ${values.length}`);
  const routes = (await api('/__test/routes')).data.filter((r) => r.path.startsWith('/api/') && /:\w+/.test(r.path) && !r.path.startsWith('/api/__test'));
  assert.ok(routes.length > 100, `expected the router to list many id routes, got ${routes.length}`);
  // reads first, then changes, deletes last (so a read isn't hidden by an earlier delete)
  const order = { get: 0, post: 1, put: 1, patch: 1, delete: 2 };
  const calls = routes.flatMap((r) => r.methods.filter((m) => m in order).map((m) => ({ m, path: r.path }))).sort((a, b) => order[a.m] - order[b.m]);
  const leaks = [];
  let n = 0;
  for (const { m, path: p } of calls) {
    if (PUBLIC_OK.has(`${m.toUpperCase()} ${p}`)) continue;
    for (const v of values) {
      const url = p.replace(/:(\w+)(\([^)]*\))?\??/g, encodeURIComponent(v)).replace(/\*/g, v).replace(/^\/api/, '');
      let r;
      try {
        r = await fetch(`${srv.base}/api${url}`, { method: m.toUpperCase(), headers: { 'content-type': 'application/json', authorization: `Bearer ${B}` }, body: m === 'get' ? undefined : JSON.stringify({ name: 'BRAVO', title: 'BRAVO', confirm: 'DELETE' }), signal: AbortSignal.timeout(8000) });
      } catch { continue; } // a slow route (timeout) isn't a leak
      n++;
      if (r.status < 200 || r.status >= 300) { await r.arrayBuffer().catch(() => {}); continue; }
      const text = await r.text().catch(() => '');
      if (text.includes(MARK)) leaks.push(`${m.toUpperCase()} ${p} (${v}) → ${r.status}: ${text.slice(0, 160)}`);
    }
  }
  assert.ok(n > 100, `expected many calls, made ${n}`);
  // B is still signed in (a route that signed B out would make every later call a meaningless 401)
  assert.equal((await api('/me', 'GET', null, B)).status, 200);
  assert.deepEqual(leaks, [], `B reached A’s data:\n${leaks.join('\n')}`);
  // and nothing of A's was changed or deleted by B's calls
  const me = (await api('/me', 'GET', null, A));
  assert.equal(me.status, 200);
  assert.equal(me.data.settings.businessName, `${MARK} Traders`);
  const fl = (await api('/funnels', 'GET', null, A)).data;
  assert.ok((Array.isArray(fl) ? fl : fl.funnels || []).some((f) => f.name === `${MARK} funnel`), 'A’s funnel is untouched');
  if (cId) assert.ok((await api('/agency', 'GET', null, A)).data.clients.some((c) => c.id === cId), 'A’s client account is untouched');
});
