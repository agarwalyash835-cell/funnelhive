// Click-to-WhatsApp ads: which Meta ad started each WhatsApp chat.
// A customer who taps an ad's "Send WhatsApp message" button arrives with a `referral` on their first message
// (the ad's id, headline, link and Meta's click id, ctwa_clid). It is kept on the conversation and the CRM contact
// (the first ad that brought them and the latest one), logged on their timeline, can start an ad-specific chatbot,
// and the Ads page counts each ad's chats, leads, orders and revenue next to what the ad cost.
// Works for both WhatsApp routes: Hive WhatsApp passes the referral on its message.inbound event; for the Meta
// Cloud API, metaInbound() turns Meta's webhook body into the same events (see hive-wa.js receiveWhatsApp).
import { T, q, uid, phoneTail } from './db.js';
import { ensureMeta, logActivity } from './crm.js';
import { sendMessagingEvent } from './tracking.js';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const link = (v) => (/^https?:\/\/\S+$/i.test(String(v || '').trim()) ? clip(v, 500) : '');
export const AD_SOURCE = 'whatsapp ad';

// Meta's referral object (snake_case), or the same fields camelCased → { id, headline, body, url, media, image, clid, type } | null
export function parseReferral(r) {
  if (!r || typeof r !== 'object') return null;
  const g = (...ks) => { for (const k of ks) if (r[k] != null && r[k] !== '') return r[k]; return ''; };
  const type = clip(g('source_type', 'sourceType', 'type'), 20).toLowerCase();
  const id = clip(g('source_id', 'sourceId', 'ad_id', 'adId'), 60).replace(/[^\w.-]/g, '');
  const clid = clip(g('ctwa_clid', 'ctwaClid', 'clid'), 300);
  // a tap on an ad (Meta also sends "post" for a boosted / organic post); nothing to go on without an id or click id
  if (type && type !== 'ad') return null;
  if (!id && !clid) return null;
  return {
    id, clid, type: 'ad',
    headline: clip(g('headline', 'title'), 200), body: clip(g('body', 'text'), 500),
    url: link(g('source_url', 'sourceUrl', 'url')), media: clip(g('media_type', 'mediaType'), 20),
    image: link(g('image_url', 'imageUrl', 'thumbnail_url', 'thumbnailUrl')) || link(g('video_url', 'videoUrl')),
  };
}
// the referral on an inbound message, wherever the provider put it
export const referralOf = (d = {}) => parseReferral(d.referral || d.ad_referral || d.context?.referral || null);
export const adLabel = (a) => a?.headline || (a?.id ? `Ad ${a.id}` : 'an ad');

// Meta Cloud API webhook body → inbound messages in the shape hive-wa.js handles ({ from, contact_name, type, text, … })
export function metaInbound(body) {
  const out = [];
  for (const e of Array.isArray(body?.entry) ? body.entry : []) {
    for (const ch of Array.isArray(e?.changes) ? e.changes : []) {
      const v = ch?.value || {};
      const names = new Map((Array.isArray(v.contacts) ? v.contacts : []).map((c) => [String(c.wa_id || ''), c.profile?.name || '']));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (!m?.from) continue;
        const t = m.type;
        const ia = m.interactive?.button_reply || m.interactive?.list_reply || null;
        out.push({
          from: String(m.from), contact_name: names.get(String(m.from)) || '', message_id: m.id || '', type: t === 'interactive' || t === 'button' ? 'text' : t || 'text',
          text: m.text?.body || ia?.title || m.button?.text || m[t]?.caption || '',
          ...(ia?.id ? { interactive_id: ia.id } : {}), ...(m[t] && ['image', 'video', 'document', 'audio', 'sticker'].includes(t) ? { media: m[t] } : {}), ...(t === 'location' ? { location: m.location } : {}),
          ...(m.referral ? { referral: m.referral } : {}), phone_number_id: v.metadata?.phone_number_id || '',
        });
      }
    }
  }
  return out;
}

// Records an ad tap on the conversation and the contact. → the referral, or null when the message had none
export function recordAdTouch(userId, conv, key, ref) {
  if (!ref) return null;
  const at = Date.now(), touch = { ...ref, at };
  const prev = conv?.ad;
  if (conv) T.waconvs.update(conv.id, (c) => { c.ad = touch; c.firstAd ||= touch; c.adTaps = (c.adTaps || 0) + 1; });
  if (key) {
    const m = ensureMeta(userId, key);
    T.crm.update(m.id, (x) => {
      x.adFirst ||= touch; x.adLast = touch;
      // a contact who first wrote from the ad is listed with that source (funnel leads and orders keep theirs)
      if (x.manual && (!x.source || x.source === 'whatsapp')) x.source = AD_SOURCE;
    });
    // the same ad tapped again within minutes is one visit
    if (!(prev && prev.id === ref.id && at - (prev.at || 0) < 10 * 60000)) logActivity(userId, key, { type: 'note', title: `Came from ad: ${clip(adLabel(ref), 120)}`, text: [ref.body, ref.url].filter(Boolean).join('\n'), by: 'contact', ad: { id: ref.id, url: ref.url } });
  }
  return touch;
}

// for the inbox: the ad chip on a conversation
export const adView = (a) => (a ? { id: a.id || '', headline: a.headline || '', url: a.url || '', at: a.at || 0 } : null);

