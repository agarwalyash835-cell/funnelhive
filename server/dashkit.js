// The dashboard for the seller's industry: the numbers that run their business — a property broker sees site visits
// and bookings, a clinic appointments and follow-ups, a gym trials and renewals, a store COD orders and repeat buyers —
// instead of the same revenue tiles for everyone. The industry is the CRM kit they picked (Coach & creator by
// default); the dashboard can be switched to another industry without touching the CRM.
// Tiles: { base } — a number the overview already has (revenue, orders, leads…), shown with its own label; or a
// number counted here: people who reached a pipeline stage, who are in one now, bookings, WhatsApp chats, webinar
// sign-ups, quotes, students, COD orders, abandoned carts, repeat buyers.
import { T, paidOrder } from './db.js';
import { KITS } from './crmkits.js';
import { pipelinesFor, stageFor } from './crm.js';

const DAY = 86400000;
const B = (base, label) => ({ base, label });
const S = (stage, label) => ({ kind: 'stage', stage, label: label || stage }); // reached this stage in the period
const NOW = (stage, label) => ({ kind: 'now', stage, label: label || stage }); // in this stage right now
const K = (kind, label) => ({ kind, label });
// per industry: the hero number first, then the tiles — in the order they matter
const LAYOUT = {
  general: [B('revenue'), B('leads'), B('orders'), B('conversion'), K('webinar', 'Webinar sign-ups'), K('bookings', 'Calls booked'), K('wa', 'WhatsApp chats')],
  realestate: [S('Site visit scheduled', 'Site visits booked'), B('leads', 'Enquiries'), S('Site visit done', 'Site visits done'), S('Booking done', 'Bookings'), NOW('Negotiation', 'In negotiation'), K('wa', 'WhatsApp chats'), B('visitors')],
  clinic: [K('bookings', 'Appointments'), B('leads', 'Enquiries'), S('Consulted'), S('In treatment', 'Started treatment'), NOW('Follow-up due', 'Follow-ups due'), K('wa', 'WhatsApp chats')],
  consultant: [K('bookings', 'Discovery calls'), B('leads'), S('Proposal sent', 'Proposals sent'), S('Won', 'Deals won'), K('quotes', 'Quotes'), K('wa', 'WhatsApp chats')],
  education: [S('Demo class', 'Demo classes'), B('leads', 'Enquiries'), S('Counselling done', 'Counselled'), S('Admitted', 'Admissions'), K('webinar', 'Seminar sign-ups'), K('wa', 'WhatsApp chats')],
  fitness: [S('Trial booked', 'Trials booked'), B('leads', 'Enquiries'), S('Trial done', 'Trials done'), S('Joined', 'New members'), NOW('Renewal due', 'Renewals due'), K('wa', 'WhatsApp chats')],
  finance: [B('leads', 'New leads'), S('Needs analysis', 'Needs analyses'), S('Proposal shared', 'Proposals shared'), S('Closed', 'Closed'), K('bookings', 'Calls booked'), K('wa', 'WhatsApp chats')],
  interior: [S('Site visit', 'Site visits'), B('leads', 'Enquiries'), S('Design & quote', 'Designs quoted'), S('Signed', 'Projects signed'), K('quotes', 'Quotes'), K('wa', 'WhatsApp chats')],
  events: [B('leads', 'Enquiries'), S('Quote sent', 'Quotes sent'), S('Advance paid', 'Advances paid'), K('bookings', 'Meetings'), NOW('Event done', 'Events done'), K('wa', 'WhatsApp chats')],
  travel: [B('leads', 'Enquiries'), S('Itinerary sent', 'Itineraries sent'), S('Booked', 'Trips booked'), K('quotes', 'Quotes'), K('wa', 'WhatsApp chats'), B('visitors')],
  auto: [S('Test drive', 'Test drives'), B('leads', 'Enquiries'), S('Quotation', 'Quotations'), S('Booked', 'Bookings'), S('Delivered', 'Deliveries'), K('wa', 'WhatsApp chats')],
  professional: [K('bookings', 'Consultations'), B('leads', 'Enquiries'), S('Fee quote', 'Fee quotes'), S('Engaged', 'Clients engaged'), K('quotes', 'Quotes'), K('wa', 'WhatsApp chats')],
  recruitment: [B('leads', 'Candidates'), S('Interview', 'Interviews'), S('Offer', 'Offers'), S('Joined', 'Joinings'), K('wa', 'WhatsApp chats'), B('visitors')],
  homeservices: [S('Site survey', 'Site surveys'), B('leads', 'Enquiries'), S('Quote sent', 'Quotes sent'), S('Order confirmed', 'Orders confirmed'), S('Installed', 'Installations'), K('wa', 'WhatsApp chats')],
  hospitality: [S('Confirmed', 'Bookings confirmed'), B('leads', 'Enquiries'), S('Quote sent', 'Quotes sent'), S('Checked in', 'Check-ins'), NOW('Confirmed', 'Arrivals coming'), K('wa', 'WhatsApp chats')],
  store: [B('revenue', 'Sales'), B('orders'), B('aov', 'Average order'), K('cod', 'COD to confirm'), K('abandoned', 'Abandoned carts'), K('repeat', 'Repeat buyers'), K('wa', 'WhatsApp chats')],
  abroad: [S('Counselling', 'Counselling sessions'), B('leads', 'Enquiries'), S('Applied', 'Applications'), S('Offer letter', 'Offer letters'), S('Visa approved', 'Visas approved'), K('wa', 'WhatsApp chats')],
  wellness: [K('bookings', 'Consultations'), B('leads', 'Enquiries'), S('Consulted'), S('Package bought', 'Packages bought'), B('revenue'), K('wa', 'WhatsApp chats')],
  saas: [K('bookings', 'Demos booked'), B('leads', 'Sign-ups'), S('Trial', 'Trials'), S('Customer', 'New customers'), B('revenue'), K('wa', 'WhatsApp chats')],
  ngo: [B('revenue', 'Donations'), B('orders', 'Gifts'), S('First gift', 'First-time donors'), S('Monthly donor', 'New monthly donors'), B('leads', 'New supporters'), K('wa', 'WhatsApp chats')],
};
// where each tile leads when tapped
const LINKS = { stage: '/contacts', now: '/contacts', bookings: '/bookings', wa: '/inbox', webinar: '/webinars', quotes: '/quotes', cod: '/orders', abandoned: '/orders', repeat: '/contacts', students: '/school' };

