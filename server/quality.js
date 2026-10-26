// Quality gate for AI-generated funnels: every funnel must meet the same bar as our template library.
// The bar is measured from the templates themselves (structure, section order, minimum content),
// plus copy rules (no placeholders, consistent prices, Indian social proof).
import { allTemplates } from './templates.js';
import { uid } from './db.js';

// Templates differ in which sections they have, so a reference section comes from the matched template
// when it has one, otherwise from the first template that does (with fresh ids).
const withIds = (b) => ({ ...structuredClone(b), id: uid() });
function refBlock(tpl, si, type) {
  const own = tpl.steps[si]?.blocks.find((b) => b.type === type) || tpl.steps.flatMap((s) => s.blocks).find((b) => b.type === type);
  if (own) return own;
  for (const t of allTemplates()) { const b = t.steps.flatMap((s) => s.blocks).find((x) => x.type === type); if (b) return withIds(b); }
  return null;
}
function refStep(tpl, i, type) {
  if (tpl.steps[i]?.type === type) return structuredClone(tpl.steps[i]);
  const own = tpl.steps.find((s) => s.type === type);
  if (own) return structuredClone(own);
  for (const t of allTemplates()) { const s = t.steps.find((x) => x.type === type); if (s) return { ...structuredClone(s), id: uid(), blocks: s.blocks.map(withIds) }; }
  return null;
}

import { PAGE_STYLES as STYLES, VARIANTS } from './page-styles.js';
const HEX = /^#[0-9a-f]{6}$/i;
const PLACEHOLDER = /lorem|ipsum|\byour product\b|\bproduct name\b|\bbenefit (one|two|three|1|2|3)\b|\bproblem (one|two|three)\b|\bbonus (one|two)\b|\bquestion\?|\btbd\b|\bxxx+\b|\[(link|name|city|product|price|insert)[^\]]*\]|\{(link|name)\}|example\.com|placeholder|expert name/i;
// names that are obviously stand-ins
const FAKE_NAME = /^(happy |satisfied |verified )?(customer|client|student|user)s?(\b|,|$)|^name$|^full name$|^expert name$|^john doe/i;
const IMAGE_OK = new Set(['image']); // optional in every template

const empty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
const priceLike = (v) => /^\s*(₹|rs\.?|inr)?\s*\d[\d,]*(\.\d+)?\s*(\/-)?\s*$/i.test(String(v ?? ''));
// lists a template can't lend items to: a seller's application questions (and their reject rules) are their own
const OWN_LISTS = new Set(['form.fields']);
const num = (v) => Number(String(v ?? '').replace(/[^\d.]/g, ''));
// a countdown counting minutes per visitor (not a fixed date or the next webinar session)
const perVisitor = (p) => (p.mode ? p.mode === 'evergreen' : !(num(p.endsAt) > 0));

// ---------- the bar, measured from the templates ----------
let BAR = null;
export function qualityBar() {
  if (BAR) return BAR;
  const T = allTemplates();
  const mins = {}, keys = {};
  for (const t of T) for (const s of t.steps) for (const b of s.blocks) {
    const ks = Object.keys(b.props).filter((k) => !IMAGE_OK.has(k) && !empty(b.props[k]));
    keys[b.type] = keys[b.type] ? keys[b.type].filter((k) => ks.includes(k)) : ks;
    for (const [k, v] of Object.entries(b.props)) if (Array.isArray(v)) mins[`${b.type}.${k}`] = Math.min(mins[`${b.type}.${k}`] ?? 99, v.length);
  }
  BAR = { mins, keys };
  return BAR;
}
export const blueprintOf = (t) => t.steps.map((s) => ({ type: s.type, blocks: s.blocks.map((b) => b.type) }));

