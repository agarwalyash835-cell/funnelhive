// Load test: simulates shoppers and sellers hitting a running server at the same time.
//   node server/scripts/loadtest.mjs http://localhost:4000 [seconds=20] [concurrency=50]
// Needs a database made by server/scripts/seed-load.mjs and the same JWT_SECRET as the server (default "loadtest").
// Each request carries a random X-Forwarded-For so per-visitor rate limits behave as with real traffic.
import jwt from 'jsonwebtoken';

const base = process.argv[2] || 'http://localhost:4000';
const SECONDS = Number(process.argv[3] || 20), CONC = Number(process.argv[4] || 50);
const USERS = Number(process.env.USERS || 1000), FUNNELS = 10;
const SECRET = process.env.JWT_SECRET || 'loadtest';
const rnd = (n) => Math.floor(Math.random() * n);
const ip = () => `${1 + rnd(220)}.${rnd(255)}.${rnd(255)}.${1 + rnd(250)}`;
const token = (u) => jwt.sign({ id: `u${u}`, pv: 0 }, SECRET, { expiresIn: '1h' });
const steps = {}; // slug → landing step id, fetched once

// What a busy minute looks like: mostly shoppers on live pages, some sellers in the dashboard
const SCENARIOS = [
  { name: 'shopper: open a live page (server-rendered)', weight: 30, run: async () => { const slug = `s${rnd(USERS)}-${rnd(FUNNELS)}`; return fetch(`${base}/f/${slug}`, { headers: { 'x-forwarded-for': ip() } }); } },
  { name: 'shopper: page-view event', weight: 40, run: async () => {
    const slug = `s${rnd(USERS)}-${rnd(FUNNELS)}`;
    steps[slug] ||= (await (await fetch(`${base}/api/public/${slug}`)).json()).steps?.[0]?.id;
    return fetch(`${base}/api/public/${slug}/event`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ stepId: steps[slug], type: 'view', source: 'instagram', visitor: `lt${rnd(1e9)}` }) });
  } },
  { name: 'shopper: opt-in (lead)', weight: 5, run: async () => {
    const slug = `s${rnd(USERS)}-${rnd(FUNNELS)}`;
    steps[slug] ||= (await (await fetch(`${base}/api/public/${slug}`)).json()).steps?.[0]?.id;
    return fetch(`${base}/api/public/${slug}/lead`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ stepId: steps[slug], email: `lt${rnd(1e9)}@mail.test`, name: 'Load Test' }) });
  } },
  { name: 'seller: funnels list', weight: 8, run: () => fetch(`${base}/api/funnels`, { headers: { authorization: `Bearer ${token(rnd(USERS))}`, 'x-forwarded-for': ip() } }) },
  { name: 'seller: analytics (30 days)', weight: 7, run: () => fetch(`${base}/api/analytics/overview?days=30`, { headers: { authorization: `Bearer ${token(rnd(USERS))}`, 'x-forwarded-for': ip() } }) },
  { name: 'seller: contacts', weight: 5, run: () => fetch(`${base}/api/contacts`, { headers: { authorization: `Bearer ${token(rnd(USERS))}`, 'x-forwarded-for': ip() } }) },
  { name: 'seller: open a funnel in the editor', weight: 5, run: async () => {
    const u = rnd(USERS), t = token(u);
    const list = await (await fetch(`${base}/api/funnels`, { headers: { authorization: `Bearer ${t}`, 'x-forwarded-for': ip() } })).json();
    return fetch(`${base}/api/funnels/${list[rnd(list.length)].id}`, { headers: { authorization: `Bearer ${t}`, 'x-forwarded-for': ip() } });
  } },
];
const total = SCENARIOS.reduce((a, s) => a + s.weight, 0);
const pick = () => { let x = Math.random() * total; for (const s of SCENARIOS) if ((x -= s.weight) < 0) return s; return SCENARIOS[0]; };

const stats = new Map(SCENARIOS.map((s) => [s.name, { lat: [], errors: 0, codes: {} }]));
const end = Date.now() + SECONDS * 1000;
async function worker() {
  while (Date.now() < end) {
    const s = pick(), st = stats.get(s.name), t0 = performance.now();
    try {
      const r = await s.run();
      await r.arrayBuffer();
      st.codes[r.status] = (st.codes[r.status] || 0) + 1;
      if (r.status >= 500 || r.status === 429) st.errors++;
    } catch (e) { st.errors++; st.codes[e.cause?.code || e.message] = (st.codes[e.cause?.code || e.message] || 0) + 1; }
    st.lat.push(performance.now() - t0);
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, worker));
const secs = (Date.now() - t0) / 1000;
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] : 0);
let n = 0, errs = 0;
console.log(`\n${CONC} concurrent clients for ${secs.toFixed(0)}s against ${base}\n`);
console.log('scenario'.padEnd(46), 'reqs'.padStart(7), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'p99 ms'.padStart(8), ' errors');
for (const [name, st] of stats) {
  st.lat.sort((a, b) => a - b);
  n += st.lat.length; errs += st.errors;
  console.log(name.padEnd(46), String(st.lat.length).padStart(7), pct(st.lat, 50).toFixed(0).padStart(8), pct(st.lat, 95).toFixed(0).padStart(8), pct(st.lat, 99).toFixed(0).padStart(8), ` ${st.errors}${st.errors ? ' ' + JSON.stringify(st.codes) : ''}`);
}
console.log(`\ntotal ${n} requests, ${(n / secs).toFixed(0)} req/s, ${errs} errors`);
