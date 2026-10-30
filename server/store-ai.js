// "Describe your shop": one or two sentences (Hindi or English) → a draft of the whole storefront — theme and its
// options, name / tagline / about, announcement, hero, categories, section order, SEO, policy page drafts, and
// titles / descriptions for the products the seller picked. Nothing changes until the seller presses Apply
// (POST /api/store/ai-setup/apply re-cleans the draft and writes it). Also: "Rewrite with AI" for one listing.
// The draft costs AI credits like other AI features (credits('generate'); a rewrite credits('edit')); the optional
// banner image goes through the existing /api/ai/image path from the browser.
import { aiJson, aiEnabled } from './ai.js';
import { T, uid } from './db.js';
import { inventoryOn } from './inventory-core.js';
import { THEME_IDS, FONT_IDS, HERO_IDS, SECTION_IDS, PERK_IDS, POLICY_KEYS, guessTheme, cleanThemeOptions, cleanPolicyPages, cleanListingExtras } from './store-themes.js';
import { cleanListing } from './store.js';

const clip = (v, n) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, n);
const MAX_PICKS = 24;
const need = (res) => { if (aiEnabled()) return true; res.status(503).json({ error: 'AI isn’t switched on for this account yet' }); return false; };
const fail = (res, e) => res.status(502).json({ error: /JSON/.test(e?.message || '') ? 'The AI couldn’t draft your store this time — try describing it a little differently' : 'The AI couldn’t draft your store just now — please try again' });

const FONTS_HELP = 'modern (clean sans-serif), editorial (high-fashion serif), friendly (rounded, reads well in Hindi), soft (light elegant serif with an airy sans), tech (geometric grotesk), elegant (classic serif)';
export const SETUP_SYSTEM = `You set up an online store for an Indian small business from the owner's short description, and write all of its copy.
Pick the storefront theme that fits:
- fashion: clothing, ethnic wear, sarees, footwear, bags, jewellery
- grocery: kirana, fruits and vegetables, dairy, staples, daily essentials, FMCG
- beauty: skincare, cosmetics, haircare, personal care, wellness
- electronics: mobiles, gadgets, audio, accessories, appliances
- toys: toys, games, baby and kids' products
- sports: sports equipment, fitness, gym, activewear, cricket, cycling, yoga
- hardware: hardware, tools, building materials, cement, steel, plumbing, electricals, paints
- crafts: handicrafts, handloom, ethnic crafts by artisans (Ajrakh, Bandhani, Chikankari, Madhubani…), home décor from craft clusters
- brand: a D2C brand selling one hero product (or a small range around it)
- classic: anything else
Language: write everything a buyer reads in the language the owner wrote in — Hindi in Devanagari when they wrote Hindi, Hinglish when they wrote Hinglish, otherwise English. Set "lang" to "hi" for Hindi, else "en".
Rules:
- Use facts only from the description and the store details given. Never invent prices, discounts, delivery times or areas, certifications, awards, reviews, ratings, addresses, phone numbers, coupon codes or legal names. When a fact is unknown, leave it out — policies may use placeholders in [square brackets] for the owner to fill in.
- Short, specific and warm, for Indian buyers; prices in ₹.
- Product copy describes what the product is (from its name, unit and category) — no medical or exaggerated claims.
Return ONLY JSON with these keys:
{"theme":"${THEME_IDS.join('|')}","lang":"en|hi","accent":"#rrggbb that suits the brand","font":"${FONT_IDS.join('|')}","hero":"${HERO_IDS.join('|')}",
"name":"store name (keep theirs if given)","tagline":"≤ 80 characters","about":"2–3 sentences","announcement":"≤ 100 characters, a real benefit from the description (free delivery above ₹X, COD, exchange…) or empty",
"heroTitle":"≤ 60 characters","heroText":"≤ 160 characters","heroCta":"≤ 24 characters","deliveryNote":"only when the description gives delivery facts, else empty",
"categories":["3–8 short category names"],"sections":["home sections in order, from: ${SECTION_IDS.join(', ')}"],"perks":["only those the description supports, from: ${PERK_IDS.join(', ')}"],
"offers":[{"title":"","note":""}] (only offers the owner described; no codes),"seo":{"title":"≤ 60 characters","description":"≤ 155 characters"},
"policies":{"refund":"","shipping":"","terms":"","privacy":""} (plain text, 120–300 words each, short headings on their own lines, Indian context — GST invoice, COD, returns),
"listings":[{"ref":"the ref given","title":"clean product title","description":"40–90 words","category":"one of your categories","highlights":["2–4 short points, ≤ 4 words each"],"badge":"optional, ≤ 14 characters, e.g. Bestseller"}] (one for each product given, same ref),
"bannerPrompt":"a photographic hero banner for this shop — scene, light, mood; no text, no logos, no people's faces"}
Fonts: ${FONTS_HELP}.`;

