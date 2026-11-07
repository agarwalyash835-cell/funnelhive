// Answers people give — funnel forms, quizzes, lead portals (99acres, IndiaMART, Justdial, Meta lead forms) — into
// the CRM's own fields, so an industry's board columns, filters and deal value fill themselves. A question fills a
// field when the seller linked it ("Save to CRM field" in the editor) or when its wording names the field ("Budget"
// → "Budget (₹)", "City" → "Preferred location"). Dropdown fields take only one of their own options; amounts
// understand Indian wording (80 lakh, 1.2 cr, 50k); a blank answer never clears what's already there.
import { ensureMeta } from './crm.js';
import { T } from './db.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/\(₹\)|₹|\?/g, ' ').replace(/[^a-z0-9ऀ-෿]+/g, ' ').trim();
// everyday words for the same thing (the question's word → the field's)
const SAME = { city: 'location', area: 'location', locality: 'location', place: 'location', 'preferred city': 'location', mobile: 'phone', whatsapp: 'phone', 'whatsapp number': 'phone', fees: 'fee', price: 'budget', 'your budget': 'budget' };

// "80 lakh" → 8000000, "1.2 cr" → 12000000, "₹50,000" → 50000, "50k" → 50000, "50–60 lakh" → 5000000
export function amount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').toLowerCase().replace(/,/g, '');
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const unit = (s.match(/(crore|cr)\b/) && 1e7) || (s.match(/(lakh|lac|lakhs|lacs)\b|\d\s*l\b/) && 1e5) || (s.match(/\d\s*k\b|thousand/) && 1e3) || 1;
  return Math.round(Number(m[1]) * unit);
}
const options = (d) => String(d.options || '').split(',').map((o) => o.trim()).filter(Boolean);
const optionFor = (d, v) => {
  const n = norm(v);
  if (!n) return null;
  const all = options(d);
  return all.find((o) => norm(o) === n) || all.find((o) => norm(o).startsWith(n) || n.startsWith(norm(o))) || null;
};
// one answer as this field stores it (undefined: it doesn't fit, so nothing is saved)
export function valueFor(d, v) {
  if (v == null || v === '') return undefined;
  if (d.type === 'checkbox') return v === true || /^(yes|y|true|haan|ha|1|needed)$/i.test(String(v).trim());
  if (d.type === 'number' || d.type === 'money') return amount(v) ?? undefined;
  if (d.type === 'select') return optionFor(d, v) ?? undefined;
  if (d.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : undefined;
  return String(v).trim().slice(0, 2000) || undefined;
}
// An account keeps the fields of every industry it ever tried. The seller's CRM fields, best first: the current
// industry's (its board columns, filters, value field and the rest with the same prefix, like re_), then fields the
// seller made, then other industries' — those only when nothing better fits.
const KIT_ID = /^[a-z]{2}_[a-z0-9]+$/;
export function fieldsFor(u) {
  const defs = u?.crmFields || [], cur = u?.settings?.crmKit;
  const mine = new Set([...(cur?.columns || []), ...(cur?.cardFields || []), ...(cur?.filters || []), cur?.valueField].filter(Boolean));
  const pre = new Set([...mine].filter((id) => KIT_ID.test(id)).map((id) => id.slice(0, 3)));
  const rank = (d) => (mine.has(d.id) || pre.has(String(d.id).slice(0, 3)) ? 0 : KIT_ID.test(d.id) ? 2 : 1);
  return defs.map((d) => ({ ...d, rank: rank(d) })).sort((a, b) => a.rank - b.rank);
}
// the field a question means: the seller's link, the same name, or (only when it points at one field) a name
// that contains the other ("Location" ↔ "Preferred location") — tried among the best-ranked fields first
function fieldFor(defs, label, links) {
  if (links[label]) return defs.find((d) => d.id === links[label]) || null;
  const q = norm(label), want = SAME[q] || q;
  if (!want) return null;
  const words = (s) => ` ${s} `;
  for (const r of [...new Set(defs.map((d) => d.rank ?? 0))]) {
    const tier = defs.filter((d) => (d.rank ?? 0) === r);
    const exact = tier.find((d) => norm(d.label) === want || norm(d.label) === q);
    if (exact) return exact;
    const near = tier.filter((d) => { const f = norm(d.label); return f.length > 2 && want.length > 2 && (words(f).includes(words(want)) || words(want).includes(words(f))); });
    if (near.length === 1) return near[0];
  }
  return null;
}
// { question: answer } (+ the seller's links { question: fieldId }) → { fieldId: value }
export function answersToCustom(defs = [], answers = {}, links = {}) {
  const out = {};
  for (const [label, v] of Object.entries(answers || {})) {
    const d = fieldFor(defs, label, links);
    if (!d || d.id in out) continue;
    const x = valueFor(d, v);
    if (x !== undefined) out[d.id] = x;
  }
  return out;
}

// the industry's "Enquiry from" / "Found us via" field, set to where this person came from
const FROM = [[/99acres/i, '99acres'], [/magic ?bricks/i, 'MagicBricks'], [/housing/i, 'Housing.com'], [/indiamart/i, 'IndiaMART'], [/trade ?india/i, 'TradeIndia'], [/just ?dial/i, 'JustDial'],
  [/instagram|\big\b/i, 'Instagram'], [/facebook|\bfb\b|meta/i, 'Facebook ads'], [/google|adwords|gclid/i, 'Google ads'], [/whatsapp/i, 'WhatsApp'], [/referr?al/i, 'Referral']];
export function sourceToCustom(defs = [], source = '') {
  const d = defs.find((x) => x.type === 'select' && /_from$/.test(x.id)); // the best-ranked one (fieldsFor)
  if (!d) return {};
  const all = options(d), s = String(source || '');
  const hit = FROM.find(([re]) => re.test(s));
  const pick = (hit && (all.find((o) => o === hit[1]) || all.find((o) => norm(o).startsWith(norm(hit[1]).split(' ')[0])))) || all.find((o) => /website/i.test(o));
  return pick ? { [d.id]: pick } : {};
}

// puts the values on the contact — a newer answer from the same person replaces an older one, a blank never does;
// the source field is only set once (where they first came from) → { changed: [{ fieldId, value }], added: [tags] }
export function fillContact(userId, key, custom, { source = {}, tags = [] } = {}) {
  if (!key) return { changed: [], added: [] };
  const m = ensureMeta(userId, key);
  const changed = [];
  const next = { ...(m.custom || {}) };
  for (const [id, v] of Object.entries(custom || {})) if (String(next[id] ?? '') !== String(v)) { next[id] = v; changed.push({ fieldId: id, value: v }); }
  for (const [id, v] of Object.entries(source || {})) if (next[id] == null || next[id] === '') { next[id] = v; changed.push({ fieldId: id, value: v }); }
  const had = new Set((m.tags || []).map((t) => t.toLowerCase()));
  const newTags = tags.filter((t) => t && !had.has(t.toLowerCase()));
  if (!changed.length && !newTags.length) return { changed, added: [] };
  m.custom = next;
  if (newTags.length) m.tags = [...(m.tags || []), ...newTags].slice(0, 30);
  T.crm.put(m);
  return { changed, added: newTags };
}