export const kitOf = (u) => KITS.find((k) => k.id === (u.settings?.dashKit || u.settings?.crmKit?.id)) || KITS[0];
const inRange = (t, from, to) => t >= from && t < to;

function counter(u, days) {
  const now = Date.now(), from = now - days * DAY, prevFrom = from - days * DAY;
  const both = (fn) => ({ value: fn(from, now), prev: fn(prevFrom, from) });
  let crm = null;
  const metas = () => (crm ||= T.crm.all({ userId: u.id }));
  const pipes = pipelinesFor(u.id);
  // a stage their pipeline doesn't have (another industry's CRM, or renamed): 0, and how to start tracking it
  const missing = (name) => ({ value: 0, prev: null, sub: `Add a “${name}” stage in your CRM to track this` });
  const pipeOf = (name) => pipes.find((p) => p.stages.some((s) => s.name.toLowerCase() === name.toLowerCase()));
  return {
    // people who reached a stage in the period: a "Moved to …" on their timeline, or an import that placed them there
    stage(name) {
      const p = pipeOf(name), st = p?.stages.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!st) return missing(name);
      const title = `moved to ${st.name.toLowerCase()}`;
      const r = both((a, b) => metas().filter((m) => (m.activities || []).some((x) => x.type === 'stage' && inRange(x.at, a, b) && String(x.title).toLowerCase() === title) || (m.stages?.[p.id] === st.id && inRange(m.stagesAt?.[p.id] || 0, a, b))).length);
      const there = metas().filter((m) => stageFor(p, m, false) === st.id && m.stages?.[p.id] === st.id).length;
      return { ...r, sub: `${there} there now` };
    },
    now(name) {
      const p = pipeOf(name), st = p?.stages.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!st) return missing(name);
      return { value: metas().filter((m) => m.stages?.[p.id] === st.id).length, prev: null, sub: 'right now' };
    },
    bookings() {
      const all = T.bookings.all({ userId: u.id }).filter((b) => b.status !== 'cancelled');
      const r = both((a, b) => all.filter((x) => inRange(x.at, a, b)).length);
      return { ...r, sub: `${all.filter((x) => inRange(x.start, now, now + 7 * DAY)).length} in the next 7 days` };
    },
    wa() {
      const all = T.waconvs.all({ userId: u.id });
      const r = both((a, b) => all.filter((c) => inRange(c.at, a, b)).length);
      const recent = all.filter((c) => inRange(c.at, from, now));
      return { ...r, sub: recent.length ? `${Math.round((recent.filter((c) => c.aiReplies > 0).length / recent.length) * 100)}% answered by AI` : 'new conversations' };
    },
    webinar() {
      const all = T.registrations.all({ userId: u.id }).filter((x) => x.status !== 'cancelled');
      const r = both((a, b) => all.filter((x) => inRange(x.at, a, b)).length);
      const past = all.filter((x) => inRange(x.session, from, now));
      return { ...r, sub: past.length ? `${Math.round((past.filter((x) => x.attended).length / past.length) * 100)}% showed up` : 'registrations' };
    },
    quotes() {
      const all = T.quotes.all({ userId: u.id });
      const r = both((a, b) => all.filter((q) => inRange(q.at, a, b)).length);
      return { ...r, sub: `${all.filter((q) => inRange(q.at, from, now) && (q.payments || []).length).length} paid` };
    },
    cod() {
      const all = T.orders.all({ userId: u.id }).filter((o) => o.status === 'cod' && !o.demo);
      return { ...both((a, b) => all.filter((o) => inRange(o.at, a, b)).length), sub: 'cash-on-delivery orders' };
    },
    abandoned() {
      const all = T.abandoned.all({ userId: u.id }).filter((x) => !x.demo);
      const r = both((a, b) => all.filter((x) => inRange(x.at, a, b)).length);
      const recent = all.filter((x) => inRange(x.at, from, now));
      return { ...r, sub: recent.length ? `${Math.round((recent.filter((x) => x.recovered).length / recent.length) * 100)}% recovered` : 'carts left behind' };
    },
    // buyers in the period who had bought before
    repeat() {
      const paid = T.orders.all({ userId: u.id }).filter((o) => paidOrder(o) && !o.demo);
      const first = new Map();
      for (const o of paid) { const k = String(o.email || o.phone || o.id).toLowerCase(); first.set(k, Math.min(first.get(k) ?? Infinity, o.at)); }
      const count = (a, b) => new Set(paid.filter((o) => inRange(o.at, a, b) && first.get(String(o.email || o.phone || o.id).toLowerCase()) < a).map((o) => String(o.email || o.phone).toLowerCase())).size;
      return { ...both(count), sub: 'came back and bought again' };
    },
  };
}