// ---------- the report: WhatsApp chats from ads ----------
// Chats are credited to the first ad that started them; leads are those people who shared details (an email or a
// form) or bought; orders and revenue are their paid orders after the ad tap (matched by phone or email).
export function adChatsReport(userId, { from = 0, to = Date.now() + 1 } = {}) {
  const convs = q("SELECT num, json_extract(data, '$.ckey') AS ckey, json_extract(data, '$.firstAd') AS ad FROM waconvs WHERE userId = ? AND json_extract(data, '$.firstAd.at') >= ? AND json_extract(data, '$.firstAd.at') < ?").all(userId, from, to);
  const rows = new Map();
  for (const c of convs) {
    const ad = JSON.parse(c.ad || 'null');
    if (!ad) continue;
    const id = ad.id || `clid:${ad.headline || '?'}`;
    const r = rows.get(id) || rows.set(id, { adId: ad.id || '', headline: ad.headline || '', url: ad.url || '', chats: 0, leads: 0, orders: 0, revenue: 0, buyers: 0, lastAt: 0 }).get(id);
    if (!r.headline && ad.headline) r.headline = ad.headline;
    r.chats += 1; r.lastAt = Math.max(r.lastAt, ad.at);
    const tail = phoneTail(c.num);
    const isEmail = c.ckey && !c.ckey.startsWith('phone:');
    const orders = q("SELECT id, ckey, net, json_extract(data, '$.phone') AS p FROM orders WHERE userId = ? AND at >= ? AND paid = 1 AND COALESCE(demo, 0) = 0 AND (ckey = ? OR json_extract(data, '$.phone') LIKE ?)").all(userId, ad.at - 60000, isEmail ? c.ckey : '\u0000', `%${tail.slice(-4)}`)
      .filter((o) => (isEmail && o.ckey === c.ckey) || (tail.length >= 8 && phoneTail(o.p) === tail));
    const meta = c.ckey ? T.crm.find({ userId, key: c.ckey }) : null;
    const lead = orders.length || isEmail || meta?.email || (c.ckey && T.leads.exists({ userId, ckey: c.ckey }));
    if (lead) r.leads += 1;
    if (orders.length) { r.buyers += 1; r.orders += orders.length; r.revenue += orders.reduce((n, o) => n + (o.net || 0), 0); }
  }
  // what the ad cost, when the seller's Meta ad spend is synced (Ads → connect Meta): matched by ad id
  const ids = [...rows.values()].map((r) => r.adId).filter(Boolean);
  if (ids.length) {
    const spend = q(`SELECT json_extract(data, '$.adId') AS id, MAX(json_extract(data, '$.ad')) AS ad, MAX(json_extract(data, '$.campaign')) AS c, SUM(json_extract(data, '$.spend')) AS s FROM adspend WHERE userId = ? AND at >= ? AND at < ? AND json_extract(data, '$.adId') IN (${ids.map(() => '?').join(',')}) GROUP BY id`).all(userId, from - DAY / 2, to, ...ids);
    for (const sp of spend) { const r = rows.get(sp.id); if (r) Object.assign(r, { name: sp.ad || '', campaign: sp.c || '', spend: Math.round(sp.s || 0) }); }
  }
  const out = [...rows.values()].map((r) => ({ ...r, name: r.name || '', campaign: r.campaign || '', spend: r.spend ?? null, revenue: Math.round(r.revenue), roas: r.spend ? Math.round((r.revenue / r.spend) * 100) / 100 : null, costPerChat: r.spend ? Math.round(r.spend / r.chats) : null }))
    .sort((a, b) => b.chats - a.chats || b.revenue - a.revenue).slice(0, 200);
  const sum = (k) => out.reduce((n, r) => n + (r[k] || 0), 0);
  const totals = { chats: sum('chats'), leads: sum('leads'), orders: sum('orders'), revenue: sum('revenue'), spend: sum('spend') };
  totals.roas = totals.spend ? Math.round((totals.revenue / totals.spend) * 100) / 100 : null;
  return { rows: out, totals };
}

// ---------- Meta Conversions API: a sale from a WhatsApp ad chat ----------
// The latest ad tap (within 7 days) of the person who bought → { clid, phone } for a business_messaging Purchase event
export function adClickFor(userId, { phone, email } = {}) {
  const tail = phoneTail(phone);
  const fresh = (a) => a?.clid && Date.now() - (a.at || 0) < 7 * DAY;
  if (tail.length >= 8) {
    const c = q("SELECT json_extract(data, '$.ad') AS ad, num FROM waconvs WHERE userId = ? AND num LIKE ? AND json_extract(data, '$.ad.clid') IS NOT NULL").all(userId, `%${tail}`).find((x) => phoneTail(x.num) === tail);
    const ad = c && JSON.parse(c.ad);
    if (fresh(ad)) return { clid: ad.clid, adId: ad.id, phone: c.num };
  }
  const m = email ? T.crm.find({ userId, key: String(email).trim().toLowerCase() }) : null;
  if (fresh(m?.adLast)) return { clid: m.adLast.clid, adId: m.adLast.id, phone: m.phone || phone || '' };
  return null;
}
// a purchase (automations.js fire): the buyer came from a WhatsApp ad in the last 7 days → a Purchase event to Meta
export function adPurchase(userId, data = {}) {
  const click = adClickFor(userId, data);
  if (!click) return null;
  const u = T.users.get(userId);
  return sendMessagingEvent(userId, { name: 'Purchase', value: data.amount, id: `ctwa-${uid()}`, click: { ...click, waba: u?.channels?.whatsapp?.wabaId || '' } });
}