// the products the AI writes for: the seller's own picks (or what's already listed), as "item:<id>" / "product:<id>"
function picksFor(u, picks) {
  const listed = T.slistings.all({ userId: u.id });
  const refs = Array.isArray(picks) && picks.length ? picks : listed.map((l) => `${l.kind}:${l.refId}`);
  const out = [];
  for (const ref of [...new Set(refs.map((r) => String(r || '').slice(0, 80)))]) {
    const [kind, id] = ref.split(':');
    if (kind === 'product') { const p = T.products.get(id); if (p && p.userId === u.id) out.push({ ref, name: p.name, kind: 'digital product' }); }
    else if (kind === 'item' && inventoryOn(u)) { const i = T.iitems.get(id); if (i && i.userId === u.id && i.active !== false) out.push({ ref, name: i.name, unit: i.unit || '', category: i.category || '', price: i.sale_rate ?? null }); }
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

// the AI's JSON → a clean draft (everything checked the way the settings page checks it), or null when it's empty
export function cleanDraft(r, { prompt = '', refs = new Set() } = {}) {
  if (!r || typeof r !== 'object') return null;
  const theme = THEME_IDS.includes(r.theme) ? r.theme : guessTheme(prompt);
  const options = cleanThemeOptions({
    accent: r.accent, font: r.font, hero: r.hero, announcement: r.announcement, heroTitle: r.heroTitle, heroText: r.heroText, heroCta: r.heroCta,
    deliveryNote: r.deliveryNote, sections: r.sections, perks: r.perks, lang: r.lang, seo: r.seo, heroImage: r.heroImage || '',
    offers: (Array.isArray(r.offers) ? r.offers : []).map((o) => ({ title: o?.title, note: o?.note })), // the AI never makes up coupon codes
  }, { lenient: true });
  if (options.sections?.length && !options.sections.includes('grid')) options.sections.push('grid');
  const categories = [...new Set((Array.isArray(r.categories) ? r.categories : []).map((c) => clip(c, 40)).filter(Boolean))].slice(0, 12);
  const policyPages = cleanPolicyPages(Object.fromEntries(POLICY_KEYS.map((k) => [k, { text: typeof r.policies?.[k] === 'string' ? r.policies[k] : r.policies?.[k]?.text || '', draft: true }])));
  const seen = new Set();
  const listings = (Array.isArray(r.listings) ? r.listings : []).map((x) => {
    const ref = String(x?.ref || '');
    if (!refs.has(ref) || seen.has(ref)) return null;
    seen.add(ref);
    const out = { ref, title: clip(x.title, 120), description: clip(x.description, 1500), category: categories.includes(clip(x.category, 40)) ? clip(x.category, 40) : '' };
    return cleanListingExtras({ highlights: x.highlights, badge: x.badge }, out);
  }).filter((x) => x && (x.title || x.description));
  const d = { theme, options, name: clip(r.name, 80), tagline: clip(r.tagline, 160), about: clip(r.about, 2000), categories, policyPages, listings, bannerPrompt: clip(r.bannerPrompt, 600) };
  return d.name || d.tagline || options.heroTitle ? d : null;
}

export function registerStoreAi(app, { auth, rateLimit, isTest, credits }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 6, key: (req) => req.user?.id || req.ip, message: 'Too many AI drafts — please wait a minute.' });
  const storeOf = (u) => T.stores.find({ userId: u.id });

  app.post('/api/store/ai-setup', auth, limiter, credits('generate'), async (req, res) => {
    const prompt = clip(req.body?.prompt, 1200);
    if (prompt.length < 8) return res.status(400).json({ error: 'Describe your shop in a sentence or two' });
    if (!need(res)) return;
    const u = req.user, s = storeOf(u) || {};
    const products = picksFor(u, req.body?.picks);
    const details = {
      business: u.settings?.businessName || '', storeName: s.name || '', categoriesNow: s.categories || [],
      shipping: s.shipping?.fee ? `₹${s.shipping.fee}${s.shipping.freeAbove ? `, free above ₹${s.shipping.freeAbove}` : ''}` : s.shipping?.freeAbove === 0 && s.shipping ? 'free' : 'not set',
      cashOnDelivery: !!s.cod?.enabled, whatsappSupport: !!u.settings?.supportWhatsapp,
    };
    try {
      const r = await aiJson(SETUP_SYSTEM, `The owner's description: ${prompt}\n\nStore details: ${JSON.stringify(details)}\n\nProducts to write for (${products.length}):\n${products.map((p) => JSON.stringify(p)).join('\n') || '(none yet)'}`);
      const draft = cleanDraft(r, { prompt, refs: new Set(products.map((p) => p.ref)) });
      if (!draft) { res.locals.aiFailed = true; return res.status(502).json({ error: 'The AI couldn’t draft your store this time — try describing it a little differently' }); }
      draft.names = Object.fromEntries(products.map((p) => [p.ref, p.name]));
      res.json({ draft });
    } catch (e) { fail(res, e); }
  });

  // Apply: the draft (as previewed, perhaps with a generated banner) is checked again and written
  app.post('/api/store/ai-setup/apply', auth, (req, res) => {
    const u = req.user, s = storeOf(u);
    if (!s) return res.status(400).json({ error: 'Open Sell → Store first' });
    const b = req.body?.draft || {};
    const own = new Set(picksFor(u, (Array.isArray(b.listings) ? b.listings : []).map((l) => l?.ref)).map((p) => p.ref));
    const d = cleanDraft({ ...b, ...b.options, policies: Object.fromEntries(POLICY_KEYS.map((k) => [k, b.policyPages?.[k]?.text || ''])) }, { refs: own });
    if (!d) return res.status(400).json({ error: 'This draft is empty — describe your shop again' });
    if (d.options.heroImage && !d.options.heroImage.startsWith(`/uploads/${u.id}/`)) delete d.options.heroImage;
    // policy pages the seller already reviewed are kept; drafts and empty ones are filled
    const pages = { ...(s.policyPages || {}) };
    for (const k of POLICY_KEYS) if (d.policyPages[k] && (!pages[k] || pages[k].draft)) pages[k] = d.policyPages[k];
    T.stores.update(s.id, (r) => {
      r.theme = d.theme;
      r.themeOptions = { ...(r.themeOptions || {}), ...d.options };
      for (const k of ['name', 'tagline', 'about']) if (d[k]) r[k] = d[k];
      if (d.categories.length) r.categories = [...new Set([...d.categories, ...(r.categories || [])])].slice(0, 40);
      r.policyPages = pages;
    });
    const out = { created: 0, updated: 0, skipped: [] };
    const mine = T.slistings.all({ userId: u.id });
    for (const x of d.listings) {
      const [kind, refId] = x.ref.split(':');
      const patch = { ...(x.title ? { title: x.title } : {}), ...(x.description ? { description: x.description } : {}), ...(x.category ? { category: x.category } : {}), highlights: x.highlights || [], badge: x.badge || '' };
      const l = mine.find((y) => y.kind === kind && y.refId === refId);
      if (l) { const c = cleanListing(patch, l); T.slistings.update(l.id, (r) => Object.assign(r, c)); out.updated++; continue; }
      const item = kind === 'item' ? T.iitems.get(refId) : null;
      if (kind === 'product' || item?.sale_rate == null || item.sale_rate === '') { out.skipped.push(x.title || (item || T.products.get(refId))?.name || refId); continue; } // needs a price set by hand
      if (T.slistings.count({ userId: u.id }) >= 2000) break;
      const c = cleanListing({ kind, refId, ...patch });
      T.slistings.insert({ id: uid(), userId: u.id, visible: true, images: [], sort: 0, ...c, at: Date.now() });
      out.created++;
    }
    res.json({ ok: true, ...out });
  });

  // one listing's title, description and highlights, rewritten (not saved — the seller presses Save)
  app.post('/api/store/listings/:lid/ai', auth, limiter, credits('edit'), async (req, res) => {
    const l = T.slistings.get(req.params.lid);
    if (!l || l.userId !== req.user.id) return res.status(404).json({ error: 'Listing not found' });
    if (!need(res)) return;
    const src = l.kind === 'product' ? T.products.get(l.refId) : T.iitems.get(l.refId);
    const s = storeOf(req.user) || {};
    const info = { name: l.title || src?.name || '', unit: src?.unit || '', category: l.category || src?.category || '', price: l.price ?? src?.sale_rate ?? null, now: l.description || '', store: s.name || '', storeKind: s.theme || 'classic' };
    const system = `You write product copy for an Indian online store. Rewrite this product's listing so it sells: a clean title, a 40–90 word description (what it is, who it's for, how to use or care for it), and 2–4 highlights of ≤ 4 words each. Use only facts from what is given — never invent specifications, certifications, ratings or medical claims. Keep the language of the current description (Hindi stays Hindi). Return ONLY JSON {"title","description","highlights":[]}.`;
    try {
      const r = await aiJson(system, `${JSON.stringify(info)}${req.body?.hint ? `\nThe seller's note: ${clip(req.body.hint, 300)}` : ''}`);
      const out = cleanListingExtras({ highlights: r?.highlights }, { title: clip(r?.title, 120), description: clip(r?.description, 1500) });
      if (!out.description) { res.locals.aiFailed = true; return res.status(502).json({ error: 'The AI couldn’t rewrite this one — please try again' }); }
      res.json({ draft: out });
    } catch (e) { fail(res, e); }
  });
}
