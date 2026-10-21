// Funnel pages under India's e-commerce rules: no made-up urgency or buyers (CCPA dark-pattern guidelines 2023),
// and the seller's identity and policies on every page (Consumer Protection (E-Commerce) Rules 2020).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.mjs';

let srv, api, T, f;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  // as helpers' register, with a password no strength rule turns down
  const email = `c${Date.now()}@test.dev`;
  T = (await api('/auth/register', 'POST', { email, password: 'Comply-Pages-2026!x', name: 'Tester' })).data.token;
  await api('/privacy', 'PUT', { legalName: 'Tester Pvt Ltd', address: 'Andheri, Mumbai, Maharashtra', grievanceName: 'Tester', grievanceEmail: email, checkbox: false }, T);
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());

test('public page data carries the seller’s name, address and policy links for the footer', async () => {
  const s = (await api(`/public/${f.slug}`)).data.seller;
  assert.equal(s.name, 'Tester Pvt Ltd');
  assert.match(s.address, /Mumbai/);
  for (const k of ['terms', 'privacy', 'refund', 'contact']) assert.match(s[k], new RegExp(`/legal/.+/${k}$`), k);
  assert.equal(s.origin, 'India');
  assert.equal((await fetch(`${srv.base}${s.refund}`)).status, 200);
});

test('recent buyers: only real orders, first name and city, never email or phone', async () => {
  const co = f.steps.find((s) => s.type === 'checkout');
  const social = async () => (await api(`/public/${f.slug}/social?stepId=${co.id}`)).data;
  assert.deepEqual((await social()).orders, [], 'nothing to show yet');
  assert.equal(typeof (await social()).viewers, 'number');
  // the demo checkout (no payment gateway connected) is a test order: never shown
  const t = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'test@x.in', name: 'Tina Test', phone: '9876500000' });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  // a free, shipped product with real stock the seller entered
  const full = (await api(`/funnels/${f.id}`, 'GET', null, T)).data;
  const step = full.steps.find((s) => s.id === co.id);
  const chk = step.blocks.find((b) => b.type === 'checkout');
  Object.assign(chk.props, { price: 0, mrp: 0, bumpEnabled: false, shipping: 'address', shippingFee: 0 });
  step.blocks.push({ id: 'stk1', type: 'stock', props: { label: 'Only {n} left', left: 5, setAt: Date.now() - 1000 } }, { id: 'stk0', type: 'stock', props: { label: 'Only {n} left', left: 0 } }, { id: 'pr1', type: 'proof', props: {} }, { id: 'lc1', type: 'livecount', props: {} });
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { steps: full.steps }, T)).status, 200);
  const o = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'ravi@x.in', name: 'Ravi Kumar', phone: '+91 98765 43210', address: { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' } });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const d = await social();
  assert.equal(d.orders.length, 1, 'the test order is left out');
  assert.equal(d.orders[0].name, 'Ravi');
  assert.equal(d.orders[0].city, 'Pune');
  assert.ok(d.orders[0].at > 0);
  assert.deepEqual(Object.keys(d.orders[0]).sort(), ['at', 'city', 'name']);
  const raw = JSON.stringify(d);
  assert.doesNotMatch(raw, /ravi@x\.in|98765|Kumar|MG Road|test@x\.in|Tina/);
  assert.deepEqual(d.stock, { stk1: 4 }, 'the seller’s stock less real orders; no number set = nothing');
  // a page without a recent-buyers block gives nothing away about buyers
  const other = full.steps.find((x) => x.id !== co.id && !x.blocks.some((bl) => bl.type === 'proof'));
  assert.deepEqual((await api(`/public/${f.slug}/social?stepId=${other.id}`)).data.orders, []);
  assert.equal((await api(`/public/nope-${Date.now()}/social`)).status, 404);
});

test('templates and the AI’s defaults: no resetting countdowns, made-up buyers, viewer or stock counts, or guilt-trip decline links', async () => {
  // loaded here, not through the API (a hundred template fetches are slow); a throwaway data dir like quality.test
  process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ff-compliance-'));
  const { allTemplates } = await import('../templates.js');
  const { DEFAULT_BLOCKS, offerStep } = await import('../actions.js');
  const pages = [
    ...allTemplates().flatMap((t) => t.steps.map((st) => [`${t.id}/${st.slug}`, st.blocks])),
    ['actions/defaults', Object.entries(DEFAULT_BLOCKS).map(([type, props]) => ({ type, props }))],
    ['actions/upsell', offerStep('upsell', { steps: [] }).blocks], ['actions/downsell', offerStep('downsell', { steps: [] }).blocks],
  ];
  assert.ok(pages.length > 100);
  const bad = [];
  for (const [page, blocks] of pages) for (const b of blocks) {
    const p = b.props || {}, where = `${page}/${b.type}`;
    if (b.type === 'countdown' && !(p.mode === 'session' || (p.mode === 'fixed' && p.endsAt > Date.now()))) bad.push(`${where}: countdown without a real deadline`);
    if (b.type === 'proof' && p.items?.length) bad.push(`${where}: made-up buyers`);
    if (b.type === 'livecount' && (p.min || p.max)) bad.push(`${where}: made-up viewers`);
    if (b.type === 'stock' && Number(p.left) > 0) bad.push(`${where}: made-up stock`);
    if (b.type === 'offer' && Number(p.minutes) > 0) bad.push(`${where}: offer timer`);
    const text = JSON.stringify(p);
    if (/No thanks, I|I don.t want|pay full price|I hate|I prefer to/i.test(text)) bad.push(`${where}: confirmshaming`);
    // (in the offer and urgency sections — a testimonial may well mention midnight)
    if (['hellobar', 'stickybar', 'exitpopup', 'countdown', 'checkout', 'offer', 'pricing', 'cta'].includes(b.type) && /price is (held|locked)|locked for|ends tonight|today only|at midnight|comes down in|already (taken|booked)|Not available later/i.test(text)) bad.push(`${where}: made-up urgency`);
  }
  assert.deepEqual(bad, []);
});