// Page length. Templates carry every section a page could use (up to 18), which reads long and repetitive for
// most sellers: 'short' and 'standard' keep the sections that sell, in the template's order, on the main
// pages (landing, sales, opt-in); checkout, upsell and thank-you pages stay as they are. 'detailed' is the full template.
export const PAGE_LENGTHS = ['short', 'standard', 'detailed'];
const MAIN_PAGES = new Set(['landing', 'sales', 'optin']);
const DROP = {
  short: new Set(['hellobar', 'stats', 'problem', 'mentor', 'steps', 'compare', 'bonuses', 'guarantee', 'proof', 'exitpopup', 'stickybar', 'countdown', 'livecount', 'stock']),
  standard: new Set(['hellobar', 'stats', 'compare', 'proof', 'exitpopup', 'livecount', 'stock']),
};
export function trimTemplate(t, length = 'standard') {
  const drop = DROP[length];
  if (!drop) return t;
  const out = structuredClone(t);
  for (const st of out.steps) {
    if (!MAIN_PAGES.has(st.type)) continue;
    const types = st.blocks.map((b) => b.type);
    const seen = new Set();
    st.blocks = st.blocks.filter((b) => {
      if (seen.has(b.type)) return false; // one of each section: no saying it twice
      // a short page keeps "how it works" when it's the page's only list of what you get
      if (drop.has(b.type) && !(b.type === 'steps' && !types.includes('features'))) return false;
      seen.add(b.type);
      return true;
    });
  }
  return out;
}

// The bar written out for the model (first pass)
export function barText(blueprint) {
  const { mins } = qualityBar();
  const lists = Object.entries(mins).filter(([k]) => blueprint.some((s) => s.blocks.includes(k.split('.')[0]))).map(([k, n]) => `${k} ≥ ${n}`).join(', ');
  return `QUALITY BAR — the funnel is rejected unless ALL of these hold:
1. Steps, in this exact order, each with exactly these blocks in this order:
${blueprint.map((s, i) => `   ${i + 1}. ${s.type}: ${s.blocks.join(', ')}`).join('\n')}
2. Every block has all its fields filled with specific copy (as in the example). Minimum list sizes: ${lists}.
3. No placeholders anywhere ("Your Product", "Benefit one", "[link]", "lorem", "Expert Name"…). Be specific about the offer itself, but never invent facts about the seller: no customer / attendee counts, ratings, review counts, "only N left" or "price goes up tonight" lines. stats values stay "[Add your real number]" for the seller to fill in. Sample testimonials use realistic Indian names with cities.
4. One price everywhere: checkout.price = pricing.price, and any hero.cardPrice / stickybar.price that shows a price shows that same amount (e.g. "₹1,999"). A free registration page (webinar, lead magnet) says "FREE" instead; an application funnel says "By application". Every mrp is higher than its price. Upsell and downsell offers have their own lower prices.
5. Hero headline has one *highlighted phrase* in stars. Testimonials use "Name, City" style Indian names. stock.label contains {n}. proof.intervalSec ≥ 9.
6. theme.style is one of ${STYLES.join('|')}; primary and secondary are #rrggbb colours.`;
}

// ---------- the audit ----------

const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };

