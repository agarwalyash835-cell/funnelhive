// One request at a time per endpoint, to see what each costs on a big database (no queueing).
//   JWT_SECRET=loadtest node server/scripts/profile-endpoints.mjs http://localhost:4000
import jwt from 'jsonwebtoken';
const base = process.argv[2] || 'http://localhost:4000';
const SECRET = process.env.JWT_SECRET || 'loadtest';
const USERS = Number(process.env.USERS || 1000);
const rnd = (n) => Math.floor(Math.random() * n);
const tok = () => jwt.sign({ id: `u${rnd(USERS)}`, pv: 0 }, SECRET);
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function time(name, fn, n = 40) {
  const lat = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); const r = await fn(); await r.arrayBuffer(); lat.push(performance.now() - t0); }
  lat.sort((a, b) => a - b);
  console.log(name.padEnd(40), `p50 ${lat[n >> 1].toFixed(1)} ms`.padEnd(16), `max ${lat.at(-1).toFixed(1)} ms`);
}
const slug = () => `s${rnd(USERS)}-${rnd(10)}`;
await time('GET /f/:slug (first render or cached)', () => fetch(`${base}/f/${slug()}`));
await time('GET /api/public/:slug', () => fetch(`${base}/api/public/${slug()}`));
const s = slug(); const st = (await (await fetch(`${base}/api/public/${s}`)).json()).steps[0].id;
await time('POST event', () => fetch(`${base}/api/public/${s}/event`, { method: 'POST', headers: H(''), body: JSON.stringify({ stepId: st, type: 'view', visitor: `x${rnd(1e9)}` }) }));
await time('POST lead', () => fetch(`${base}/api/public/${s}/lead`, { method: 'POST', headers: H(''), body: JSON.stringify({ stepId: st, email: `p${rnd(1e9)}@x.test` }) }));
await time('GET /api/me', () => fetch(`${base}/api/me`, { headers: H(tok()) }));
await time('GET /api/funnels', () => fetch(`${base}/api/funnels`, { headers: H(tok()) }));
await time('GET /api/analytics/overview', () => fetch(`${base}/api/analytics/overview?days=30`, { headers: H(tok()) }));
await time('GET /api/contacts', () => fetch(`${base}/api/contacts`, { headers: H(tok()) }));
await time('GET /api/orders', () => fetch(`${base}/api/orders`, { headers: H(tok()) }));
await time('GET /api/automations', () => fetch(`${base}/api/automations`, { headers: H(tok()) }));