export function industryDashboard(u, days = 30) {
  const kit = kitOf(u), c = counter(u, days);
  const tiles = (LAYOUT[kit.id] || LAYOUT.general).map((t) => {
    if (t.base) return { base: t.base, label: t.label || null };
    const r = t.kind === 'stage' ? c.stage(t.stage) : t.kind === 'now' ? c.now(t.stage) : c[t.kind]?.();
    return r ? { id: `${t.kind}:${t.stage || ''}`, label: t.label, value: r.value, prev: r.prev, sub: r.sub, link: LINKS[t.kind] } : null;
  }).filter(Boolean);
  return { industry: { id: kit.id, name: kit.name, icon: kit.icon }, sales: kit.showSales !== false, tiles, industries: KITS.map((k) => ({ id: k.id, name: k.name, icon: k.icon })), chosen: !!u.settings?.dashKit };
}

export function registerDashKit(app, { auth }) {
  app.get('/api/dashboard/industry', auth, (req, res) => res.json(industryDashboard(req.user, [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30)));
  // show the dashboard for another industry (the CRM stays as it is); "" goes back to the CRM's industry
  app.put('/api/dashboard/industry', auth, (req, res) => {
    const id = String(req.body?.id || '');
    if (id && !KITS.some((k) => k.id === id)) return res.status(400).json({ error: 'Unknown industry' });
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...x.settings, dashKit: id || undefined }; });
    res.json(industryDashboard(u, 30));
  });
}