// → [{ s: stepIndex, b: blockIndex | null, type, msg }]
export function audit(f, blueprint) {
  const issues = [];
  const { mins, keys } = qualityBar();
  const add = (s, b, type, msg) => issues.push({ s, b, type, msg });
  if (!f || !Array.isArray(f.steps)) return [{ s: null, b: null, type: 'funnel', msg: 'no steps' }];
  if (!STYLES.includes(f.theme?.style)) add(null, null, 'theme', `theme.style must be one of ${STYLES.join(', ')}`);
  if (!HEX.test(f.theme?.primary || '') || !HEX.test(f.theme?.secondary || '')) add(null, null, 'theme', 'theme colours must be #rrggbb');
  if (f.steps.length !== blueprint.length || f.steps.some((s, i) => s.type !== blueprint[i].type)) add(null, null, 'steps', `steps must be: ${blueprint.map((s) => s.type).join(' → ')}`);
  const all = f.steps.flatMap((s, si) => (s.blocks || []).map((b, bi) => ({ ...b, si, bi })));
  const first = (type) => all.find((b) => b.type === type);
  blueprint.forEach((bp, si) => {
    const st = f.steps[si];
    if (!st || st.type !== bp.type) return;
    const types = (st.blocks || []).map((b) => b.type);
    for (const t of bp.blocks) if (!types.includes(t)) add(si, null, t, `missing the ${t} section`);
    const order = bp.blocks.filter((t) => types.includes(t));
    if (types.filter((t) => bp.blocks.includes(t)).join() !== order.join()) add(si, null, 'order', `sections out of order — should be ${bp.blocks.join(', ')}`);
  });
  for (const b of all) {
    const p = b.props || {};
    for (const k of keys[b.type] || []) if (empty(p[k]) && typeof p[k] !== 'boolean' && typeof p[k] !== 'number') add(b.si, b.bi, b.type, `${k} is empty`);
    for (const [k, v] of Object.entries(p)) if (Array.isArray(v) && !OWN_LISTS.has(`${b.type}.${k}`) && mins[`${b.type}.${k}`] && v.length < mins[`${b.type}.${k}`]) add(b.si, b.bi, b.type, `${k} needs at least ${mins[`${b.type}.${k}`]} items (has ${v.length})`);
    const bad = strings(Object.fromEntries(Object.entries(p).filter(([k]) => !OWN_LISTS.has(`${b.type}.${k}`)))).find((x) => PLACEHOLDER.test(x));
    if (bad) add(b.si, b.bi, b.type, `placeholder text: "${bad.slice(0, 60)}"`);
    if ('mrp' in p && 'price' in p && !(num(p.mrp) > num(p.price))) add(b.si, b.bi, b.type, 'mrp must be higher than price');
    if (['checkout', 'pricing', 'offer'].includes(b.type) && !(num(p.price) > 0)) add(b.si, b.bi, b.type, 'price must be a positive number');
    if ((b.type === 'testimonials' || b.type === 'proof') && (p.items || []).some((x) => FAKE_NAME.test(String(x?.name || '').trim()))) add(b.si, b.bi, b.type, 'use realistic Indian names, not stand-ins like "Happy Customer"');
    if (b.type === 'hero' && !/\*[^*]+\*/.test(p.headline || '')) add(b.si, b.bi, b.type, 'headline needs one *highlighted phrase*');
    if (b.type === 'hero' && (String(p.headline || '').length < 25 || String(p.headline || '').length > 160)) add(b.si, b.bi, b.type, 'headline should be 25–160 characters');
    if (b.type === 'stock' && !String(p.label || '').includes('{n}')) add(b.si, b.bi, b.type, 'label must contain {n}');
    if (p.variant != null && !(VARIANTS[b.type] || []).includes(p.variant)) add(b.si, b.bi, b.type, `variant must be one of ${(VARIANTS[b.type] || ['(none)']).join(', ')}`);
    if (b.type === 'proof' && num(p.intervalSec) < 9) add(b.si, b.bi, b.type, 'intervalSec must be ≥ 9');
    if (b.type === 'testimonials' && (p.items || []).some((x) => empty(x?.name) || empty(x?.quote))) add(b.si, b.bi, b.type, 'every testimonial needs name and quote');
    if (b.type === 'testimonials' && new Set((p.items || []).map((x) => x?.quote)).size < (p.items || []).length) add(b.si, b.bi, b.type, 'testimonials repeat the same quote');
    if (b.type === 'faq' && (p.items || []).some((x) => empty(x?.q) || empty(x?.a))) add(b.si, b.bi, b.type, 'every FAQ needs a question and an answer');
    if (b.type === 'checkout' && p.bumpEnabled && !(num(p.bumpPrice) > 0)) add(b.si, b.bi, b.type, 'order bump needs a price');
    if (b.type === 'countdown' && perVisitor(p) && !(num(p.minutes) > 0)) add(b.si, b.bi, b.type, 'countdown minutes must be positive');
  }
  // one price everywhere
  const main = num(first('checkout')?.props?.price) || num(first('pricing')?.props?.price);
  if (main) {
    const pr = first('pricing');
    if (pr && num(pr.props.price) !== main) add(pr.si, pr.bi, 'pricing', `price must equal the checkout price (${main})`);
    // every hero / sticky bar that shows a price shows this one ("FREE" on a webinar registration page is fine)
    for (const h of all.filter((b) => b.type === 'hero' && priceLike(b.props?.cardPrice) && num(b.props.cardPrice) !== main)) add(h.si, h.bi, 'hero', `cardPrice must show the checkout price (₹${main.toLocaleString('en-IN')})`);
    for (const sb of all.filter((b) => b.type === 'stickybar' && priceLike(b.props?.price) && num(b.props.price) !== main)) add(sb.si, sb.bi, 'stickybar', `price must show the checkout price (₹${main.toLocaleString('en-IN')})`);
  }
  return issues;
}

