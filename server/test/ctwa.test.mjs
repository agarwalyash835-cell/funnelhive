// Click-to-WhatsApp ads (ctwa.js), in process on a throwaway database: Meta's referral parsed (and anything that
// isn't an ad ignored), Meta Cloud API webhook bodies turned into inbound messages, an ad tap stored on the
// conversation and the contact (first and latest ad, source, timeline), the per-ad report (chats, leads, orders,
// revenue, spend and ROAS when the ad's spend is synced), and the Purchase event with Meta's click id.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-ctwa-'));
process.env.NODE_ENV = 'test';
process.env.FF_JOBS = '0';
let C, T, uid, U, encrypt;
const DAY = 86400000, now = Date.now();
before(async () => {
  ({ T, uid } = await import('../db.js'));
  ({ encrypt } = await import('../messaging.js'));
  (await import('../messaging.js')).initMessaging('test-secret');
  C = await import('../ctwa.js');
  U = T.users.insert({ id: uid(), email: 'seller@ctwa.test', name: 'Seller', channels: {}, settings: {} });
});
const REF = { source_url: 'https://fb.me/abc', source_id: '120055', source_type: 'ad', headline: 'Diwali yoga offer', body: '50% off the first month', media_type: 'image', image_url: 'https://scontent.x/img.jpg', ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a' };
const conv = (num, ckey) => T.waconvs.insert({ id: uid(), userId: U.id, num, ckey, name: '', status: 'open', labels: [], unread: 0, lastAt: now, at: now });

test('Meta’s referral is parsed; posts, junk and empty referrals are not ads', () => {
  const r = C.parseReferral(REF);
  assert.deepEqual([r.id, r.headline, r.url, r.clid, r.media], ['120055', 'Diwali yoga offer', 'https://fb.me/abc', REF.ctwa_clid, 'image']);
  assert.equal(C.parseReferral({ sourceId: '9', ctwaClid: 'x', headline: 'Camel' }).id, '9', 'camelCase from a provider');
  assert.equal(C.parseReferral({ ...REF, source_type: 'post' }), null);
  assert.equal(C.parseReferral({ headline: 'no id' }), null);
  assert.equal(C.parseReferral(null), null);
  assert.equal(C.parseReferral({ ...REF, source_url: 'javascript:alert(1)' }).url, '', 'only web links');
  assert.equal(C.referralOf({ text: 'hi' }), null, 'a normal message');
});

test('a Meta Cloud API webhook body becomes inbound messages, referral included', () => {
  const body = { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '555' }, contacts: [{ wa_id: '919811111111', profile: { name: 'Kavya' } }], messages: [
    { from: '919811111111', id: 'wamid.1', type: 'text', text: { body: 'Hi! I saw your ad' }, referral: REF },
    { from: '919811111111', id: 'wamid.2', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Yes' } } },
  ] } }] }] };
  const [a, b] = C.metaInbound(body);
  assert.deepEqual([a.from, a.contact_name, a.type, a.text, a.phone_number_id], ['919811111111', 'Kavya', 'text', 'Hi! I saw your ad', '555']);
  assert.equal(C.referralOf(a).id, '120055');
  assert.deepEqual([b.text, b.interactive_id, b.referral], ['Yes', 'b1', undefined]);
  assert.deepEqual(C.metaInbound({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), [], 'status updates carry no messages');
  assert.deepEqual(C.metaInbound(null), []);
});

test('an ad tap is stored on the chat and the contact: first and latest ad, source, one timeline entry per visit', () => {
  const key = 'phone:9811111111';
  T.crm.insert({ id: uid(), userId: U.id, key, manual: true, source: 'whatsapp', phone: '+919811111111', stages: {}, custom: {}, tags: [], activities: [], at: now });
  let c = conv('919811111111', key);
  C.recordAdTouch(U.id, c, key, C.parseReferral(REF));
  c = T.waconvs.get(c.id);
  C.recordAdTouch(U.id, c, key, C.parseReferral(REF)); // tapped again a minute later
  C.recordAdTouch(U.id, T.waconvs.get(c.id), key, C.parseReferral({ ...REF, source_id: '120099', headline: 'Free trial class' }));
  c = T.waconvs.get(c.id);
  assert.equal(c.firstAd.id, '120055');
  assert.equal(c.ad.id, '120099');
  assert.equal(c.adTaps, 3);
  const m = T.crm.find({ userId: U.id, key });
  assert.deepEqual([m.adFirst.id, m.adLast.id, m.adLast.clid, m.source], ['120055', '120099', REF.ctwa_clid, C.AD_SOURCE]);
  assert.deepEqual(m.activities.map((a) => a.title), ['Came from ad: Diwali yoga offer', 'Came from ad: Free trial class']);
  // a funnel lead keeps its own source
  T.crm.insert({ id: uid(), userId: U.id, key: 'old@x.in', stages: {}, custom: {}, tags: [], activities: [], at: now });
  C.recordAdTouch(U.id, null, 'old@x.in', C.parseReferral(REF));
  assert.equal(T.crm.find({ userId: U.id, key: 'old@x.in' }).source, undefined);
});

