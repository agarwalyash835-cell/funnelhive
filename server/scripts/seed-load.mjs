// Fills a data directory with a realistic big platform for load testing:
// 1000 sellers × 10 published funnels, 2M page views, 200k sign-ups, 50k orders, CRM records, automations.
//   DATA_DIR=/tmp/ff-load node server/scripts/seed-load.mjs
//   USERS=1000 EVENTS_PER_FUNNEL=200 (optional)
// Then start the server on that DATA_DIR with JWT_SECRET=loadtest and run server/scripts/loadtest.mjs.
import bcrypt from 'bcryptjs';
import { T, Events, tx, uid } from '../db.js';
import { templateList, getTemplate } from '../templates.js';

if (!process.env.DATA_DIR) { console.error('Set DATA_DIR to an empty folder first'); process.exit(1); }
if (T.users.count()) { console.error('DATA_DIR already has data — use an empty folder'); process.exit(1); }
const USERS = Number(process.env.USERS || 1000), FUNNELS = 10, REVS = 3;
const EVENTS_PER_FUNNEL = Number(process.env.EVENTS_PER_FUNNEL || 200), LEADS_PER_FUNNEL = 20, ORDERS_PER_FUNNEL = 5;
const tl = templateList();
const hash = bcrypt.hashSync('secret123', 4);
const now = Date.now(), DAY = 86400000;
const rnd = (n) => Math.floor(Math.random() * n);
const SRC = ['facebook', 'instagram', 'google', 'direct', 'whatsapp'];
const t0 = Date.now();
for (let u = 0; u < USERS; u++) {
  tx(() => {
    const userId = `u${u}`;
    T.users.insert({ id: userId, email: `seller${u}@load.test`, name: `Seller ${u}`, hash, settings: { businessName: `Biz ${u}`, currency: '₹', payments: {}, tracking: {} }, emailVerified: true, pv: 0, createdAt: now - 90 * DAY });
    T.pipelines.insert({ id: uid(), userId, name: 'Sales pipeline', stages: [{ id: 's1', name: 'New lead' }, { id: 's2', name: 'Customer', won: true }], at: now });
    const events = [];
    for (let k = 0; k < FUNNELS; k++) {
      const t = getTemplate(tl[(u + k) % tl.length].id);
      const fid = uid();
      const f = T.funnels.insert({ id: fid, userId, name: t.name, slug: `s${u}-${k}`, published: true, theme: t.theme, steps: t.steps, createdAt: now - 60 * DAY, updatedAt: now - rnd(30) * DAY, version: 3 });
      for (let r = 0; r < REVS; r++) T.revisions.insert({ id: uid(), funnelId: fid, userId, at: now - r * DAY, label: 'Edits', data: { name: f.name, theme: f.theme, steps: f.steps } });
      const land = f.steps[0].id;
      for (let e = 0; e < EVENTS_PER_FUNNEL; e++) events.push({ userId, funnelId: fid, stepId: land, type: e % 5 ? 'view' : 'convert', variant: 'A', source: SRC[rnd(5)], visitor: `v${rnd(1e9)}`, at: now - rnd(60 * DAY) });
      for (let l = 0; l < LEADS_PER_FUNNEL; l++) {
        const email = `c${u}-${k}-${l}@mail.test`;
        T.leads.insert({ id: uid(), userId, funnelId: fid, stepId: land, email, name: `Lead ${l}`, phone: '', source: SRC[rnd(5)], visitor: `v${rnd(1e9)}`, at: now - rnd(60 * DAY) });
        if (l < ORDERS_PER_FUNNEL) T.orders.insert({ id: uid(), userId, funnelId: fid, email, name: `Lead ${l}`, phone: '', items: [{ name: 'Product', price: 999, kind: 'main', at: now }], total: 999, coupon: null, discount: 0, source: 'facebook', status: 'paid', at: now - rnd(60 * DAY) });
        if (l % 4 === 0) T.crm.insert({ id: uid(), userId, key: email, stages: {}, custom: { bday: '1990-05-17' }, tags: ['vip'], activities: [{ id: uid(), at: now, type: 'note', title: 'Note', text: 'Called' }], at: now });
      }
    }
    Events.addMany(events);
    const aid = uid();
    T.automations.insert({ id: aid, userId, name: 'Welcome', trigger: { type: 'lead' }, steps: [{ id: 'w', type: 'wait', amount: 1, unit: 'days' }, { id: 'e', type: 'email', subject: 'Hi', body: 'Hello' }], active: true, stats: {}, createdAt: now, origin: 'http://localhost' });
    for (let r = 0; r < 30; r++) T.runs.insert({ id: uid(), userId, automationId: aid, key: `c${u}-0-${r}@mail.test`, ctx: { email: `c${u}-0-${r}@mail.test`, name: 'x' }, pos: [0], nextAt: now + DAY, waitUntil: now + DAY, status: 'active', at: now, log: [] });
  });
  if (u % 100 === 99) console.log(`${u + 1} sellers…`);
}
console.log(`Seeded ${USERS} sellers, ${USERS * FUNNELS} funnels, ${USERS * FUNNELS * EVENTS_PER_FUNNEL} page views in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(0);