// ---------- last resort: bring anything still below the bar up to the template ----------
// `tpl` is the closest template, already personalised to the seller's business.
export function enforce(f, tpl, blueprint) {
  const filled = [];
  const { keys, mins } = qualityBar();
  f.theme = { ...tpl.theme, ...(STYLES.includes(f.theme?.style) ? { style: f.theme.style } : {}), ...(HEX.test(f.theme?.primary || '') ? { primary: f.theme.primary } : {}), ...(HEX.test(f.theme?.secondary || '') ? { secondary: f.theme.secondary } : {}) };
  // steps: keep the AI's step when its type matches the blueprint, otherwise take the template's
  const phase = (list, i) => list.slice(0, i).filter((s) => s.type === 'checkout').length;
  const bpPhase = blueprint.map((_, i) => phase(blueprint, i));
  const aiPhase = f.steps.map((_, i) => phase(f.steps, i));
  const steps = blueprint.map((bp, i) => {
    const mine = f.steps.find((s, j) => s.type === bp.type && !s._used && aiPhase[j] === bpPhase[i]) || (blueprint.filter((x) => x.type === bp.type).length === 1 && f.steps.find((s) => s.type === bp.type && !s._used));
    if (mine) { mine._used = true; return mine; }
    filled.push(`${bp.type} page`);
    return refStep(tpl, i, bp.type);
  });
  steps.forEach((s) => delete s._used);
  steps.forEach((st, si) => {
    const bp = blueprint[si];
    const byType = new Map();
    for (const b of st.blocks || []) if (!byType.has(b.type)) byType.set(b.type, b);
    const extras = (st.blocks || []).filter((b) => !bp.blocks.includes(b.type));
    st.blocks = bp.blocks.map((t) => {
      const ref = refBlock(tpl, si, t);
      let b = byType.get(t);
      if (!b) { filled.push(`${bp.type}: ${t} section`); return structuredClone(ref); }
      b = { ...b, props: { ...b.props } };
      for (const k of keys[t] || []) if (empty(b.props[k]) && !empty(ref?.props?.[k])) { b.props[k] = structuredClone(ref.props[k]); filled.push(`${t}.${k}`); }
      if (b.props.variant != null && VARIANTS[t] && !VARIANTS[t].includes(b.props.variant)) b.props.variant = ref?.props?.variant && VARIANTS[t].includes(ref.props.variant) ? ref.props.variant : VARIANTS[t][0];
      for (const [k, v] of Object.entries(b.props)) {
        if (OWN_LISTS.has(`${t}.${k}`)) continue;
        const min = mins[`${t}.${k}`];
        if (Array.isArray(v) && min && v.length < min && Array.isArray(ref?.props?.[k])) { b.props[k] = [...v, ...structuredClone(ref.props[k]).slice(v.length)]; filled.push(`${t}.${k}`); }
      }
      // placeholder text → the template's wording for that field
      for (const [k, v] of Object.entries(b.props)) if (!OWN_LISTS.has(`${t}.${k}`) && strings(v).some((x) => PLACEHOLDER.test(x)) && ref?.props?.[k] != null) { b.props[k] = structuredClone(ref.props[k]); filled.push(`${t}.${k}`); }
      return b;
    });
    // keep valid extra sections the AI added (before the closing call to action)
    if (extras.length) { const at = st.blocks.findIndex((b) => b.type === 'cta'); st.blocks.splice(at < 0 ? st.blocks.length : at, 0, ...extras); }
  });
  f.steps = steps;
  fixups(f, filled);
  // anything still below the bar: that section is replaced by the template's (which always passes), prices re-synced
  for (const i of audit(f, blueprint)) {
    if (i.b == null || i.s == null) continue;
    const cur = f.steps[i.s]?.blocks?.[i.b];
    const ref = cur && refBlock(tpl, i.s, cur.type);
    if (!ref || cur._replaced) continue;
    if (cur.type === 'hero' && /headline/.test(i.msg)) { cur.props.headline = ref.props.headline; filled.push('hero.headline'); continue; }
    f.steps[i.s].blocks[i.b] = { ...structuredClone(ref), _replaced: true };
    filled.push(`${cur.type} section`);
  }
  for (const st of f.steps) for (const b of st.blocks) delete b._replaced;
  fixups(f, filled);
  return [...new Set(filled)];
}