test('report: chats, leads, orders and revenue per ad, with spend and ROAS from the synced ad', () => {
  const order = (o) => T.orders.insert({ id: uid(), userId: U.id, funnelId: 'f1', name: 'x', provider: 'razorpay', status: 'paid', items: [{ name: 'Course', price: o.total, kind: 'main' }], ...o });
  // ad 200: three chats — Asha buys twice (by phone), Ravi gives his email, Sunil only chats
  const a = conv('919822222221', 'phone:9822222221'), r = conv('919822222222', 'ravi@x.in'), s = conv('919822222223', 'phone:9822222223');
  for (const c of [a, r, s]) C.recordAdTouch(U.id, c, c.ckey, C.parseReferral({ source_id: '200', headline: 'Reel 200', ctwa_clid: 'c' }));
  order({ email: 'asha@x.in', phone: '+91 98222 22221', total: 3000, at: Date.now() + 1000 });
  order({ email: 'asha@x.in', phone: '9822222221', total: 1000, at: Date.now() + 2000 });
  order({ email: 'asha@x.in', phone: '9822222221', total: 500, status: 'cancelled', at: Date.now() + 3000 }); // not paid
  order({ email: 'zed@x.in', phone: '9822222299', total: 9999, at: Date.now() + 1000 }); // someone else
  // ad 300: one chat, no sale
  C.recordAdTouch(U.id, conv('919833333331', 'phone:9833333331'), 'phone:9833333331', C.parseReferral({ source_id: '300', ctwa_clid: 'd' }));
  // spend synced from Meta for ad 200
  T.adspend.insert({ id: uid(), userId: U.id, platform: 'meta', date: '2026-10-20', campaign: 'Diwali', key: 'diwali', spend: 2000, at: now - DAY, ad: 'Reel 200 v2', adKey: 'reel200v2', adId: '200' });

  const rep = C.adChatsReport(U.id, { from: now - 30 * DAY });
  const r200 = rep.rows.find((x) => x.adId === '200'), r300 = rep.rows.find((x) => x.adId === '300');
  assert.deepEqual([r200.chats, r200.leads, r200.orders, r200.revenue, r200.buyers], [3, 2, 2, 4000, 1]);
  assert.deepEqual([r200.name, r200.campaign, r200.spend, r200.roas, r200.costPerChat], ['Reel 200 v2', 'Diwali', 2000, 2, 667]);
  assert.deepEqual([r300.chats, r300.leads, r300.orders, r300.spend, r300.roas, r300.headline], [1, 0, 0, null, null, '']);
  assert.ok(rep.totals.chats >= 4);
  assert.equal(C.adChatsReport(U.id, { from: now + DAY }).rows.length, 0, 'nothing in a later period');
});

test('a sale from an ad chat goes to Meta as a business-messaging Purchase with the click id (own token only)', () => {
  assert.equal(C.adPurchase(U.id, { phone: '9822222221', amount: 3000 }), null, 'no Conversions API set up');
  T.users.update(U.id, (x) => { x.settings = { tracking: { fbPixel: '1234567890' } }; x.channels = { capi: { metaTokenEnc: encrypt('EAAB'.padEnd(40, 'x')) }, whatsapp: { wabaId: '777' } }; });
  const d = C.adPurchase(U.id, { phone: '+91 98222 22221', amount: 3000 });
  const e = d.body.data[0];
  assert.deepEqual([e.event_name, e.action_source, e.messaging_channel, e.user_data.ctwa_clid, e.user_data.whatsapp_business_account_id, e.custom_data.value], ['Purchase', 'business_messaging', 'whatsapp', 'c', '777', 3000]);
  assert.ok(e.user_data.ph[0].length === 64, 'phone hashed');
  assert.equal(C.adPurchase(U.id, { phone: '9000000000', amount: 10 }), null, 'a buyer who never came from an ad');
  // an old click (over 7 days) isn't sent
  const c = T.waconvs.find({ userId: U.id, num: '919833333331' });
  T.waconvs.update(c.id, (x) => { x.ad.at = now - 8 * DAY; });
  assert.equal(C.adPurchase(U.id, { phone: '9833333331', amount: 10 }), null);
});
