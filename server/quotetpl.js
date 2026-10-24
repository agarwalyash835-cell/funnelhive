// Ready-made quotes for each CRM style (industry), written from how Indian businesses in that trade really quote:
// typical line items and ₹ prices, the GST line that applies, advance %, validity and terms. A seller sees their own
// industry's first, can browse the others, and edits everything before it goes to the client.
// The templates live one file per industry in ./quote-templates/<kit id>.js (plain data).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KITS, currentKit } from './crmkits.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'quote-templates');
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// one template, checked and trimmed (a bad entry is dropped, never served half-formed)
function clean(t, kit) {
  const items = (Array.isArray(t?.items) ? t.items : []).slice(0, 20).map((i) => ({ name: str(i?.name, 200), detail: str(i?.detail, 1000), qty: int(i?.qty, 1, 10000, 1), price: int(i?.price, 0, 10000000, 0) })).filter((i) => i.name);
  if (!t?.id || !t?.name || !items.length) return null;
  return {
    id: str(t.id, 80), industry: kit, name: str(t.name, 60), about: str(t.about, 160), title: str(t.title, 160), intro: str(t.intro, 5000),
    items, deposit: int(t.deposit, 0, 100, 0), validDays: int(t.validDays, 0, 365, 14), taxNote: str(t.gst, 300), terms: str(t.terms, 5000),
    total: items.reduce((s, i) => s + i.qty * i.price, 0),
  };
}

let CACHE = null;
export async function loadQuoteTemplates() {
  if (CACHE) return CACHE;
  const out = {};
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^[a-z]+\.js$/.test(f)) : [];
  for (const f of files) {
    const kit = f.replace(/\.js$/, '');
    if (!KITS.some((k) => k.id === kit)) continue;
    try {
      const list = (await import(pathToFileURL(path.join(DIR, f)).href)).default;
      out[kit] = (Array.isArray(list) ? list : []).map((t) => clean(t, kit)).filter(Boolean);
    } catch (e) { console.error(`quote templates: ${f} could not be loaded —`, e.message); }
  }
  CACHE = out;
  return out;
}

export function registerQuoteTemplates(app, { auth, wrap }) {
  app.get('/api/quote-templates', auth, wrap(async (req, res) => {
    const all = await loadQuoteTemplates();
    const cur = currentKit(req.user)?.id;
    const mine = all[cur] ? cur : 'general'; // an AI-designed (custom) CRM style starts from the general set
    const industries = KITS.filter((k) => all[k.id]?.length).map((k) => ({ id: k.id, name: k.name, templates: all[k.id] }));
    industries.sort((a, b) => (a.id === mine ? -1 : b.id === mine ? 1 : 0));
    res.json({ current: mine, industries });
  }));
}