// price consistency and small mechanical fixes (checkout is the source of truth for the price)
function fixups(f, filled) {
  const all = f.steps.flatMap((s) => s.blocks);
  const chk = all.find((b) => b.type === 'checkout')?.props;
  const main = num(chk?.price) || num(all.find((b) => b.type === 'pricing')?.props?.price);
  if (main) {
    const rs = `₹${main.toLocaleString('en-IN')}`;
    for (const b of all) {
      const p = b.props;
      if (b.type === 'pricing' && num(p.price) !== main) { p.price = main; filled.push('pricing.price'); }
      if (b.type === 'hero' && priceLike(p.cardPrice) && num(p.cardPrice) !== main) { p.cardPrice = rs; filled.push('hero.cardPrice'); }
      if (b.type === 'stickybar' && priceLike(p.price) && num(p.price) !== main) { p.price = rs; filled.push('stickybar.price'); }
    }
  }
  for (const b of all) {
    const p = b.props;
    if ('mrp' in p && 'price' in p && !(num(p.mrp) > num(p.price))) { const m = Math.round((num(p.price) * 2.2) / 100) * 100 - 1; p.mrp = typeof p.mrp === 'string' ? `₹${m.toLocaleString('en-IN')}` : m; filled.push(`${b.type}.mrp`); }
    if (b.type === 'hero' && !/\*[^*]+\*/.test(p.headline || '')) { const w = String(p.headline || '').split(' — '); p.headline = w.length > 1 ? `${w[0]} — *${w.slice(1).join(' — ')}*` : String(p.headline || '').replace(/(\S+\s+\S+)$/, '*$1*'); filled.push('hero.headline highlight'); }
    if (b.type === 'stock' && !String(p.label || '').includes('{n}')) { p.label = 'Only {n} left in stock'; filled.push('stock.label'); }
    if (p.variant != null && !(VARIANTS[b.type] || []).includes(p.variant)) { if (VARIANTS[b.type]) p.variant = VARIANTS[b.type][0]; else delete p.variant; filled.push(`${b.type}.variant`); }
    if (b.type === 'proof' && num(p.intervalSec) < 9) { p.intervalSec = 9; filled.push('proof.intervalSec'); }
    if (b.type === 'countdown' && perVisitor(p) && !(num(p.minutes) > 0)) { p.minutes = 30; filled.push('countdown.minutes'); }
  }
}
