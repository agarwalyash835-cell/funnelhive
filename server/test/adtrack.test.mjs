// The Ads report: leads, calls and sales per ad by last click and first click, lifetime value credited to the ad
// that first brought the person, won deals, spend per ad matched by ad id / campaign + ad name, and spend no lead
// matched still listed. Runs on a throwaway database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-ads-'));
process.env.NODE_ENV = 'test';
let A, T, uid, U;
const DAY = 86400000, now = Date.now();
before(async () => {
  ({ T, uid } = await import('../db.js'));
  A = await import('../adtrack.js');
  U = T.users.insert({ id: uid(), email: 'seller@ads.test', name: 'Seller', channels: {}, settings: {} });
});

const reel = { utm_source: 'facebook', utm_campaign: 'diwali sale', utm_term: 'women 25-40', utm_content: 'reel a', ad_id: '120001' };
const carousel = { utm_source: 'facebook', utm_campaign: 'diwali sale', utm_content: 'carousel b' };
const lead = (email, at, attr) => T.leads.insert({ id: uid(), userId: U.id, funnelId: 'f1', email, name: email, phone: '', at, ...(attr ? { attr } : {}) });
const order = (email, at, total, attr) => T.orders.insert({ id: uid(), userId: U.id, funnelId: 'f1', email, name: email, total, provider: 'razorpay', status: 'paid', items: [{ name: 'Course', price: total, kind: 'main' }], at, ...(attr ? { attr } : {}) });
const spend = (date, campaign, s, extra = {}) => T.adspend.insert({ id: uid(), userId: U.id, platform: 'meta', date, campaign, key: campaign.toLowerCase().replace(/[^a-z0-9]+/g, ''), spend: s, at: Date.parse(`${date}T00:00:00+05:30`), ...extra });
const ymd = (t) => new Date(t + 330 * 60000).toISOString().slice(0, 10);

test('per ad: last click vs first click, lifetime value to the first ad, spend matched by ad id and by name', () => {
  // Asha: clicked the reel, signed up; came back later from the carousel and bought ₹5,000; renewed ₹2,000
  lead('asha@x.in', now - 10 * DAY, reel);
  order('asha@x.in', now - 5 * DAY, 5000, carousel);
  order('asha@x.in', now - 2 * DAY, 2000, null);
  // Ravi: carousel lead, booked a call, deal won in the CRM
  lead('ravi@x.in', now - 8 * DAY, carousel);
  T.bookings.insert({ id: uid(), userId: U.id, calendarId: 'c1', email: 'ravi@x.in', name: 'Ravi', status: 'confirmed', start: now + DAY, at: now - 7 * DAY, attr: carousel });
  const p = T.pipelines.insert({ id: uid(), userId: U.id, name: 'Sales', stages: [{ id: 's1', name: 'New' }, { id: 'won', name: 'Won', won: true }] });
  T.crm.insert({ id: uid(), userId: U.id, key: 'ravi@x.in', stages: { [p.id]: 'won' }, custom: {}, tags: [], activities: [], at: now });
  // an organic buyer
  order('walkin@x.in', now - 3 * DAY, 999, null);
  // spend: the reel by ad id, the carousel by campaign + ad name, and an ad nobody came from
  spend(ymd(now - 9 * DAY), 'Diwali Sale', 3000, { ad: 'Reel A', adKey: 'reela', adId: '120001', adset: 'Women 25-40', impressions: 10000, clicks: 300 });
  spend(ymd(now - 9 * DAY), 'Diwali Sale', 1000, { ad: 'Carousel B', adKey: 'carouselb', adId: '120002' });
  spend(ymd(now - 9 * DAY), 'Diwali Sale', 2500, { ad: 'Static C', adKey: 'staticc', adId: '120003' });

  const last = A.adReport(U.id, { from: now - 30 * DAY, model: 'last' });
  const by = (rep, name) => rep.rows.find((r) => r.ad === name || r.ad.toLowerCase() === name);
  const r1 = by(last, 'reel a'), c1 = by(last, 'carousel b');
  assert.deepEqual([r1.leads, r1.sales, r1.spend, r1.cpl], [1, 0, 3000, 3000], 'last click: the reel got Asha’s sign-up');
  assert.deepEqual([c1.leads, c1.calls, c1.sales, c1.revenue, c1.spend], [1, 1, 1, 5000, 1000], 'last click: the carousel got her sale (and Ravi)');
  assert.equal(c1.roas, 5);
  assert.equal(r1.adset, 'women 25-40');
  // lifetime value always follows the first ad: Asha's ₹7,000 goes to the reel
  assert.deepEqual([r1.customers, r1.ltv, r1.ltvRoas], [1, 7000, 2.33]);
  assert.equal(c1.won, 1, 'Ravi’s won deal');
  const direct = last.rows.find((r) => r.source === 'direct');
  assert.ok(direct.sales >= 2, 'untracked sales show as direct');
  const unmatched = by(last, 'Static C');
  assert.deepEqual([unmatched.spend, unmatched.leads, unmatched.sales], [2500, 0, 0], 'spend with no leads still shows');
  assert.equal(last.totals.spend, 6500);

  const first = A.adReport(U.id, { from: now - 30 * DAY, model: 'first' });
  const r2 = by(first, 'reel a'), c2 = by(first, 'carousel b');
  assert.deepEqual([r2.leads, r2.sales, r2.revenue], [1, 2, 7000], 'first click: both of Asha’s purchases go to the reel');
  assert.deepEqual([c2.leads, c2.sales], [1, 0]);
  assert.match(first.setup.urlParams, /ad_id=\{\{ad\.id\}\}/);

  // a shorter period leaves out older events
  const week = A.adReport(U.id, { from: now - 4 * DAY, model: 'last' });
  assert.equal(by(week, 'reel a')?.leads || 0, 0);
});

test('agency numbers: Meta’s insights become CPM, frequency, CTR, CPC, landing page views, hook and hold rate, and Meta’s results next to ours', async () => {
  const { insightRow } = await import('../adspend.js');
  const x = insightRow({ date_start: '2026-11-01', campaign_name: 'Tally Launch', adset_name: 'Traders', ad_name: 'VSL 1', ad_id: '130001', spend: '2000', impressions: '40000', reach: '20000', clicks: '900', inline_link_clicks: '600',
    actions: [{ action_type: 'landing_page_view', value: '450' }, { action_type: 'lead', value: '40' }, { action_type: 'omni_purchase', value: '5' }, { action_type: 'purchase', value: '5' }, { action_type: 'video_view', value: '12000' }],
    action_values: [{ action_type: 'omni_purchase', value: '15000' }], video_thruplay_watched_actions: [{ action_type: 'video_view', value: '3000' }] });
  assert.deepEqual([x.reach, x.linkClicks, x.lpv, x.metaLeads, x.metaPurchases, x.metaValue, x.video3s, x.thruplay], [20000, 600, 450, 40, 5, 15000, 12000, 3000]);
  const U2 = T.users.insert({ id: uid(), email: 'agency@ads.test', name: 'A', channels: {}, settings: { adWindow: '7d_click' } });
  T.adspend.insert({ id: uid(), userId: U2.id, platform: 'meta', date: x.date, campaign: x.campaign, key: 'tallylaunch', ad: x.ad, adKey: 'vsl1', adId: x.adId, adset: x.adset, spend: 2000, at: now - DAY, ...x, date: x.date });
  T.adcreatives.insert({ id: uid(), userId: U2.id, adId: '130001', thumb: 'https://scontent.example/t.jpg', title: 'Stuck payments?', body: 'Recover them on WhatsApp', at: now });
  const vsl = { utm_source: 'facebook', utm_campaign: 'Tally Launch', utm_content: 'VSL 1', ad_id: '130001' };
  for (let i = 0; i < 4; i++) T.leads.insert({ id: uid(), userId: U2.id, funnelId: 'f2', email: `l${i}@x.in`, name: 'L', phone: '', at: now - DAY, attr: vsl });
  T.orders.insert({ id: uid(), userId: U2.id, funnelId: 'f2', email: 'l0@x.in', name: 'L', total: 4000, provider: 'razorpay', status: 'paid', items: [{ name: 'Plan', price: 4000, kind: 'main' }], at: now - DAY, attr: vsl });
  const rep = A.adReport(U2.id, { from: now - 30 * DAY });
  const r = rep.rows.find((y) => y.adId === '130001');
  assert.deepEqual([r.cpm, r.frequency, r.ctr, r.cpc, r.lpvRate, r.hookRate, r.holdRate, r.metaRoas], [50, 2, 1.5, 3.33, 75, 30, 25, 7.5]);
  assert.deepEqual([r.cpl, r.cpa, r.cac, r.roas], [500, 2000, 2000, 2]);
  assert.equal(r.creative.thumb, 'https://scontent.example/t.jpg');
  assert.deepEqual(rep.totals.check.leads, { meta: 40, ours: 4, diff: -90 }, 'Meta claims ten times the leads we saw: tracking is off');
  assert.equal(rep.totals.check.window, '7d_click');
});
